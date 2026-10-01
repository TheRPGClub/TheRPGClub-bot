import test from "node:test";
import assert from "node:assert/strict";
import type { Client } from "discord.js";
import {
  mapVotingEventApiData,
  type IVotingEvent,
  type VotingEventKind,
} from "../classes/VotingEvents.js";
import {
  createVotingEventDeliveryState,
  MAX_VOTING_EVENT_ATTEMPTS,
  processVotingEvents,
} from "../services/VotingEventService.js";
import {
  buildNominationReminderText,
  type VotingEventOutcome,
} from "../services/VotingEventHandlers.js";

const client = {} as Client;

function event(id: number, roundNumber: number, kind: VotingEventKind, attempts = 1): IVotingEvent {
  return {
    id,
    roundNumber,
    kind,
    rawKind: kind,
    payload: {},
    availableAt: new Date("2026-09-25T16:00:00.000Z"),
    expiresAt: null,
    attempts,
  };
}

function recorder(failing: Set<number> = new Set(), failingAcks: Set<number> = new Set()) {
  const handled: number[] = [];
  const acked: number[] = [];
  return {
    handled,
    acked,
    state: createVotingEventDeliveryState(),
    handle: async (_client: Client, e: IVotingEvent): Promise<VotingEventOutcome> => {
      handled.push(e.id);
      if (failing.has(e.id)) {
        throw new Error(`post ${e.id} failed`);
      }
      return "delivered";
    },
    ack: async (id: number): Promise<void> => {
      if (failingAcks.delete(id)) {
        throw new Error(`ack ${id} failed`);
      }
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
    r.state,
  );

  assert.deepEqual(r.handled, [1, 2]);
  assert.deepEqual(r.acked, [1, 2]);
});

test("processVotingEvents holds a round's later events back when one fails", async () => {
  const r = recorder(new Set([1]));
  await processVotingEvents(
    client,
    [
      event(1, 143, "voting_closed"),
      event(2, 143, "round_decided"),
      event(3, 144, "voting_opened"),
    ],
    r.handle,
    r.ack,
    r.state,
  );

  // Round 143's decision waits for its results; round 144 is unaffected.
  assert.deepEqual(r.handled, [1, 3]);
  assert.deepEqual(r.acked, [3]);
});

test("processVotingEvents gives up on an event after the attempt limit", async () => {
  const r = recorder(new Set([1]));
  r.state.failures.set(1, MAX_VOTING_EVENT_ATTEMPTS - 1);
  await processVotingEvents(
    client,
    [event(1, 143, "voting_closed"), event(2, 143, "round_decided")],
    r.handle,
    r.ack,
    r.state,
  );

  assert.deepEqual(r.handled, [1, 2]);
  assert.deepEqual(r.acked, [1, 2]);
});

test("processVotingEvents counts its own failures, not claims spent held back", async () => {
  const r = recorder(new Set([2]));
  await processVotingEvents(
    client,
    [event(2, 143, "round_decided", MAX_VOTING_EVENT_ATTEMPTS + 3)],
    r.handle,
    r.ack,
    r.state,
  );

  assert.deepEqual(r.acked, []);
  assert.equal(r.state.failures.get(2), 1);
});

test("processVotingEvents acks without reposting when only the ack failed", async () => {
  const r = recorder(new Set(), new Set([1]));
  const batch = [event(1, 143, "voting_closed"), event(2, 143, "round_decided")];
  await processVotingEvents(client, batch, r.handle, r.ack, r.state);

  // The post went out but the ack failed: the round waits for the next claim.
  assert.deepEqual(r.handled, [1]);
  assert.deepEqual(r.acked, []);

  await processVotingEvents(client, batch, r.handle, r.ack, r.state);

  assert.deepEqual(r.handled, [1, 2]);
  assert.deepEqual(r.acked, [1, 2]);
});

test("mapVotingEventApiData marks a kind this bot does not know as unknown", () => {
  const mapped = mapVotingEventApiData({
    id: 8,
    round_number: 143,
    kind: "something_new",
    payload: null,
    available_at: "2026-09-28T04:00:00.000Z",
    expires_at: null,
    attempts: 1,
  });

  assert.equal(mapped.kind, "unknown");
  assert.equal(mapped.rawKind, "something_new");
});

test("buildNominationReminderText points at the vote with Discord timestamps", () => {
  const text = buildNominationReminderText(143, new Date("2026-10-30T16:00:00.000Z"));

  assert.match(text, /^### 📝 Round 143 nominations are open/);
  assert.match(text, /Voting opens <t:1793376000:R> \(<t:1793376000:F>\)\./);
  assert.match(text, /Nominate games with .*gotm nominate.* so they make the ballot\./);
});
