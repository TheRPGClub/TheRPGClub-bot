import assert from "node:assert/strict";
import test from "node:test";
import { DiscordAPIError, RESTJSONErrorCodes, type Client } from "discord.js";

import type { IBotJob, IBotJobApi } from "../classes/BotJobs.js";
import { BOT_DEV_CHANNEL_ID, PATCH_NOTES_CHANNEL_ID } from "../config/channels.js";
import { FEATURE_COMMANDS, POST_FEATURE_KEYS } from "../config/featureGate.js";
import { patchPageUrl } from "../config/website.js";
import type { IComponentsV2View } from "../functions/ComponentsV2Utils.js";
import type { FeatureState } from "../functions/FeatureGate.js";
import { BOT_JOB_HANDLERS, type IBotJobSurface } from "../services/BotJobHandlers.js";
import { processBotJobs } from "../services/BotJobService.js";
import {
  buildPatchPost,
  createPatchPostDeps,
  formatPatchDate,
  PATCH_POST_BUTTON_LABEL,
  type IPatchMessage,
  type IPatchPostDeps,
} from "../services/PatchPost.js";

// The Patch posts (spec api#510, bot#1592): the patch_post, patch_edit and patch_delete
// jobs, their Feature routing, the button, that they ping nobody, and the message ids they
// report back to the API.

type Ack =
  | { id: number; status: "done"; resultText?: string }
  | { id: number; status: "failed"; error: string };

function fakeJobApi(): IBotJobApi & { acks: Ack[] } {
  const acks: Ack[] = [];
  return {
    acks,
    claim: async () => [],
    done: async (id, resultText) => {
      acks.push(
        resultText === undefined ? { id, status: "done" } : { id, status: "done", resultText },
      );
    },
    failed: async (id, error) => {
      acks.push({ id, status: "failed", error });
    },
  };
}

const BODY = "Patch intro.\n## New\n- Patch Notes, on the site and in Discord";
const POSTED_IN = "1466475139402170450";
const STORED: IPatchMessage = { channelId: "555000000000000001", messageId: "777" };

function postPayload(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 4,
    title: "The Franchise update",
    cut_body: BODY,
    published_at: "2026-11-26T15:00:00Z",
    feature_key: "patch_notes",
    ...extra,
  };
}

function editPayload(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return postPayload({
    channel_id: STORED.channelId,
    message_id: STORED.messageId,
    ...extra,
  });
}

function deletePayload(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 4,
    channel_id: STORED.channelId,
    message_id: STORED.messageId,
    feature_key: "patch_notes",
    ...extra,
  };
}

function unknownMessage(): DiscordAPIError {
  return new DiscordAPIError(
    { code: RESTJSONErrorCodes.UnknownMessage, message: "Unknown Message" },
    RESTJSONErrorCodes.UnknownMessage,
    404,
    "PATCH",
    "https://discord.com/api/v10/channels/1/messages/777",
    { body: undefined, files: undefined },
  );
}

interface IFakeDeps extends IPatchPostDeps {
  sent: { channelId: string; post: IComponentsV2View }[];
  edited: { message: IPatchMessage; post: IComponentsV2View }[];
  deleted: IPatchMessage[];
  recorded: { patchNumber: number; message: IPatchMessage }[];
  cleared: { patchNumber: number; messageId: string }[];
}

function fakeDeps(options: { missing?: boolean } = {}): IFakeDeps {
  const deps: IFakeDeps = {
    sent: [],
    edited: [],
    deleted: [],
    recorded: [],
    cleared: [],
    sendPost: async (channelId, post) => {
      deps.sent.push({ channelId, post });
      return "888";
    },
    editPost: async (message, post) => {
      if (options.missing) throw unknownMessage();
      deps.edited.push({ message, post });
    },
    deletePost: async (message) => {
      if (options.missing) throw unknownMessage();
      deps.deleted.push(message);
    },
    recordPost: async (patchNumber, message) => {
      deps.recorded.push({ patchNumber, message });
    },
    clearPost: async (patchNumber, messageId) => {
      deps.cleared.push({ patchNumber, messageId });
    },
  };
  return deps;
}

async function run(
  kind: string,
  jobPayload: Record<string, unknown>,
  deps: IPatchPostDeps,
  state: FeatureState | null = "live",
): Promise<Ack[]> {
  const api = fakeJobApi();
  const surface = { patchNotes: deps, featureState: async () => state } as unknown as
    IBotJobSurface;
  const job: IBotJob = { id: 9, kind, payload: jobPayload, attempts: 1, requestedByUserId: null };
  await processBotJobs([job], BOT_JOB_HANDLERS, surface, api);
  return api.acks;
}

type Json = Record<string, unknown>;

function textsOf(view: IComponentsV2View): string[] {
  return (view.components as unknown as Json[])
    .filter((c) => typeof c.content === "string")
    .map((c) => c.content as string);
}

function buttonsOf(view: IComponentsV2View): Json[] {
  return (view.components as unknown as Json[])
    .flatMap((c) => (Array.isArray(c.components) ? c.components as Json[] : []));
}

test("patch_notes is a post Feature key and gates /patch-notes", () => {
  assert.equal(POST_FEATURE_KEYS.patchNotes, "patch_notes");
  assert.equal(FEATURE_COMMANDS["patch-notes"], "patch_notes");
});

test("the post: heading, the cut markdown, a divider, and one link button", () => {
  const view = buildPatchPost({
    number: 4,
    title: "The Franchise update",
    cutBody: BODY,
    publishedAt: "2026-11-26T15:00:00Z",
  });

  assert.deepEqual(textsOf(view), [
    "## Patch 4 · The Franchise update\n-# 26 November 2026",
    BODY,
  ]);
  const types = (view.components as unknown as Json[]).map((c) => c.type);
  assert.deepEqual(types, [10, 10, 14, 1]);
  const buttons = buttonsOf(view);
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0]?.label, PATCH_POST_BUTTON_LABEL);
  assert.equal(buttons[0]?.label, "Read the full Patch ↗");
  assert.equal(buttons[0]?.url, patchPageUrl(4));
  assert.match(String(buttons[0]?.url), /\/patch-notes\/4$/);
});

test("the post pings nobody", () => {
  const view = buildPatchPost({ number: 4, title: null, cutBody: "<@1> @everyone",
    publishedAt: null });
  assert.deepEqual(view.allowedMentions, { parse: [] });
});

test("an untitled Patch is headed by its number; the title is escaped", () => {
  const untitled = buildPatchPost({ number: 5, title: null, cutBody: BODY, publishedAt: null });
  assert.equal(textsOf(untitled)[0], "## Patch 5");
  const starred = buildPatchPost({ number: 6, title: "*Big* one", cutBody: BODY,
    publishedAt: null });
  assert.equal(textsOf(starred)[0], "## Patch 6 · \\*Big\\* one");
});

test("a body at Discord's limit is posted whole, without the heading", () => {
  const long = "x".repeat(4000);
  const view = buildPatchPost({ number: 4, title: "T", cutBody: long, publishedAt: null });
  assert.deepEqual(textsOf(view), [long]);
});

test("the date reads as on the website, in the club's time zone", () => {
  // 02:00 UTC on 27 November is still 26 November in New York.
  assert.equal(formatPatchDate("2026-11-27T02:00:00Z"), "26 November 2026");
});

test("patch_post when Live posts in #patch-notes and records the message id", async () => {
  const deps = fakeDeps();
  const acks = await run("patch_post", postPayload(), deps);

  assert.equal(acks[0]?.status, "done", JSON.stringify(acks));
  assert.deepEqual(deps.sent.map((s) => s.channelId), [PATCH_NOTES_CHANNEL_ID]);
  assert.deepEqual(deps.recorded, [{
    patchNumber: 4,
    message: { channelId: PATCH_NOTES_CHANNEL_ID, messageId: "888" },
  }]);
  assert.equal(buttonsOf(deps.sent[0]!.post)[0]?.url, patchPageUrl(4));
  assert.deepEqual(deps.sent[0]?.post.allowedMentions, { parse: [] });
});

test("patch_post in Preview posts in bot-dev and records that channel", async () => {
  const deps = fakeDeps();
  const acks = await run("patch_post", postPayload(), deps, "preview");

  assert.equal(acks[0]?.status, "done", JSON.stringify(acks));
  assert.deepEqual(deps.sent.map((s) => s.channelId), [BOT_DEV_CHANNEL_ID]);
  assert.deepEqual(deps.recorded[0]?.message, { channelId: BOT_DEV_CHANNEL_ID, messageId: "888" });
});

test("patch_post with the Feature Off acks without posting", async () => {
  const deps = fakeDeps();
  const acks = await run("patch_post", postPayload(), deps, "off");

  assert.deepEqual(acks, [{
    id: 9,
    status: "done",
    resultText: "Not posted: the patch_notes Feature is Off.",
  }]);
  assert.deepEqual(deps.sent, []);
  assert.deepEqual(deps.recorded, []);
});

test("patch_post whose record fails is failed for good, naming the message", async (t) => {
  t.mock.method(console, "error", () => undefined);
  t.mock.method(console, "log", () => undefined);
  const deps = fakeDeps();
  deps.recordPost = async () => {
    throw new Error("API down");
  };
  const acks = await run("patch_post", postPayload(), deps);

  assert.equal(acks[0]?.status, "failed");
  assert.match(acks[0]?.status === "failed" ? acks[0].error : "", /it is posted: .*\/888/);
  assert.equal(deps.sent.length, 1);
});

test("patch_post without cut_body fails the job", async (t) => {
  t.mock.method(console, "error", () => undefined);
  t.mock.method(console, "log", () => undefined);
  const deps = fakeDeps();
  const acks = await run("patch_post", postPayload({ cut_body: null }), deps);

  assert.equal(acks[0]?.status, "failed");
  assert.deepEqual(deps.sent, []);
});

for (const state of ["live", "preview"] as const) {
  test(`patch_edit (${state}) edits the message in its stored channel and records it`,
    async () => {
      const deps = fakeDeps();
      const acks = await run("patch_edit", editPayload({ cut_body: "Edited." }), deps, state);

      assert.equal(acks[0]?.status, "done", JSON.stringify(acks));
      assert.deepEqual(deps.edited.map((e) => e.message), [STORED]);
      assert.deepEqual(textsOf(deps.edited[0]!.post).at(-1), "Edited.");
      assert.deepEqual(deps.edited[0]?.post.allowedMentions, { parse: [] });
      assert.equal(buttonsOf(deps.edited[0]!.post)[0]?.url, patchPageUrl(4));
      assert.deepEqual(deps.recorded, [{ patchNumber: 4, message: STORED }]);
      assert.deepEqual(deps.sent, []);
    });
}

test("patch_edit with the Feature Off edits nothing", async () => {
  const deps = fakeDeps();
  const acks = await run("patch_edit", editPayload(), deps, "off");

  assert.equal(acks[0]?.status, "done");
  assert.deepEqual(deps.edited, []);
  assert.deepEqual(deps.recorded, []);
});

test("patch_edit of a message deleted in Discord clears the post and fails", async (t) => {
  t.mock.method(console, "error", () => undefined);
  t.mock.method(console, "log", () => undefined);
  const deps = fakeDeps({ missing: true });
  const acks = await run("patch_edit", editPayload(), deps);

  assert.equal(acks[0]?.status, "failed");
  assert.match(acks[0]?.status === "failed" ? acks[0].error : "", /gone from Discord/);
  assert.deepEqual(deps.cleared, [{ patchNumber: 4, messageId: "777" }]);
  assert.deepEqual(deps.recorded, []);
});

for (const state of ["live", "preview"] as const) {
  test(`patch_delete (${state}) deletes the stored message and clears it`, async () => {
    const deps = fakeDeps();
    const acks = await run("patch_delete", deletePayload(), deps, state);

    assert.equal(acks[0]?.status, "done", JSON.stringify(acks));
    assert.deepEqual(deps.deleted, [STORED]);
    assert.deepEqual(deps.cleared, [{ patchNumber: 4, messageId: "777" }]);
  });
}

test("patch_delete of a message already gone is done, and still clears it", async () => {
  const deps = fakeDeps({ missing: true });
  const acks = await run("patch_delete", deletePayload(), deps);

  assert.equal(acks[0]?.status, "done", JSON.stringify(acks));
  assert.match(acks[0]?.status === "done" ? acks[0].resultText ?? "" : "", /already gone/);
  assert.deepEqual(deps.cleared, [{ patchNumber: 4, messageId: "777" }]);
});

test("patch_delete with the Feature Off deletes nothing", async () => {
  const deps = fakeDeps();
  const acks = await run("patch_delete", deletePayload(), deps, "off");

  assert.equal(acks[0]?.status, "done");
  assert.deepEqual(deps.deleted, []);
  assert.deepEqual(deps.cleared, []);
});

// The live adapter: which channel and message discord.js is asked for.
function fakeClient(): {
  client: Client;
  calls: { channelId: string; action: string; messageId?: string; payload?: unknown }[];
} {
  const calls: { channelId: string; action: string; messageId?: string; payload?: unknown }[] =
    [];
  const channelFor = (channelId: string): unknown => ({
    isSendable: () => true,
    isTextBased: () => true,
    send: async (payload: unknown) => {
      calls.push({ channelId, action: "send", payload });
      return { id: "888" };
    },
    messages: {
      edit: async (messageId: string, payload: unknown) => {
        calls.push({ channelId, action: "edit", messageId, payload });
      },
      delete: async (messageId: string) => {
        calls.push({ channelId, action: "delete", messageId });
      },
    },
  });
  const client = {
    channels: { fetch: async (id: string) => channelFor(id) },
  } as unknown as Client;
  return { client, calls };
}

test("the adapter sends, then edits and deletes the message in its own channel", async () => {
  const { client, calls } = fakeClient();
  const deps = createPatchPostDeps(client);
  const post = buildPatchPost({ number: 4, title: null, cutBody: BODY, publishedAt: null });

  assert.equal(await deps.sendPost(POSTED_IN, post), "888");
  await deps.editPost(STORED, post);
  await deps.deletePost(STORED);

  assert.deepEqual(calls.map(({ channelId, action, messageId }) => ({
    channelId, action, messageId,
  })), [
    { channelId: POSTED_IN, action: "send", messageId: undefined },
    { channelId: STORED.channelId, action: "edit", messageId: "777" },
    { channelId: STORED.channelId, action: "delete", messageId: "777" },
  ]);
  assert.equal(calls[0]?.payload, post);
  assert.equal(calls[1]?.payload, post);
});
