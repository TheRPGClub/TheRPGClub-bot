import type { Client } from "discord.js";
import { BOT_JOB_API, type IBotJob, type IBotJobApi } from "../classes/BotJobs.js";
import {
  BOT_JOB_CLAIM_LIMIT,
  BOT_JOB_ERROR_BACKOFF_MS,
  BOT_JOB_ERROR_MESSAGE_MAX,
  BOT_JOB_MAX_ATTEMPTS,
  BOT_JOB_POLL_INTERVAL_MS,
  BOT_JOB_RESULT_TEXT_MAX,
} from "../config/botJobs.js";
import { buildAnyErrorMessage } from "../utilities/ApiErrorUtils.js";
import { isTemporaryJobError } from "./BotJobErrors.js";
import { featurePostDestination } from "../functions/FeatureGate.js";
import { POST_FEATURE_KEYS } from "../config/featureGate.js";
import { createScheduledTask, type IScheduledTask } from "../utilities/IntervalUtils.js";
import { logError, logInfo } from "../utilities/LogUtils.js";
import {
  BOT_JOB_HANDLERS,
  createBotJobSurface,
  type BotJobHandler,
  type BotJobHandlers,
  type IBotJobSurface,
} from "./BotJobHandlers.js";

// The website's hands in Discord: the API queues a job when a website action needs the
// bot (a DM, a channel post, a hub refresh), and this service claims, performs and acks
// them. Delivery is at least once: a job claimed before a crash, or one whose ack never
// landed before a restart, goes back to the queue when its lease runs out and is performed
// again. Within one process a missed ack is remembered, so the job is only re-acked.

/**
 * The ack a performed job is owed: done (with the handler's result text, if any), or
 * failed with its error message.
 */
export type BotJobPendingAck =
  | { status: "done"; resultText?: string }
  | { status: "failed"; error: string };

/** What this process remembers between polls (lost on restart). */
export interface IBotJobDeliveryState {
  /**
   * Jobs performed whose ack (done or failed) did not land. When the lease hands one back
   * it is only acked, never performed twice (a second DM, a second post).
   */
  pendingAcks: Map<number, BotJobPendingAck>;
}

export function createBotJobDeliveryState(): IBotJobDeliveryState {
  return { pendingAcks: new Map() };
}

const deliveryState = createBotJobDeliveryState();

export { isTemporaryJobError };

function truncateErrorMessage(message: string): string {
  if (message.length <= BOT_JOB_ERROR_MESSAGE_MAX) return message;
  const marker = "\n...(truncated)";
  return message.slice(0, BOT_JOB_ERROR_MESSAGE_MAX - marker.length) + marker;
}

/**
 * A handler's result text as the done ack sends it: trimmed, cut to the API's limit, and
 * undefined when blank or absent (the ack then has no body, as before result texts).
 */
export function normalizeResultText(text: string | void): string | undefined {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) return undefined;
  if (trimmed.length <= BOT_JOB_RESULT_TEXT_MAX) return trimmed;
  return trimmed.slice(0, BOT_JOB_RESULT_TEXT_MAX - 3) + "...";
}

/**
 * The error_message a failed job is acked with: the full request and response, except a
 * Discord request's body. Admins read error_message on the website, and a DM's body can
 * hold the game key the API keeps out of the job.
 */
export function buildBotJobErrorMessage(job: IBotJob, err: unknown): string {
  const label = `Bot job ${job.id} (${job.kind}) failed`;
  return truncateErrorMessage(
    buildAnyErrorMessage(label, err, { devPing: false, omitDiscordRequestBody: true }),
  );
}

/**
 * The Feature a public-post job belongs to (api#353 adds `feature_key` to those payloads),
 * or null for a job that posts nothing public, which always runs.
 */
function jobFeatureKey(job: IBotJob): string | null {
  const key = job.payload.feature_key;
  return typeof key === "string" && key !== "" ? key : null;
}

const PREVIEW_RESULT_NOTE = "Preview: posted to the bot-dev channel instead.";

const POSTING_FEATURE_KEYS: ReadonlySet<string> = new Set(Object.values(POST_FEATURE_KEYS));

/**
 * Whether the Feature's flag routes the job's public posts. A Feature with no posts (the
 * News Hub's background work) still tags its jobs with its key, but posts nothing, so its
 * results carry no Preview note and its Off log does not speak of held posts.
 */
function routesPosts(featureKey: string): boolean {
  return POSTING_FEATURE_KEYS.has(featureKey);
}

function withPreviewResultNote(text: string | void): string {
  const trimmed = typeof text === "string" ? text.trim() : "";
  return trimmed ? `${PREVIEW_RESULT_NOTE} ${trimmed}` : PREVIEW_RESULT_NOTE;
}

async function ack(label: string, send: () => Promise<void>): Promise<boolean> {
  try {
    await send();
    return true;
  } catch (err) {
    // Left unacked: the lease hands the job back and the next claim retries the ack.
    logError(`BotJobService.ack ${label}`, err);
    return false;
  }
}

/**
 * Performs each claimed job in order and acks it done or failed. A job that throws is
 * acked failed with its error and the batch goes on, unless the error is temporary and
 * attempts remain: then it is left unacked for the lease to retry. A kind with no handler
 * fails without running anything. An ack that does not land is logged, remembered and left to
 * the lease, so the returning job is only acked. A public-post job (its payload's
 * `feature_key`) runs with its Feature's state in its context: the handler routes its public
 * posts by it (none when Off, the bot-dev channel in Preview) and keeps what is not a public
 * post, such as a DM or a poll nudge. In Preview the result text says where posts went.
 */
export async function processBotJobs(
  jobs: readonly IBotJob[],
  handlers: BotJobHandlers,
  surface: IBotJobSurface,
  api: IBotJobApi,
  state: IBotJobDeliveryState = deliveryState,
): Promise<void> {
  for (const job of jobs) {
    const label = `job ${job.id} (${job.kind})`;
    const pending = state.pendingAcks.get(job.id);
    if (pending) {
      if (await sendAck(label, job.id, pending, api)) state.pendingAcks.delete(job.id);
      continue;
    }
    const handler = Object.hasOwn(handlers, job.kind) ? handlers[job.kind] : undefined;
    let result: BotJobPendingAck | null;
    if (!handler) {
      const message = `Bot job ${job.id} failed: unknown kind "${job.kind}". ` +
        "This bot has no handler for it.";
      logError("BotJobService", new Error(message));
      result = { status: "failed", error: message };
    } else {
      result = await performJob(job, handler, surface, label);
      // Left unacked: the lease hands it back and the next attempt runs it again.
      if (!result) continue;
    }
    if (!(await sendAck(label, job.id, result, api))) state.pendingAcks.set(job.id, result);
  }
}

/**
 * Runs one job's handler and returns the ack it is owed, or null to leave it for the lease
 * (a temporary error with attempts left). Reads a public-post job's Feature state once,
 * for the handler.
 */
async function performJob(
  job: IBotJob,
  handler: BotJobHandler,
  surface: IBotJobSurface,
  label: string,
): Promise<BotJobPendingAck | null> {
  const featureKey = jobFeatureKey(job);
  const feature = featureKey
    ? { key: featureKey, state: await surface.featureState(featureKey) }
    : null;
  const posts = feature !== null && routesPosts(feature.key);
  const destination = featurePostDestination(feature?.state ?? null);
  if (posts && destination === "suppressed") {
    logInfo("BotJobService", `Running ${label} with its posts held: ${feature.key} is Off.`);
  }
  try {
    const handlerText = await handler(job.payload, surface, { feature });
    const resultText = normalizeResultText(
      posts && destination === "bot_dev" ? withPreviewResultNote(handlerText) : handlerText,
    );
    logInfo("BotJobService", `Performed ${label}.`);
    return resultText === undefined ? { status: "done" } : { status: "done", resultText };
  } catch (err) {
    logError(`BotJobService.${job.kind}`, err);
    if (isTemporaryJobError(err) && job.attempts < BOT_JOB_MAX_ATTEMPTS) {
      logInfo("BotJobService", `Left ${label} for the lease to retry (temporary error).`);
      return null;
    }
    return { status: "failed", error: buildBotJobErrorMessage(job, err) };
  }
}

function sendAck(
  label: string,
  jobId: number,
  result: BotJobPendingAck,
  api: IBotJobApi,
): Promise<boolean> {
  return ack(label, () =>
    result.status === "done"
      ? api.done(jobId, result.resultText)
      : api.failed(jobId, result.error));
}

/**
 * One poll: claims a batch and works it. Resolves to the delay before the next poll, at
 * once after a full batch (more may be waiting). A failed claim throws, so the scheduled
 * task backs off for BOT_JOB_ERROR_BACKOFF_MS and keeps polling.
 */
export async function pollBotJobsOnce(
  handlers: BotJobHandlers,
  surface: IBotJobSurface,
  api: IBotJobApi,
  state: IBotJobDeliveryState = deliveryState,
): Promise<number> {
  const jobs = await api.claim(BOT_JOB_CLAIM_LIMIT);
  await processBotJobs(jobs, handlers, surface, api, state);
  return jobs.length >= BOT_JOB_CLAIM_LIMIT ? 0 : BOT_JOB_POLL_INTERVAL_MS;
}

let pollTask: IScheduledTask | null = null;

export function startBotJobService(client: Client): void {
  if (pollTask) {
    pollTask.start();
    return;
  }
  const surface = createBotJobSurface(client);
  pollTask = createScheduledTask({
    name: "BotJobService.poll",
    task: () => pollBotJobsOnce(BOT_JOB_HANDLERS, surface, BOT_JOB_API),
    retryDelayMs: BOT_JOB_ERROR_BACKOFF_MS,
  });
  pollTask.start();
}
