import test from "node:test";
import assert from "node:assert/strict";
import { buildMaskedLink, escapeMaskedLinkText } from "../functions/ComponentsV2Utils.js";

test("buildMaskedLink neutralizes a bracket breakout in the link text", () => {
  const link = buildMaskedLink("Anything](https://evil.example) ", "https://real.example");
  assert.ok(link.startsWith("[Anything\\]"), "the injected bracket is escaped");
  assert.equal(
    link.match(/(?<!\\)\]\(/g)?.length,
    1,
    "only one unescaped link target remains",
  );
  assert.ok(link.endsWith("](https://real.example)"), "the real target is the link target");
});

test("buildMaskedLink leaves parentheses in the link text alone", () => {
  const link = buildMaskedLink("Dragon Quest VII Reimagined (PS5)", "https://example.com/dq7");
  assert.equal(link, "[Dragon Quest VII Reimagined (PS5)](https://example.com/dq7)");
  assert.ok(!link.includes("\\"), "no backslash leaks into the rendered text");
});

test("buildMaskedLink percent-encodes parentheses in the url", () => {
  const link = buildMaskedLink("Wiki", "https://example.com/a_(b)");
  assert.equal(link, "[Wiki](https://example.com/a_%28b%29)");
});

test("escapeMaskedLinkText escapes brackets and leaves parentheses", () => {
  const title = "Half-Life 2: Episode [One] (2006)";
  assert.equal(escapeMaskedLinkText(title), "Half-Life 2: Episode \\[One\\] (2006)");
});
