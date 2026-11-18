import assert from "node:assert/strict";
import test from "node:test";
import { cutAtSentence, splitLorePages } from "../functions/CodexLorePages.js";
import { formatCodexDate } from "../functions/CodexText.js";

// /codex lore read's paging (bot#1563, design 3D): a Lore Entry's Discord text is split
// at its headings, and a section too long for one page at its last whole sentence.

test("formatCodexDate: a date reads at its precision", () => {
  assert.equal(formatCodexDate("2020-08-12", "day"), "12 August 2020");
  assert.equal(formatCodexDate("2018-03-01", "month"), "March 2018");
  assert.equal(formatCodexDate("2016-01-01", "year"), "2016");
  assert.equal(formatCodexDate(null, null), null);
  assert.equal(formatCodexDate("not a date", "day"), null);
});

test("splitLorePages: a story without headings is one page", () => {
  assert.deepEqual(splitLorePages("One paragraph.\n\nAnother one.", 100), [
    "One paragraph.\n\nAnother one.",
  ]);
});

test("splitLorePages: each heading starts a page, the opening text is page 1", () => {
  const body = [
    "Three days after GameDB went live.",
    "",
    "## What we lost",
    "Two and a half years of chat.",
    "",
    "## The aftermath",
    "A wall of F's.",
  ].join("\n");
  assert.deepEqual(splitLorePages(body, 500), [
    "Three days after GameDB went live.",
    "## What we lost\nTwo and a half years of chat.",
    "## The aftermath\nA wall of F's.",
  ]);
});

test("splitLorePages: a story that opens with a heading has no empty first page", () => {
  assert.deepEqual(splitLorePages("\n# Start\nHello.\n### Next\nBye.", 500), [
    "# Start\nHello.",
    "### Next\nBye.",
  ]);
});

test("splitLorePages: an over-long section continues on the next page under its heading", () => {
  const body = "## Long\nFirst sentence here. Second sentence here. Third one.";
  const pages = splitLorePages(body, 45);
  assert.deepEqual(pages, [
    "## Long\nFirst sentence here.",
    "## Long (continued)\nSecond sentence here.",
    "## Long (continued)\nThird one.",
  ]);
  for (const page of pages) assert.ok(page.length <= 45, page);
});

test("cutAtSentence: cuts at the last whole sentence that fits", () => {
  assert.deepEqual(cutAtSentence("One. Two! Three? Four.", 17), ["One. Two! Three?", "Four."]);
  assert.deepEqual(cutAtSentence("He said \"stop.\" Then left.", 20), [
    "He said \"stop.\"",
    "Then left.",
  ]);
});

test("cutAtSentence: never cuts inside a spoiler", () => {
  const text = "Before. ||The twist. More twist.|| After.";
  const [head, rest] = cutAtSentence(text, 30);
  assert.equal(head, "Before.");
  assert.equal(rest, "||The twist. More twist.|| After.");
});

test("cutAtSentence: a line break is a boundary, and a quote keeps its marker", () => {
  assert.deepEqual(cutAtSentence("- one item\n- two item\n- three", 22), [
    "- one item\n- two item",
    "- three",
  ]);
  assert.deepEqual(cutAtSentence("> Quoted one. Quoted two.", 16), [
    "> Quoted one.",
    "> Quoted two.",
  ]);
});

test("cutAtSentence: with no sentence end it cuts at a space, else hard, spoilers closed", () => {
  assert.deepEqual(cutAtSentence("aaaa bbbb cccc", 10), ["aaaa bbbb", "cccc"]);
  const [head, rest] = cutAtSentence("||abcdefghijklmnop||", 10);
  assert.ok(head.length <= 10);
  assert.ok(head.endsWith("||") && head.startsWith("||"), head);
  assert.ok(rest.startsWith("||") && rest.endsWith("||"), rest);
  assert.equal((head + rest).replace(/\|/g, ""), "abcdefghijklmnop");
});

test("cutAtSentence: text that fits is not cut", () => {
  assert.deepEqual(cutAtSentence("Short.", 10), ["Short.", ""]);
});

test("splitLorePages: a long section's first page keeps words under its heading", () => {
  const body = "## Heading\nwords without any sentence end at all go on and on";
  const [first] = splitLorePages(body, 30);
  assert.ok(first.startsWith("## Heading\nwords"), first);
});
