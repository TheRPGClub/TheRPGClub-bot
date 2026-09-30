import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "discord.js";

import {
  formatPreviewReadyAnnouncement,
  parsePreviewReadyAnnouncement,
} from "../config/previewMode.js";
import {
  checkAnnouncementSource,
  type IAnnouncementSource,
} from "../conductor/ConductorAccess.js";
import type { IConductorSettings } from "../conductor/ConductorConfig.js";
import { setConductorRuntime } from "../conductor/ConductorRuntime.js";
import type { IConductorRun } from "../conductor/ConductorState.js";
import type { GitHubPullClient, IPullRequestInfo } from "../conductor/GitHubPullClient.js";
import { startRunFromAnnouncement } from "../conductor/conductor.command.js";

const SHA = "a606242f0c1d2e3b4a5968778695a4b3c2d1e0f9";
const OTHER_SHA = "b606242f0c1d2e3b4a5968778695a4b3c2d1e0f9";
const PREVIEW_BOT = "800";
const SELF = "900";
const GUILD = "500";
const CHANNEL = "700";
const MIRROR = "701";

test("the announcement round-trips through the shared format", () => {
  const text = formatPreviewReadyAnnouncement(1350, SHA);
  assert.deepEqual(parsePreviewReadyAnnouncement(text), { pr: 1350, sha: SHA });
});

const NOT_ANNOUNCEMENTS: [string, string][] = [
  ["other text", "Startup sequence completed."],
  ["a short sha", "Ready for testing PR #1350 at a606242"],
  ["PR zero", `Ready for testing PR #0 at ${SHA}`],
  ["trailing text", `Ready for testing PR #1350 at ${SHA} please`],
  ["an uppercase sha", `Ready for testing PR #1350 at ${SHA.toUpperCase()}`],
];

for (const [name, content] of NOT_ANNOUNCEMENTS) {
  test(`parsing rejects ${name}`, () => {
    assert.equal(parsePreviewReadyAnnouncement(content), null);
  });
}

const SOURCE_CONTEXT = {
  previewBotId: PREVIEW_BOT,
  selfId: SELF,
  testGuildId: GUILD,
  testChannelId: CHANNEL,
};

function source(overrides: Partial<IAnnouncementSource> = {}): IAnnouncementSource {
  return { authorId: PREVIEW_BOT, webhookId: null, guildId: GUILD, channelId: CHANNEL,
    ...overrides };
}

test("trusts the preview bot in the test channel", () => {
  assert.deepEqual(checkAnnouncementSource(source(), SOURCE_CONTEXT), { allowed: true });
});

const UNTRUSTED: [string, IAnnouncementSource][] = [
  ["another user", source({ authorId: "100" })],
  ["the conductor itself", source({ authorId: SELF })],
  ["a webhook posting under the preview bot's ID", source({ webhookId: "w1" })],
  ["the preview bot in another guild", source({ guildId: "501" })],
  ["the preview bot in a DM", source({ guildId: null })],
  ["the preview bot in another channel", source({ channelId: "702" })],
];

for (const [name, candidate] of UNTRUSTED) {
  test(`does not trust ${name}`, () => {
    assert.equal(checkAnnouncementSource(candidate, SOURCE_CONTEXT).allowed, false);
  });
}

test("trusts no one when the preview bot ID is empty", () => {
  const context = { ...SOURCE_CONTEXT, previewBotId: "" };
  assert.equal(checkAnnouncementSource(source({ authorId: "" }), context).allowed, false);
});

const FENCE = "```";
const PLAN = ["## Testing", "", "### Step 1: Ping", FENCE, "/ping", FENCE,
  "Expected: \"Pong\"", "Ephemeral: no", ""].join("\n");

interface IHarness {
  statePath: string;
  sent: unknown[];
  prReads: number;
}

async function useRuntime(headSha: string): Promise<IHarness> {
  const dir = await mkdtemp(join(tmpdir(), "conductor-auto-start-"));
  const harness: IHarness = { statePath: join(dir, "state.json"), sent: [], prReads: 0 };
  const github = {
    getPullRequest: async (): Promise<IPullRequestInfo> => {
      harness.prReads += 1;
      return { number: 1350, state: "open", headSha, body: PLAN, htmlUrl: "https://x.test" };
    },
    postComment: async (): Promise<string> => "https://example.test/comment",
  } as unknown as GitHubPullClient;
  const settings = {
    testGuildId: GUILD,
    testChannelId: CHANNEL,
    mirrorChannelId: MIRROR,
    allowedUserId: "100",
    previewBotId: PREVIEW_BOT,
    statePath: harness.statePath,
  } as IConductorSettings;
  setConductorRuntime({ settings, github });
  return harness;
}

function fakeMessage(harness: IHarness, authorId: string, content: string): Message {
  const channel = {
    name: "dev",
    guildId: GUILD,
    isTextBased: (): boolean => true,
    isDMBased: (): boolean => false,
    isSendable: (): boolean => true,
    permissionsFor: () => ({ has: (): boolean => true }),
    async send(payload: unknown): Promise<{ createdTimestamp: number }> {
      harness.sent.push(payload);
      return { createdTimestamp: 1000 };
    },
  };
  const client = {
    user: { id: SELF },
    channels: { fetch: async () => channel },
  };
  return {
    id: "4242",
    content,
    author: { id: authorId, bot: true },
    webhookId: null,
    guildId: GUILD,
    channelId: CHANNEL,
    createdTimestamp: 999,
    client,
    channel,
    inGuild: (): boolean => true,
  } as unknown as Message;
}

async function readRun(path: string): Promise<IConductorRun | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as IConductorRun;
  } catch {
    return null;
  }
}

const READY = formatPreviewReadyAnnouncement(1350, SHA);

test("the preview bot's announcement starts a run in the dev channel", async () => {
  const harness = await useRuntime(SHA);
  await startRunFromAnnouncement(fakeMessage(harness, PREVIEW_BOT, READY));

  const run = await readRun(harness.statePath);
  assert.equal(run?.runId, "4242");
  assert.equal(run?.pr, 1350);
  assert.equal(run?.channelId, CHANNEL);
  assert.equal(run?.status, "running");
  assert.equal(run?.windowStart, 1000);
  assert.equal(harness.sent.length, 2);
});

test("the announcement text from anyone else starts nothing", async () => {
  const harness = await useRuntime(SHA);
  await startRunFromAnnouncement(fakeMessage(harness, "100", READY));

  assert.equal(harness.prReads, 0);
  assert.equal(await readRun(harness.statePath), null);
  assert.deepEqual(harness.sent, []);
});

test("an announcement for a stale head starts nothing", async () => {
  const harness = await useRuntime(OTHER_SHA);
  await startRunFromAnnouncement(fakeMessage(harness, PREVIEW_BOT, READY));

  assert.equal(await readRun(harness.statePath), null);
  assert.equal(harness.sent.length, 1);
});

test("a redeploy of a PR with a run in progress starts no second run", async () => {
  const harness = await useRuntime(SHA);
  const existing: IConductorRun = {
    runId: "1111",
    pr: 1350,
    headSha: SHA,
    steps: [],
    channelId: CHANNEL,
    current: 0,
    windowStart: 1,
    results: [],
    status: "running",
  };
  await writeFile(harness.statePath, JSON.stringify(existing));

  await startRunFromAnnouncement(fakeMessage(harness, PREVIEW_BOT, READY));

  const run = await readRun(harness.statePath);
  assert.equal(run?.runId, "1111");
  assert.equal(run?.status, "running");
  assert.equal(harness.sent.length, 1);
});
