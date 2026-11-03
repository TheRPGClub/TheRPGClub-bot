import { DiscordAPIError, HTTPError, RateLimitError, type Client } from "discord.js";
import { BOT_JOB_API, type IBotJob, type IBotJobApi } from "../classes/BotJobs.js";
import {
  BOT_JOB_CLAIM_LIMIT,
  BOT_JOB_ERROR_BACKOFF_MS,
  BOT_JOB_ERROR_MESSAGE_MAX,
  BOT_JOB_MAX_ATTEMPTS,
  BOT_JOB_POLL_INTERVAL_MS,
} from "../config/botJobs.js";
import { buildAnyErrorMessage } from "../utilities/ApiErrorUtils.js";
import { isTransientApiError } from "./RpgClubApiClient.js";
import { createScheduledTask, type IScheduledTask } from "../utilities/IntervalUtils.js";
import { logError, logInfo } from "../utilities/LogUtils.js";
import {
  BOT_JOB_HANDLERS,
  createBotJobSurface,
  type BotJobHandlers,
  type IBotJobSurface,
} from "./BotJobHandlers.js";

// The website's hands in Discord: the API queues a job when a website action needs the
// bot (a DM, a channel post, a hub refresh), and this service claims, performs and acks
// them. Delivery is at least once: a job claimed before a crash, or one whose ack never
// landed before a restart, goes back to the queue when its lease runs out and is performed
// again. Within one process a missed ack is remembered, so the job is only re-acked.

/** The ack a performed job is owed: done, or failed with its error message. */
export type BotJobPendingAck = { status: "done" } | { status: "failed"; error: string };

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

function truncateErrorMessage(message: string): string {
  if (message.length <= BOT_JOB_ERROR_MESSAGE_MAX) return message;
  const marker = "\n...(truncated)";
  return message.slice(0, BOT_JOB_ERROR_MESSAGE_MAX - marker.length) + marker;
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
 * A failure the next attempt may not repeat: the API unreachable or restarting, or Discord
 * answering 5xx or rate limited. Only the thrown error is classed, never its cause: a
 * handler wraps an error on purpose when a retry would repeat a side effect.
 */
export function isTemporaryJobError(err: unknown): boolean {
  if (isTransientApiError(err)) return true;
  if (err instanceof RateLimitError) return true;
  if (err instanceof DiscordAPIError || err instanceof HTTPError) {
    return err.status >= 500 || err.status === 429;
  }
  return false;
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
 * the lease, so the returning job is only acked.
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
    let result: BotJobPendingAck;
    if (!handler) {
      const message = `Bot job ${job.id} failed: unknown kind "${job.kind}". ` +
        "This bot has no handler for it.";
      logError("BotJobService", new Error(message));
      result = { status: "failed", error: message };
    } else {
      try {
        await handler(job.payload, surface);
        logInfo("BotJobService", `Performed ${label}.`);
        result = { status: "done" };
      } catch (err) {
        logError(`BotJobService.${job.kind}`, err);
        if (isTemporaryJobError(err) && job.attempts < BOT_JOB_MAX_ATTEMPTS) {
          // Left unacked: the lease hands it back and the next attempt runs it again.
          logInfo("BotJobService", `Left ${label} for the lease to retry (temporary error).`);
          continue;
        }
        result = { status: "failed", error: buildBotJobErrorMessage(job, err) };
      }
    }
    if (!(await sendAck(label, job.id, result, api))) state.pendingAcks.set(job.id, result);
  }
}

function sendAck(
  label: string,
  jobId: number,
  result: BotJobPendingAck,
  api: IBotJobApi,
): Promise<boolean> {
  return ack(label, () =>
    result.status === "done" ? api.done(jobId) : api.failed(jobId, result.error));
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
