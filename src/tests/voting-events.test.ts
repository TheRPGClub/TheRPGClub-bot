import test from "node:test";
import assert from "node:assert/strict";
import type { Client } from "discord.js";
import { mapVotingEventApiData, type IVotingEvent } from "../classes/VotingEvents.js";
import { mapVotingRoundApiData } from "../classes/VotingRounds.js";
import {
  MAX_VOTING_EVENT_ATTEMPTS,
  processVotingEvents,
} from "../services/VotingEventService.js";
import {
  buildNominationReminderText,
  buildTiePendingText,
  type VotingEventOutcome,
} from "../services/VotingEventHandlers.js";

const client = {} as Client;

function event(id: number, roundNumber: number, kind: string, attempts = 1): IVotingEvent {
  return {
    id,
    roundNumber,
    kind,
    payload: {},
    availableAt: new Date("2026-09-25T16:00:00.000Z"),
    expiresAt: null,
    attempts,
  };
}

function recorder(failing: Set<number> = new Set()) {
  const handled: number[] = [];
  const acked: number[] = [];
  return {
    handled,
    acked,
    handle: async (_client: Client, e: IVotingEvent): Promise<VotingEventOutcome> => {
      handled.push(e.id);
      if (failing.has(e.id)) {
        throw new Error(`post ${e.id} failed`);
      }
      return "delivered";
    },
    ack: async (id: number): Promise<void> => {
      acked.push(id);
    },
  };
}

test("mapVotingEventApiData reads a claimed event", () => {
  const mapped = mapVotingEventApiData({
    id: 7,
    round_number: 143,
    kind: "voting_closed",
    payload: { winners: { gotm: [12] }, ties: {} },
    available_at: "2026-09-28T04:00:00.000Z",
    expires_at: null,
    attempts: 2,
  });

  assert.equal(mapped.id, 7);
  assert.equal(mapped.roundNumber, 143);
  assert.equal(mapped.kind, "voting_closed");
  assert.deepEqual(mapped.payload, { winners: { gotm: [12] }, ties: {} });
  assert.equal(mapped.availableAt.toISOString(), "2026-09-28T04:00:00.000Z");
  assert.equal(mapped.expiresAt, null);
  assert.equal(mapped.attempts, 2);
});

test("processVotingEvents handles and acks events in claim order", async () => {
  const r = recorder();
  await processVotingEvents(
    client,
    [event(1, 143, "voting_closed"), event(2, 143, "round_decided")],
    r.handle,
    r.ack,
  );

  assert.deepEqual(r.handled, [1, 2]);
  assert.deepEqual(r.acked, [1, 2]);
});

test("processVotingEvents holds a round's later events back when one fails", async () => {
  const r = recorder(new Set([1]));
  await processVotingEvents(
    client,
    [event(1, 143, "voting_closed"), event(2, 143, "round_decided"), event(3, 144, "voting_opened")],
    r.handle,
    r.ack,
  );

  // Round 143's decision waits for its results; round 144 is unaffected.
  assert.deepEqual(r.handled, [1, 3]);
  assert.deepEqual(r.acked, [3]);
});

test("processVotingEvents gives up on an event after the attempt limit", async () => {
  const r = recorder(new Set([1]));
  await processVotingEvents(
    client,
    [event(1, 143, "voting_closed", MAX_VOTING_EVENT_ATTEMPTS), event(2, 143, "round_decided")],
    r.handle,
    r.ack,
  );

  assert.deepEqual(r.handled, [1, 2]);
  assert.deepEqual(r.acked, [1, 2]);
});

test("buildNominationReminderText points at the vote with Discord timestamps", () => {
  const text = buildNominationReminderText(new Date("2026-10-30T16:00:00.000Z"));

  assert.match(text, /^Voting is <t:1793376000:R> \(<t:1793376000:D>\)!/);
  assert.match(text, /Please nominate games/);
});

test("buildTiePendingText lists each tied category's games", () => {
  const round = mapVotingRoundApiData({
    round_number: 143,
    month_year: "October 2026",
    voting_opens_at: "2026-09-25T16:00:00.000Z",
    voting_closes_at: "2026-09-28T03:59:59.999Z",
    closed_at: "2026-09-28T04:00:00.000Z",
    decided_at: null,
    phase: "tie",
    nominations_open: false,
    voting_open: false,
    voting_ended: true,
    pending_ties: {
      gotm: [
        { game_id: 12, title: "Saltmarsh Requiem", cover_url: null },
        { game_id: 34, title: "Verdant Hollow", cover_url: null },
      ],
    },
  });

  const text = buildTiePendingText(round);

  assert.match(text, /^## Round 143 voting ended in a tie/);
  assert.match(text, /- GOTM: \*\*Saltmarsh Requiem\*\*, \*\*Verdant Hollow\*\*/);
  assert.doesNotMatch(text, /NR-GOTM/);
});
