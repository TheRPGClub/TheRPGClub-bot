import test from "node:test";
import assert from "node:assert/strict";
import { Collection, type Client } from "discord.js";
import { ADMIN_CHANNEL_ID, ANNOUNCEMENT_CHANNEL_ID } from "../config/channels.js";
import { persistedSessionStore } from "../services/PersistedInteractionSessionStore.js";
import {
  createSandboxDataSource,
  deliverSandboxOutbox,
  endSandbox,
  loadSandbox,
  mutateSandbox,
  SANDBOX_ENDED_MESSAGE,
  startSandbox,
} from "../services/VotingSandbox.js";
import {
  closeSandboxVoting,
  createSandboxState,
  openSandboxVoting,
  queueSandboxEvent,
  seedSandboxOutcome,
} from "../services/VotingSandboxModel.js";

interface ISent {
  channelId: string;
  json: string;
}

/** A client whose every channel accepts sends, recorded in order. */
function fakeClient(): { client: Client; sent: ISent[]; scheduled: string[] } {
  const sent: ISent[] = [];
  const scheduled: string[] = [];
  const guild = {
    id: "guild",
    scheduledEvents: {
      fetch: async () => new Collection<string, { name: string }>(),
      create: async (options: { name: string }) => {
        scheduled.push(options.name);
        return options;
      },
    },
  };
  const client = {
    channels: {
      fetch: async (channelId: string) => ({
        guild,
        isTextBased: () => true,
        send: async (payload: { components?: Array<{ toJSON?: () => unknown }> }) => {
          const components = (payload.components ?? []).map((component) =>
            typeof component.toJSON === "function" ? component.toJSON() : component,
          );
          sent.push({ channelId, json: JSON.stringify(components) });
          return {};
        },
      }),
    },
  } as unknown as Client;
  return { client, sent, scheduled };
}

/** An in-memory stand-in for the wizard session table, storing state as JSON. */
function mockStore(t: test.TestContext): Map<string, string> {
  const rows = new Map<string, string>();
  t.mock.method(persistedSessionStore, "save", async (params: {
    ownerId: string;
    state: unknown;
  }) => {
    rows.set(params.ownerId, JSON.stringify(params.state));
    return `row-${params.ownerId}`;
  });
  t.mock.method(persistedSessionStore, "load", async (params: { ownerId: string }) => {
    const raw = rows.get(params.ownerId);
    return raw ? { rowId: `row-${params.ownerId}`, state: JSON.parse(raw) } : null;
  });
  t.mock.method(persistedSessionStore, "remove", async (rowId: string) => {
    rows.delete(rowId.replace(/^row-/, ""));
  });
  return rows;
}

let ownerSeq = 100;
function nextOwner(): string {
  ownerSeq += 1;
  return String(ownerSeq);
}

async function startOpenSandbox(ownerId: string, id = "cafe01"): Promise<void> {
  const state = createSandboxState({ id, ownerId, now: new Date() });
  await startSandbox(state);
  await mutateSandbox(ownerId, (current) => openSandboxVoting(current, new Date()));
}

test("voting_opened posts sandbox panels to announcements through the live handler", async (t) => {
  mockStore(t);
  const { client, sent } = fakeClient();
  const ownerId = nextOwner();
  await startOpenSandbox(ownerId);

  const lines = await deliverSandboxOutbox(client, ownerId);
  assert.deepEqual(lines, ["`voting_opened`: delivered."]);
  assert.equal(sent.length, 2);
  assert.ok(sent.every((message) => message.channelId === ANNOUNCEMENT_CHANNEL_ID));
  for (const message of sent) {
    assert.match(message.json, new RegExp(`vsbx-cast:${ownerId}:cafe01:`));
    assert.match(message.json, /VOTING SANDBOX/);
    assert.doesNotMatch(message.json, /"vote-cast:/);
  }
  assert.equal((await loadSandbox(ownerId))?.outbox.length, 0);
});

test("a tie posts results, prompts the admins, and breaking it decides the round", async (t) => {
  mockStore(t);
  const { client, sent, scheduled } = fakeClient();
  const ownerId = nextOwner();
  await startOpenSandbox(ownerId, "beef02");
  await deliverSandboxOutbox(client, ownerId);
  sent.length = 0;

  await mutateSandbox(ownerId, (state) => {
    const now = new Date();
    seedSandboxOutcome(state, "gotm", "tie", now);
    seedSandboxOutcome(state, "nr-gotm", "no-votes", now);
    closeSandboxVoting(state, now);
  });
  const lines = await deliverSandboxOutbox(client, ownerId);
  assert.deepEqual(lines, ["`voting_closed`: delivered.", "`tie_pending`: delivered."]);

  const results = sent.filter((message) => message.channelId === ANNOUNCEMENT_CHANNEL_ID);
  assert.match(results[0]?.json ?? "", /TEST MODE/);
  assert.ok(results.some((message) => /ends in a tie between/.test(message.json)));
  const prompt = sent.find((message) => message.channelId === ADMIN_CHANNEL_ID);
  assert.match(prompt?.json ?? "", new RegExp(`vsbx-tie:${ownerId}:beef02:gotm`));

  const state = await loadSandbox(ownerId);
  const pick = state?.pendingTies.gotm?.[0]?.gameId ?? 0;
  const source = createSandboxDataSource({ ownerId, sandboxId: "beef02" });
  const round = await source.resolveTie(state?.roundNumber ?? 0, "gotm", [pick]);
  assert.equal(round.phase, "decided");

  sent.length = 0;
  assert.deepEqual(await deliverSandboxOutbox(client, ownerId), [
    "`round_decided`: delivered.",
  ]);
  assert.equal(sent[0]?.channelId, ADMIN_CHANNEL_ID);
  assert.match(sent[0]?.json ?? "", /Sandbox Round 999 decided/);
  assert.deepEqual(scheduled.length, 1);
  assert.match(scheduled[0] ?? "", /^Round 1000 Vote/);
});

test("a hand-fired event whose phase has passed is skipped, not posted", async (t) => {
  mockStore(t);
  const { client, sent } = fakeClient();
  const ownerId = nextOwner();
  await startOpenSandbox(ownerId);
  await deliverSandboxOutbox(client, ownerId);
  sent.length = 0;

  await mutateSandbox(ownerId, (state) => {
    queueSandboxEvent(state, "nomination_reminder_5d");
    queueSandboxEvent(state, "tie_pending");
  });
  assert.deepEqual(await deliverSandboxOutbox(client, ownerId), [
    "`nomination_reminder_5d`: skipped.",
    "`tie_pending`: skipped.",
  ]);
  assert.equal(sent.length, 0);
});

test("a failed post stays queued and holds back the round's later events", async (t) => {
  mockStore(t);
  const { client } = fakeClient();
  const ownerId = nextOwner();
  await startOpenSandbox(ownerId);
  const silent = {
    channels: { fetch: async () => null },
  } as unknown as Client;
  await mutateSandbox(ownerId, (state) => queueSandboxEvent(state, "voting_closed"));

  const lines = await deliverSandboxOutbox(silent, ownerId);
  assert.match(lines[0] ?? "", /`voting_opened`: failed, left queued/);
  assert.match(lines.at(-1) ?? "", /2 event\(s\) still queued/);
  assert.equal((await loadSandbox(ownerId))?.outbox.length, 2);

  const retried = await deliverSandboxOutbox(client, ownerId);
  assert.equal(retried[0], "`voting_opened`: delivered.");
});

test("panels from a replaced or ended sandbox refuse votes", async (t) => {
  mockStore(t);
  const ownerId = nextOwner();
  await startOpenSandbox(ownerId, "0ld001");
  const stale = createSandboxDataSource({ ownerId, sandboxId: "0ld001" });
  await startOpenSandbox(ownerId, "0e0002");

  await assert.rejects(stale.getRound(999), new RegExp(SANDBOX_ENDED_MESSAGE));
  await assert.rejects(stale.castVote("gotm", 999, "u1", 1), new RegExp(SANDBOX_ENDED_MESSAGE));

  assert.equal(await endSandbox(ownerId), true);
  const current = createSandboxDataSource({ ownerId, sandboxId: "0e0002" });
  await assert.rejects(current.getRound(999), new RegExp(SANDBOX_ENDED_MESSAGE));
});

test("a sandbox restored from the persisted row keeps taking votes", async (t) => {
  const rows = mockStore(t);
  const ownerId = nextOwner();
  const state = createSandboxState({ id: "a11ce5", ownerId, now: new Date() });
  openSandboxVoting(state, new Date());
  // Written by an earlier process: nothing in this one's memory.
  rows.set(ownerId, JSON.stringify(state));

  const source = createSandboxDataSource({ ownerId, sandboxId: "a11ce5" });
  const nominationId = state.nominations.gotm[0]?.id ?? 0;
  const result = await source.castVote("gotm", 999, "u1", nominationId);
  assert.equal(result?.action, "voted");
  const saved = JSON.parse(rows.get(ownerId) ?? "{}") as { votes: unknown[] };
  assert.equal(saved.votes.length, 1);
});

test("a step that throws partway, or fails to save, changes nothing", async (t) => {
  mockStore(t);
  const ownerId = nextOwner();
  await startOpenSandbox(ownerId);

  await assert.rejects(
    mutateSandbox(ownerId, (state) => {
      seedSandboxOutcome(state, "gotm", "winner", new Date());
      seedSandboxOutcome(state, "nr-gotm", "three-way-tie", new Date());
      throw new Error("second category refused");
    }),
    /second category refused/,
  );
  assert.equal((await loadSandbox(ownerId))?.votes.length, 0);

  t.mock.method(persistedSessionStore, "save", async () => {
    throw new Error("API down");
  });
  await assert.rejects(
    mutateSandbox(ownerId, (state) => seedSandboxOutcome(state, "gotm", "winner", new Date())),
    /API down/,
  );
  assert.equal((await loadSandbox(ownerId))?.votes.length, 0);
});
