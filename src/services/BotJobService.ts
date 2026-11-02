import type { Client } from "discord.js";
import { BOT_JOB_API, type IBotJob, type IBotJobApi } from "../classes/BotJobs.js";
import {
  BOT_JOB_CLAIM_LIMIT,
  BOT_JOB_ERROR_BACKOFF_MS,
  BOT_JOB_ERROR_MESSAGE_MAX,
  BOT_JOB_POLL_INTERVAL_MS,
} from "../config/botJobs.js";
import { buildAnyErrorMessage } from "../utilities/ApiErrorUtils.js";
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
// them. Nothing is held only in memory: a job claimed before a crash goes back to the
// queue when its lease runs out.

/** What this process remembers between polls. */
export interface IBotJobDeliveryState {
  /**
   * Jobs performed whose done ack did not land. When the lease hands one back it is only
   * acked, never performed twice (a second DM, a second post).
   */
  delivered: Set<number>;
}

export function createBotJobDeliveryState(): IBotJobDeliveryState {
  return { delivered: new Set() };
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
 * acked failed with its error and the batch goes on; a kind with no handler fails
 * without running anything. An ack that does not land is logged and left to the lease.
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
    if (state.delivered.has(job.id)) {
      if (await ack(label, () => api.done(job.id))) state.delivered.delete(job.id);
      continue;
    }
    const handler = Object.hasOwn(handlers, job.kind) ? handlers[job.kind] : undefined;
    if (!handler) {
      const message = `Bot job ${job.id} failed: unknown kind "${job.kind}". ` +
        "This bot has no handler for it.";
      logError("BotJobService", new Error(message));
      await ack(label, () => api.failed(job.id, message));
      continue;
    }
    try {
      await handler(job.payload, surface);
    } catch (err) {
      logError(`BotJobService.${job.kind}`, err);
      await ack(label, () => api.failed(job.id, buildBotJobErrorMessage(job, err)));
      continue;
    }
    logInfo("BotJobService", `Performed ${label}.`);
    if (!(await ack(label, () => api.done(job.id)))) state.delivered.add(job.id);
  }
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
