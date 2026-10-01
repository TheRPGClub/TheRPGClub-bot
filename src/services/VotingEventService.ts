import type { Client } from "discord.js";
import VotingEvents, { type IVotingEvent } from "../classes/VotingEvents.js";
import { startTrackedInterval } from "../utilities/IntervalUtils.js";
import { logError, logInfo } from "../utilities/LogUtils.js";
import { handleVotingEvent, type VotingEventOutcome } from "./VotingEventHandlers.js";

// The API runs the GOTM / NR-GOTM round lifecycle and queues the Discord posts
// each step calls for; this service polls that outbox. Every poll is an API
// call against Neon-backed compute, and voting events come a few times a
// month, so a 5-minute poll (the old results sweep's pace) keeps posts close
// to their moment without keeping the database awake every minute.
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const CLAIM_LIMIT = 10;
// Failed handling attempts, counted here rather than from the API's claim
// count so time spent held back behind another failing event does not use
// them up. A claim is a 5-minute lease, so this is roughly an hour of retries
// before a failing post is given up on (and logged) rather than retried forever.
export const MAX_VOTING_EVENT_ATTEMPTS = 12;

let pollTimer: NodeJS.Timeout | null = null;
let currentlyPolling = false;

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
 * back, never posted again.
 */
export async function processVotingEvents(
  client: Client,
  events: IVotingEvent[],
  handle: Handle = handleVotingEvent,
  ack: Ack = VotingEvents.ack,
  state: IVotingEventDeliveryState = deliveryState,
): Promise<void> {
  const blockedRounds = new Set<number>();
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
    } catch (err) {
      logError("VotingEventService.ack", err);
      blockedRounds.add(event.roundNumber);
    }
  }
}

export function startVotingEventService(client: Client): void {
  if (pollTimer) {
    return;
  }

  const run = async (): Promise<void> => {
    if (currentlyPolling) {
      return;
    }
    currentlyPolling = true;
    try {
      const events = await VotingEvents.claim(CLAIM_LIMIT);
      await processVotingEvents(client, events);
    } catch (err) {
      logError("VotingEventService.poll", err);
    } finally {
      currentlyPolling = false;
    }
  };

  void run();
  pollTimer = startTrackedInterval(() => {
    void run();
  }, POLL_INTERVAL_MS);
}
