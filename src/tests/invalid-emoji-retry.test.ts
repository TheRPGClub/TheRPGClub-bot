import test from "node:test";
import assert from "node:assert/strict";
import {
  findInvalidEmojiPaths,
  sendWithInvalidEmojiRetry,
  stripInvalidEmojis,
} from "../functions/InvalidEmojiRetry.js";
import { safeUpdate } from "../functions/InteractionUtils.js";
import { buildUserHeaderContainer } from "../functions/uiComponents.js";

const STALE_EMOJI_ID = "1554903798701363311";
const USER_ID = "191938640413327360";

// The header the bot builds for a user, carrying the stale cached emoji from the prod report.
function buildHeaderPayload(): { components: unknown[] } {
  const container: any = buildUserHeaderContainer(USER_ID, "merph518", "Now Playing").toJSON();
  container.components[0].accessory.emoji = { name: "u_merph518", id: STALE_EMOJI_ID };
  return { components: [container] };
}

// Shape of the discord.js DiscordAPIError from the prod report on issue 1340.
function buildInvalidEmojiError(): Error {
  const error: any = new Error("Invalid Form Body");
  error.code = 50035;
  error.status = 400;
  error.rawError = {
    message: "Invalid Form Body",
    code: 50035,
    errors: { components: { 0: { components: { 0: { accessory: { emoji: {
      id: { _errors: [{ code: "COMPONENT_INVALID_EMOJI", message: "Invalid emoji" }] },
    } } } } } } },
  };
  return error;
}

function headerButton(payload: any): any {
  return payload.components[0].components[0].accessory;
}

test("findInvalidEmojiPaths returns the path to the rejected emoji object", () => {
  assert.deepEqual(findInvalidEmojiPaths(buildInvalidEmojiError()), [
    ["components", "0", "components", "0", "accessory", "emoji"],
  ]);
});

test("findInvalidEmojiPaths ignores other errors", () => {
  const error: any = new Error("Unknown Message");
  error.code = 10008;
  assert.deepEqual(findInvalidEmojiPaths(error), []);
  assert.deepEqual(findInvalidEmojiPaths(new Error("boom")), []);
});

test("stripInvalidEmojis removes only the rejected emoji and keeps the label", () => {
  const stripped = stripInvalidEmojis(buildHeaderPayload(), buildInvalidEmojiError());
  assert.ok(stripped);
  assert.deepEqual(stripped.emojiIds, [STALE_EMOJI_ID]);
  const button = headerButton(stripped.options);
  assert.equal(button.emoji, undefined);
  assert.equal(button.label, "merph518");
});

test("sendWithInvalidEmojiRetry retries without the emoji and reports it", async () => {
  const sent: any[] = [];
  const reported: string[][] = [];
  const result = await sendWithInvalidEmojiRetry(
    buildHeaderPayload(),
    async (payload) => {
      sent.push(payload);
      if (sent.length === 1) throw buildInvalidEmojiError();
      return "ok";
    },
    (ids) => { reported.push([...ids]); },
  );
  assert.equal(result, "ok");
  assert.equal(sent.length, 2);
  assert.equal(headerButton(sent[1]).emoji, undefined);
  assert.deepEqual(reported, [[STALE_EMOJI_ID]]);
});

test("sendWithInvalidEmojiRetry rethrows unrelated errors without retrying", async () => {
  let calls = 0;
  await assert.rejects(
    sendWithInvalidEmojiRetry(
      buildHeaderPayload(),
      async () => {
        calls++;
        throw new Error("boom");
      },
      () => { assert.fail("must not report"); },
    ),
    /boom/,
  );
  assert.equal(calls, 1);
});

test("safeUpdate updates in place without the stale emoji instead of failing", async () => {
  const calls: string[] = [];
  const interaction: any = {
    deferred: false,
    replied: false,
    user: { id: "u1" },
    update: async (payload: any) => {
      calls.push("update");
      if (calls.length === 1) throw buildInvalidEmojiError();
      assert.equal(headerButton(payload).emoji, undefined);
    },
    editReply: async () => { calls.push("edit"); },
    followUp: async () => { calls.push("follow"); },
    reply: async () => { calls.push("reply"); },
    isMessageComponent: () => true,
  };

  await safeUpdate(interaction, buildHeaderPayload());

  assert.deepEqual(calls, ["update", "update"]);
});
