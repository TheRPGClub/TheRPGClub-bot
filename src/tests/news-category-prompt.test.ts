import assert from "node:assert/strict";
import test from "node:test";
import type { NewsPlaces } from "../config/newsHub.js";
import {
  buildNewsCategoryPrompt,
  newsCategoryPromptRefusal,
  parseNewsCategoryPickId,
} from "../functions/NewsCategoryChangePrompt.js";
import type { INewsMessage } from "../functions/NewsItem.js";

const NEWS_CHANNEL = "510000000000000001";
const OTHER_CHANNEL = "510000000000000002";
const MESSAGE_ID = "610000000000000001";
const BOT_ID = "700000000000000001";
const PLACES: NewsPlaces = new Map([[NEWS_CHANNEL, null]]);

function message(overrides: Partial<INewsMessage> = {}): INewsMessage {
  return {
    id: MESSAGE_ID,
    channelId: NEWS_CHANNEL,
    system: false,
    webhookId: null,
    author: { id: "710000000000000001", bot: false, username: "reporter", globalName: null },
    member: null,
    cleanContent: "New patch https://example.com/news/1",
    createdAt: new Date("2026-11-10T09:00:00.000Z"),
    editedAt: null,
    attachments: new Map(),
    embeds: [],
    ...overrides,
  };
}

test("the prompt lists the seven News Categories privately, by name", () => {
  const prompt = buildNewsCategoryPrompt(NEWS_CHANNEL, MESSAGE_ID);
  const json = JSON.stringify(prompt.components.map((component) => component.toJSON()));
  const values = [...json.matchAll(/"value":"([a-z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(values, [
    "announcements", "releases", "emulation", "industry", "hardware", "rumours", "general",
  ]);
  assert.match(json, /Announcements & Trailers/);
  assert.match(json, /Rumours & Leaks/);
  assert.ok(prompt.flags & 64, "ephemeral");
  const customId = /"custom_id":"([^"]+)"/.exec(json)?.[1] ?? "";
  assert.deepEqual(parseNewsCategoryPickId(customId), {
    channelId: NEWS_CHANNEL,
    messageId: MESSAGE_ID,
  });
});

test("a malformed pick ID is not parsed", () => {
  assert.equal(parseNewsCategoryPickId("news-category-pick-v1:abc"), null);
  assert.equal(parseNewsCategoryPickId(`other:${NEWS_CHANNEL}:${MESSAGE_ID}`), null);
});

test("a member's news in the News Channel and the bot's own posts get the prompt", () => {
  assert.equal(newsCategoryPromptRefusal(message(), PLACES, BOT_ID, false), null);
  const share = message({
    author: { id: BOT_ID, bot: true, username: "bot", globalName: null },
  });
  assert.equal(newsCategoryPromptRefusal(share, PLACES, BOT_ID, false), null);
});

test("a message that cannot be a News Item is refused before the prompt", () => {
  const chat = message({ cleanContent: "nice" });
  assert.match(newsCategoryPromptRefusal(chat, PLACES, BOT_ID, false) ?? "", /isn't a News Item/);
  const elsewhere = message({ channelId: OTHER_CHANNEL });
  assert.match(
    newsCategoryPromptRefusal(elsewhere, PLACES, BOT_ID, false) ?? "",
    /isn't a News Item/,
  );
});

test("test mode refuses, since it shares the production API", () => {
  assert.match(newsCategoryPromptRefusal(message(), PLACES, BOT_ID, true) ?? "", /test mode/);
});
