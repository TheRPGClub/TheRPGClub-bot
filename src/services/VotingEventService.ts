import type { Client } from "discord.js";
import VotingEvents, { type IVotingEvent } from "../classes/VotingEvents.js";
import { logError, logInfo } from "../utilities/LogUtils.js";
import { handleVotingEvent, type VotingEventOutcome } from "./VotingEventHandlers.js";

// The API runs the GOTM / NR-GOTM round lifecycle and queues the Discord posts
// each step calls for; this service polls that outbox. The API sweeps once a
// minute, so polling faster buys nothing, and an idle cycle is one claim POST.
const POLL_INTERVAL_MS = 60 * 1000;
const CLAIM_LIMIT = 10;
// A claim is a 5-minute lease, so this is roughly an hour of retries before a
// failing post is given up on (and logged) rather than retried forever.
export const MAX_VOTING_EVENT_ATTEMPTS = 12;

let pollTimer: NodeJS.Timeout | null = null;
let currentlyPolling = false;

type Handle = (client: Client, event: IVotingEvent) => Promise<VotingEventOutcome>;
type Ack = (id: number) => Promise<void>;

/**
 * Handles claimed events in claim order (oldest first) and acks each one once
 * its post went out. When an event fails, the round's later events in the
 * batch are left unacked too, so a round's posts never land out of order (the
 * results before the vote panels, say); the leases hand them back later.
 */
export async function processVotingEvents(
  client: Client,
  events: IVotingEvent[],
  handle: Handle = handleVotingEvent,
  ack: Ack = VotingEvents.ack,
): Promise<void> {
  const blockedRounds = new Set<number>();
  for (const event of events) {
    if (blockedRounds.has(event.roundNumber)) {
      continue;
    }
    try {
      const outcome = await handle(client, event);
      await ack(event.id);
      logInfo(
        "VotingEventService",
        `Voting event ${event.id} (${event.kind}, Round ${event.roundNumber}): ${outcome}.`,
      );
    } catch (err) {
      logError(`VotingEventService.${event.kind}`, err);
      if (event.attempts >= MAX_VOTING_EVENT_ATTEMPTS) {
        logError(
          "VotingEventService",
          new Error(
            `Giving up on voting event ${event.id} (${event.kind}, Round ` +
              `${event.roundNumber}) after ${event.attempts} attempts.`,
          ),
        );
        await ack(event.id).catch((ackErr) => logError("VotingEventService.ack", ackErr));
        continue;
      }
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
  pollTimer = setInterval(() => {
    void run();
  }, POLL_INTERVAL_MS);
}
