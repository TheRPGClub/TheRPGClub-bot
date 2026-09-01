import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMaskedLink,
  escapeMaskedLinkText,
  unescapeMaskedLinkText,
} from "../functions/ComponentsV2Utils.js";

test("buildMaskedLink neutralizes a bracket breakout in the link text", () => {
  const link = buildMaskedLink("Anything](https://evil.example) ", "https://real.example");
  assert.ok(
    link.startsWith("[Anything\\]\\(https://evil.example\\)"),
    "the injected bracket and parens are escaped",
  );
  assert.equal(link.match(/\]\(/g)?.length, 1, "only one unescaped link target remains");
  assert.ok(link.endsWith("](https://real.example)"), "the real target is the link target");
});

test("buildMaskedLink percent-encodes parentheses in the url", () => {
  const link = buildMaskedLink("Wiki", "https://example.com/a_(b)");
  assert.equal(link, "[Wiki](https://example.com/a_%28b%29)");
});

test("escaping a plain title round-trips", () => {
  const title = "Half-Life 2: Episode [One] (2006)";
  assert.equal(unescapeMaskedLinkText(escapeMaskedLinkText(title)), title);
});
