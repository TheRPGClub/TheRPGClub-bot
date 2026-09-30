import assert from "node:assert/strict";
import test from "node:test";
import { formatPreviewPresence } from "../config/previewMode.js";

test("formatPreviewPresence names the PR and the short SHA", () => {
  assert.equal(
    formatPreviewPresence("1297", "a606242f0c1d2e3b4a5968778695a4b3c2d1e0f9"),
    "Testing PR #1297 (a606242)",
  );
});

test("formatPreviewPresence omits the SHA when none was passed", () => {
  assert.equal(formatPreviewPresence("1297", ""), "Testing PR #1297");
});
