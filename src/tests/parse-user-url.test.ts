import assert from "node:assert/strict";
import test from "node:test";
import { parseOptionalUserUrl, parseUserUrl } from "../functions/InteractionUtils.js";

test("parseUserUrl keeps markdown-like characters that sanitizeUserInput strips", () => {
  const url = "https://example.com/my_feed~v2/*.xml?a=1;b=2&c=x--y";
  const parsed = parseUserUrl(url, "Feed URL");
  assert.deepEqual(parsed, { ok: true, value: url });
});

test("parseUserUrl strips invisible characters and trims", () => {
  const parsed = parseUserUrl("  https://example.com/​feed\u0007.xml \n", "Feed URL");
  assert.deepEqual(parsed, { ok: true, value: "https://example.com/feed.xml" });
});

test("parseUserUrl unwraps Discord no-embed angle brackets", () => {
  const parsed = parseUserUrl("<https://example.com/rss_feed>", "Feed URL");
  assert.deepEqual(parsed, { ok: true, value: "https://example.com/rss_feed" });
});

test("parseUserUrl normalizes to the parsed href", () => {
  const parsed = parseUserUrl("HTTP://Example.COM", "Feed URL");
  assert.deepEqual(parsed, { ok: true, value: "http://example.com/" });
});

test("parseUserUrl rejects unparseable input with the label", () => {
  const parsed = parseUserUrl("not a url", "Feed URL");
  assert.deepEqual(parsed, { error: "Feed URL must be a valid URL.", ok: false });
});

test("parseUserUrl rejects non-http protocols", () => {
  for (const url of ["ftp://example.com/feed", "javascript:alert(1)", "file:///etc/passwd"]) {
    const parsed = parseUserUrl(url, "Feed URL");
    assert.deepEqual(parsed, { error: "Feed URL must use http or https.", ok: false });
  }
});

test("parseOptionalUserUrl treats input that normalizes to empty as no url", () => {
  for (const value of [undefined, null, "", "   ", "\u200b", " <> ", "< \u200b >"]) {
    const parsed = parseOptionalUserUrl(value, "Image URL");
    assert.deepEqual(parsed, { ok: true, value: undefined });
  }
});

test("parseOptionalUserUrl parses non-empty input like parseUserUrl", () => {
  assert.deepEqual(parseOptionalUserUrl(" <https://example.com/a_b.png> ", "Image URL"), {
    ok: true,
    value: "https://example.com/a_b.png",
  });
  assert.deepEqual(parseOptionalUserUrl("not a url", "Image URL"), {
    error: "Image URL must be a valid URL.",
    ok: false,
  });
});
