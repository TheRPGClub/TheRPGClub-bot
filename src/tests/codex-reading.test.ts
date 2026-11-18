import assert from "node:assert/strict";
import test from "node:test";
import type { ICodexEntry, ICodexLink, ICodexReadApi } from "../services/CodexApi.js";
import {
  historyReply,
  loreChoices,
  loreReadReply,
  pageTurnRefusal,
  type CodexReadResult,
} from "../services/CodexReading.js";
import {
  buildCodexHistoryId,
  buildCodexLoreId,
  parseCodexHistoryId,
  parseCodexLoreId,
} from "../functions/CodexCustomIds.js";
import { apiError, buttonsOf, galleryUrls, textOf } from "./challengeFixtures.js";

// /codex lore read and /codex history (bot#1563, design 3B+3C+3D and 4B), with a fake API
// client. Lore Entries and History Events are read-only in Discord.

const READER = "222";
const AUTHOR = "444";
const MENTIONED = "333";
const LORE_INK = 0x52d6a4;

function entry(overrides: Partial<ICodexEntry> = {}): ICodexEntry {
  return {
    id: 7,
    part: "lore_entry",
    title: "The Night the Bot Wiped #general",
    rich_body: null,
    body: [
      `Three days after GameDB went live, <@${MENTIONED}> typed /purge 5000.`,
      "## What we lost",
      "Two and a half years of chat. ||The xenogears theory.||",
      "## The aftermath",
      "A wall of F's.",
    ].join("\n"),
    occurred_on: "2020-08-12",
    date_precision: "day",
    kind: null,
    author: { user_id: AUTHOR, name: "Mog Whisperer", avatar_url: "/a" },
    mentions: { [MENTIONED]: { user_id: MENTIONED, name: "Loot Hoarder", avatar_url: "/b" } },
    images: [
      { id: 2, url: "https://img.example/2.png", position: 2 },
      { id: 1, url: "https://img.example/1.png", position: 1 },
    ],
    links: [
      { id: 3, part: "history_event", title: "GameDB, the club's bot, goes live" },
      { id: 8, part: "lore_entry", title: "The Great Tonberry Raffle" },
    ],
    viewer: { can_edit: false, can_delete: false },
    created_at: "2026-11-18T14:00:00.000Z",
    updated_at: "2026-11-18T14:00:00.000Z",
    ...overrides,
  };
}

function historyEvent(id: number, overrides: Partial<ICodexEntry> = {}): ICodexEntry {
  return entry({
    id,
    part: "history_event",
    title: `History Event ${id}`,
    body: null,
    kind: "milestone",
    occurred_on: `20${10 + id}-01-01`,
    date_precision: "year",
    images: [],
    links: [],
    ...overrides,
  });
}

interface IFakeReadApi extends ICodexReadApi {
  calls: string[];
}

function fakeApi(options: {
  lore?: ICodexEntry[];
  history?: ICodexEntry[];
  search?: ICodexLink[];
  error?: unknown;
} = {}): IFakeReadApi {
  const fail = (): void => {
    if (options.error) throw options.error;
  };
  const api: IFakeReadApi = {
    calls: [],
    searchLore: async (query, per) => {
      api.calls.push(`search ${query} ${per}`);
      fail();
      return options.search ?? [];
    },
    getLoreEntry: async (id, actingUserId) => {
      api.calls.push(`lore ${id} ${actingUserId}`);
      fail();
      return (options.lore ?? []).find((e) => e.id === id) ?? null;
    },
    listHistory: async (actingUserId) => {
      api.calls.push(`history ${actingUserId}`);
      fail();
      return options.history ?? [];
    },
  };
  return api;
}

function pageOf(result: CodexReadResult): { components: unknown[]; allowedMentions: unknown } {
  assert.ok("page" in result, JSON.stringify(result));
  return result.page;
}

type Json = Record<string, unknown>;

function containers(result: CodexReadResult): Json[] {
  return (pageOf(result).components as Json[]).filter((c) => c.type === 17);
}

const lore = (input: Partial<Parameters<typeof loreReadReply>[0]> = {}) => ({
  entryId: 7,
  page: 1,
  ownerId: READER,
  visibility: "private" as const,
  ...input,
});

test("lore read: the first page is a jade Club Lore card with the images on top", async () => {
  const api = fakeApi({ lore: [entry()] });
  const result = await loreReadReply(lore(), { api });
  assert.deepEqual(api.calls, [`lore 7 ${READER}`]);
  const [card] = containers(result);
  assert.equal(card.accent_color, LORE_INK);
  assert.deepEqual(galleryUrls(card), ["https://img.example/1.png", "https://img.example/2.png"]);
  const text = textOf(card);
  assert.match(text, /## The Night the Bot Wiped #general/);
  assert.match(text, new RegExp(`Club Lore · 12 August 2020 · by <@${AUTHOR}> · page 1 of 3`));
  assert.match(text, new RegExp(`<@${MENTIONED}> typed /purge 5000`));
  assert.doesNotMatch(text, /What we lost/);
  assert.deepEqual(pageOf(result).allowedMentions, { parse: [] });
});

test("lore read: Previous and Next turn pages; only the last page has See also", async () => {
  const api = fakeApi({ lore: [entry()] });
  const second = await loreReadReply(lore({ page: 2 }), { api });
  assert.equal(galleryUrls(pageOf(second).components).length, 0);
  assert.match(textOf(pageOf(second).components), /## What we lost\n.*\|\|The xenogears/);
  assert.doesNotMatch(textOf(pageOf(second).components), /See also/);
  const buttons = buttonsOf(pageOf(second).components);
  const previous = buttons.find((b) => b.label === "Previous");
  const next = buttons.find((b) => b.label === "Next");
  assert.deepEqual(parseCodexLoreId(previous?.customId ?? ""), {
    action: "page", entryId: 7, page: 1, ownerId: READER, visibility: "private",
  });
  assert.equal(parseCodexLoreId(next?.customId ?? "")?.page, 3);

  const last = await loreReadReply(lore({ page: 3 }), { api });
  const text = textOf(pageOf(last).components);
  assert.match(text, /See also · \[GameDB, the club's bot, goes live\]\(\S+\/codex\/history\)/);
  assert.match(text, /\[The Great Tonberry Raffle\]\(\S+\/codex\/lore\/8\)/);
  assert.equal(buttonsOf(pageOf(last).components).find((b) => b.label === "Next")?.disabled, true);
});

test("lore read: a private page offers Post this page and the Website", async () => {
  const result = await loreReadReply(lore({ page: 2 }), { api: fakeApi({ lore: [entry()] }) });
  const buttons = buttonsOf(pageOf(result).components);
  const post = buttons.find((b) => b.label === "Post this page");
  assert.deepEqual(parseCodexLoreId(post?.customId ?? ""), {
    action: "post", entryId: 7, page: 2, ownerId: READER, visibility: "private",
  });
  assert.match(buttons.find((b) => b.label === "Website")?.url ?? "", /\/codex\/lore\/7$/);
});

test("lore read: a public page has no Post this page, and its buttons stay public", async () => {
  const result = await loreReadReply(
    lore({ visibility: "public" }),
    { api: fakeApi({ lore: [entry()] }) },
  );
  const buttons = buttonsOf(pageOf(result).components);
  assert.equal(buttons.some((b) => b.label === "Post this page"), false);
  assert.equal(
    parseCodexLoreId(buttons.find((b) => b.label === "Next")?.customId ?? "")?.visibility,
    "public",
  );
});

test("lore read: a short entry without headings is one page with no paging", async () => {
  const short = entry({ body: "Just one paragraph.", links: [], images: [], occurred_on: null,
    date_precision: null });
  const result = await loreReadReply(lore(), { api: fakeApi({ lore: [short] }) });
  const text = textOf(pageOf(result).components);
  assert.match(text, new RegExp(`-# Club Lore · by <@${AUTHOR}>$`, "m"));
  assert.doesNotMatch(text, /page 1 of/);
  const labels = buttonsOf(pageOf(result).components).map((b) => b.label);
  assert.deepEqual(labels, ["Post this page", "Website"]);
});

test("lore read: a long section is paged, never cut, each page fits Discord", async () => {
  const sentence = "The purge took everything in its path that night. ";
  const long = entry({ body: sentence.repeat(200).trim(), links: [] });
  const api = fakeApi({ lore: [long] });
  const first = await loreReadReply(lore(), { api });
  const count = Number(/page 1 of (\d+)/.exec(textOf(pageOf(first).components))?.[1]);
  assert.ok(count > 1);
  let words = 0;
  for (let page = 1; page <= count; page += 1) {
    const text = textOf(pageOf(await loreReadReply(lore({ page }), { api })).components);
    assert.ok(text.length <= 4000, `page ${page}: ${text.length}`);
    words += text.split("The purge took").length - 1;
  }
  assert.equal(words, 200);
});

test("lore read: a full last page with long See also titles stays within 4000", async () => {
  // 100-character titles of nothing but brackets (each one escaped, so 200 characters), a
  // 100-character title of Markdown, and a last page of story as long as a page may be.
  const bracketed = "[]".repeat(50);
  const links = [11, 12, 13, 14, 15, 16].map((id) => ({
    id,
    part: "lore_entry" as const,
    title: bracketed,
  }));
  const story = "A long night of tonberry raffles, told in full. ".repeat(80).slice(0, 2790);
  const long = entry({
    title: "_*".repeat(50),
    body: `${story.trim()}.`,
    links,
    images: [],
  });
  const result = await loreReadReply(lore(), { api: fakeApi({ lore: [long] }) });
  const text = textOf(pageOf(result).components);

  assert.ok(text.length <= 4000, `${text.length} characters`);
  assert.match(text, /-# See also · \[(\\\[\\\]){50}\]\(/);
  const shown = (text.match(/\(\S+\/codex\/lore\/1\d\)/g) ?? []).length;
  assert.ok(shown >= 1 && shown < 5, `${shown} links shown`);
  assert.match(text, new RegExp(` · and ${links.length - shown} more$`));
});

test("lore read: a page past the end shows the last page", async () => {
  const result = await loreReadReply(lore({ page: 9 }), { api: fakeApi({ lore: [entry()] }) });
  assert.match(textOf(pageOf(result).components), /page 3 of 3/);
});

test("lore read: no pick, or a deleted Lore Entry, is a private notice", async () => {
  const none = await loreReadReply(lore({ entryId: null }), { api: fakeApi() });
  assert.ok("notice" in none);
  assert.match(textOf(none.notice.components), /Pick a Lore Entry from the list/);
  const gone = await loreReadReply(lore({ entryId: 99 }), { api: fakeApi() });
  assert.ok("notice" in gone);
  assert.match(textOf(gone.notice.components), /no Lore Entry 99/);
});

test("lore read: an API failure shows the request and the response", async () => {
  const error = apiError(500, { error: "boom" }, {
    method: "get", url: "/api/v1/codex/lore_entries/7?acting_user_id=222",
  });
  const result = await loreReadReply(lore(), { api: fakeApi({ error }) });
  assert.ok("error" in result);
  assert.match(result.error, /Could not read that Lore Entry/);
  assert.match(result.error, /lore_entries\/7/);
  assert.match(result.error, /boom/);
});

test("lore choices: every Lore Entry by title, the value its ID", async () => {
  const api = fakeApi({ search: [
    { id: 7, part: "lore_entry", title: "The Night the Bot Wiped #general" },
    { id: 8, part: "lore_entry", title: "x".repeat(150) },
  ] });
  const choices = await loreChoices({ query: " night " }, { api });
  assert.deepEqual(api.calls, ["search night 25"]);
  assert.deepEqual(choices[0], { name: "The Night the Bot Wiped #general", value: "7" });
  assert.equal(choices[1].name.length, 100);
  assert.deepEqual(await loreChoices({ query: "" }, { api: fakeApi({ error: new Error("x") }) }),
    []);
});

test("history: the latest 4 History Events, newest first, cards in Kind inks", async () => {
  const events = [1, 2, 3, 4, 5, 6].map((id) => historyEvent(id));
  events[5] = historyEvent(6, {
    kind: "platform",
    occurred_on: "2025-05-01",
    date_precision: "month",
    body: `The website opens. <@${MENTIONED}> wrote it.`,
    images: [{ id: 4, url: "https://img.example/site.png", position: 1 }],
  });
  const api = fakeApi({ history: events });
  const result = await historyReply({ page: 1, ownerId: READER, visibility: "public" }, { api });
  assert.deepEqual(api.calls, [`history ${READER}`]);
  const view = pageOf(result);
  assert.match(textOf(view.components), /## Club History\n-# The latest 4 History Events/);
  const cards = containers(result);
  assert.equal(cards.length, 4);
  assert.deepEqual(cards.map((c) => /### (.+)/.exec(textOf(c))?.[1]), [
    "History Event 6", "History Event 5", "History Event 4", "History Event 3",
  ]);
  assert.equal(cards[0].accent_color, 0x7cb6ff);
  assert.match(textOf(cards[0]), /-# Platform · May 2025\nThe website opens\. <@333> wrote it\./);
  assert.equal(cards[1].accent_color, 0xeadcb8);
  assert.match(textOf(cards[1]), /-# Milestone · 2015/);
  assert.match(JSON.stringify(cards[0]), /https:\/\/img\.example\/site\.png/);
  assert.deepEqual(view.allowedMentions, { parse: [] });

  const buttons = buttonsOf(view.components);
  assert.match(buttons.find((b) => b.label === "The full Club History")?.url ?? "",
    /\/codex\/history$/);
  assert.equal(buttons.some((b) => b.label === "Newer"), false);
  assert.deepEqual(parseCodexHistoryId(buttons.find((b) => b.label === "Older")?.customId ?? ""),
    { page: 2, ownerId: READER, visibility: "public" });
});

test("history: Older pages back in fours", async () => {
  const events = [1, 2, 3, 4, 5, 6].map((id) => historyEvent(id));
  const result = await historyReply(
    { page: 2, ownerId: READER, visibility: "private" },
    { api: fakeApi({ history: events }) },
  );
  assert.match(textOf(pageOf(result).components), /History Events 5 to 6 of 6, newest first/);
  assert.equal(containers(result).length, 2);
  const labels = buttonsOf(pageOf(result).components).map((b) => b.label);
  assert.deepEqual(labels, ["Newer", "The full Club History"]);
});

test("history: a long description is cut at a sentence end", async () => {
  const body = "A sentence about the club. ".repeat(40).trim();
  const result = await historyReply(
    { page: 1, ownerId: READER, visibility: "public" },
    { api: fakeApi({ history: [historyEvent(1, { body })] }) },
  );
  const text = textOf(containers(result)[0]);
  assert.ok(text.length < 700);
  assert.match(text, /club\. …$/);
});

test("history: no History Events, or a failure, is private", async () => {
  const empty = await historyReply({ page: 1, ownerId: READER, visibility: "public" },
    { api: fakeApi() });
  assert.ok("notice" in empty);
  assert.match(textOf(empty.notice.components), /no History Events yet/);
  const failed = await historyReply({ page: 1, ownerId: READER, visibility: "public" },
    { api: fakeApi({ error: new Error("down") }) });
  assert.ok("error" in failed);
  assert.match(failed.error, /Could not read Club History/);
});

test("page buttons answer only the member who ran the command", () => {
  const target = { ownerId: READER };
  assert.equal(pageTurnRefusal(target, READER), null);
  const refusal = pageTurnRefusal(target, "999");
  assert.ok(refusal);
  assert.match(textOf(refusal.components), new RegExp(`Only <@${READER}> can turn`));
  assert.deepEqual(refusal.allowedMentions, { parse: [] });
});

test("custom IDs round-trip, and a stale or foreign one is refused", () => {
  const lore = {
    action: "post", entryId: 7, page: 2, ownerId: READER, visibility: "public",
  } as const;
  assert.deepEqual(parseCodexLoreId(buildCodexLoreId(lore)), lore);
  const history = { page: 3, ownerId: READER, visibility: "private" } as const;
  assert.deepEqual(parseCodexHistoryId(buildCodexHistoryId(history)), history);
  assert.equal(parseCodexLoreId("codex-lore:page:7:0:222:private"), null);
  assert.equal(parseCodexLoreId("codex-lore:read:7:1:222:private"), null);
  assert.equal(parseCodexLoreId("codex-fun-fact:delete:5"), null);
  assert.equal(parseCodexHistoryId("codex-history:page:1:222:everyone"), null);
  assert.ok(buildCodexLoreId({ ...lore, entryId: 2 ** 31, ownerId: "1".repeat(20) }).length
    <= 100);
});
