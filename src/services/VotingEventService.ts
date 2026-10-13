import type { Client } from "discord.js";
import VotingEvents, {
  type IVotingEvent,
  type IVotingEventClaim,
} from "../classes/VotingEvents.js";
import { createScheduledTask, type IScheduledTask } from "../utilities/IntervalUtils.js";
import { logError, logInfo } from "../utilities/LogUtils.js";
import { handleVotingEvent, type VotingEventOutcome } from "./VotingEventHandlers.js";

// The API runs the GOTM / NR-GOTM round lifecycle and queues the Discord posts
// each step calls for; this service polls that outbox. Every poll is an API
// call against Neon-backed compute, which suspends after 5 idle minutes, so a
// fixed poll at that pace kept the database awake around the clock. Instead
// each claim's response says when the next event is due (next_poll_at) and the
// service sleeps until then. The cap is a safety net for changes the API cannot
// schedule ahead (a round re-dated outside the bot, automation switched on); the
// floor keeps the loop from spinning, short enough that a bot clock running a little
// ahead of the API's costs seconds, not a minute.
export const MIN_POLL_DELAY_MS = 10 * 1000;
export const MAX_POLL_DELAY_MS = 60 * 60 * 1000;
/**
 * A claim's lease: an event left unacked comes back this soon, so the service never
 * sleeps longer than this after claiming any. Also the wait after a failed claim (API
 * down, Neon waking).
 */
export const POLL_RETRY_DELAY_MS = 5 * 60 * 1000;
const CLAIM_LIMIT = 10;
// Failed handling attempts, counted here rather than from the API's claim
// count so time spent held back behind another failing event does not use
// them up. A claim is a 5-minute lease, so this is roughly an hour of retries
// before a failing post is given up on (and logged) rather than retried forever.
export const MAX_VOTING_EVENT_ATTEMPTS = 12;

let pollTask: IScheduledTask | null = null;

type Handle = (client: Client, event: IVotingEvent) => Promise<VotingEventOutcome>;
type Ack = (id: number) => Promise<void>;

/** What this process remembers about events between polls. */
export interface IVotingEventDeliveryState {
  /** Events whose post went out but whose ack has not landed yet. */
  delivered: Set<number>;
  /** Failed handling attempts per event. */
  failures: Map<number, number>;
}

const deliveryState: IVotingEventDeliveryState = { delivered: new Set(), failures: new Map() };

export function createVotingEventDeliveryState(): IVotingEventDeliveryState {
  return { delivered: new Set(), failures: new Map() };
}

/**
 * Handles claimed events in claim order (oldest first) and acks each one once
 * its post went out. When an event fails, the round's later events in the
 * batch are left unacked too, so a round's posts never land out of order (the
 * results before the vote panels, say); the leases hand them back later. An
 * event whose post went out but whose ack failed is only acked when it comes
 * back, never posted again. Resolves to whether every event was acked.
 */
export async function processVotingEvents(
  client: Client,
  events: IVotingEvent[],
  handle: Handle = handleVotingEvent,
  ack: Ack = VotingEvents.ack,
  state: IVotingEventDeliveryState = deliveryState,
): Promise<boolean> {
  const blockedRounds = new Set<number>();
  let acked = 0;
  for (const event of events) {
    if (blockedRounds.has(event.roundNumber)) {
      continue;
    }
    const label = `voting event ${event.id} (${event.rawKind}, Round ${event.roundNumber})`;
    if (!state.delivered.has(event.id)) {
      try {
        const outcome = await handle(client, event);
        state.delivered.add(event.id);
        state.failures.delete(event.id);
        logInfo("VotingEventService", `Handled ${label}: ${outcome}.`);
      } catch (err) {
        logError(`VotingEventService.${event.rawKind}`, err);
        const failures = (state.failures.get(event.id) ?? 0) + 1;
        if (failures < MAX_VOTING_EVENT_ATTEMPTS) {
          state.failures.set(event.id, failures);
          blockedRounds.add(event.roundNumber);
          continue;
        }
        // The round's later events still go out: holding them back forever
        // would lose them too. /admin voting-open reposts missing panels.
        state.failures.delete(event.id);
        logError(
          "VotingEventService",
          new Error(`Giving up on ${label} after ${failures} failed attempts.`),
        );
      }
    }
    try {
      await ack(event.id);
      state.delivered.delete(event.id);
      acked++;
    } catch (err) {
      logError("VotingEventService.ack", err);
      blockedRounds.add(event.roundNumber);
    }
  }
  return acked === events.length;
}

/**
 * How long to sleep after a claim that came back empty: until the API's next_poll_at,
 * within the floor and the cap, or the old fixed pace from an API that does not send one.
 */
export function nextPollDelayMs(claim: IVotingEventClaim, now: number = Date.now()): number {
  if (claim.nextPollAt === undefined) {
    return POLL_RETRY_DELAY_MS;
  }
  const untilDue = claim.nextPollAt ? claim.nextPollAt.getTime() - now : MAX_POLL_DELAY_MS;
  return Math.min(MAX_POLL_DELAY_MS, Math.max(MIN_POLL_DELAY_MS, untilDue));
}

async function pollOnce(client: Client): Promise<number> {
  const claim = await VotingEvents.claim(CLAIM_LIMIT);
  if (claim.events.length === 0) {
    return nextPollDelayMs(claim);
  }
  const allAcked = await processVotingEvents(client, claim.events);
  // The API's next_poll_at counted this batch's leases, since it was worked out before
  // the acks. Once every event is acked, claim again while Neon is still awake for an
  // up-to-date one (and whatever waited behind a full batch), rather than waking it when
  // those leases run out. Anything left unacked comes back on its lease.
  return allAcked
    ? MIN_POLL_DELAY_MS
    : Math.min(nextPollDelayMs(claim), POLL_RETRY_DELAY_MS);
}

export function startVotingEventService(client: Client): void {
  if (pollTask) {
    // Already running, or stopped with the other tracked timers: start() resumes it.
    pollTask.start();
    return;
  }
  pollTask = createScheduledTask({
    name: "VotingEventService.poll",
    task: () => pollOnce(client),
    retryDelayMs: POLL_RETRY_DELAY_MS,
  });
  pollTask.start();
}

/**
 * Claims now rather than at the scheduled time, after a bot action that changed what the
 * API will queue or when (an admin settling a tie, or moving a round's open or close).
 */
export function requestVotingEventPoll(): void {
  pollTask?.runSoon();
}
