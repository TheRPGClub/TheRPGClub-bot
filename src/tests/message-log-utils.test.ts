import assert from "node:assert/strict";
import test from "node:test";
import { Collection } from "discord.js";
import type { Message, PartialMessage } from "discord.js";
import { DISCORD_LOG_CHANNEL_ID } from "../config/channels.js";
import { buildDeletedMessageLog, UNCACHED_DELETE_BODY } from "../utilities/MessageLogUtils.js";

const CHANNEL_ID = "111111111111111111";
const MESSAGE_ID = "222222222222222222";
const CREATED_MS = 1_700_000_000_000;

function fakePartial(channelId = CHANNEL_ID): PartialMessage {
  return {
    partial: true,
    id: MESSAGE_ID,
    channelId,
    createdTimestamp: CREATED_MS,
    author: null,
  } as unknown as PartialMessage;
}

function fakeCached(bot: boolean, content = "hello"): Message {
  return {
    partial: false,
    id: MESSAGE_ID,
    channelId: CHANNEL_ID,
    createdTimestamp: CREATED_MS,
    author: { id: "333", bot },
    cleanContent: content,
    content,
    attachments: new Collection(),
  } as unknown as Message;
}

test("buildDeletedMessageLog logs an uncached delete from what the event carries", () => {
  const entry = buildDeletedMessageLog(fakePartial());
  assert.ok(entry);
  assert.equal(entry.title, `Message deleted in <#${CHANNEL_ID}>`);
  assert.equal(entry.body, UNCACHED_DELETE_BODY);
  assert.equal(entry.footer, `Message ID: ${MESSAGE_ID} • <t:${CREATED_MS / 1000}:F>`);
});

test("buildDeletedMessageLog logs a cached human message with its content", () => {
  const entry = buildDeletedMessageLog(fakeCached(false));
  assert.ok(entry);
  assert.equal(entry.body, "hello");
  assert.equal(entry.footer, `ID: 333 • <t:${CREATED_MS / 1000}:F>`);
});

test("buildDeletedMessageLog skips a cached bot message", () => {
  assert.equal(buildDeletedMessageLog(fakeCached(true)), null);
});

test("buildDeletedMessageLog skips deletes in the log channel itself", () => {
  assert.equal(buildDeletedMessageLog(fakePartial(DISCORD_LOG_CHANNEL_ID)), null);
});
