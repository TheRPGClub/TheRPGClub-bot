import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDisabledPrevNextRowWithIds,
  buildOptionalPrevNextRow,
  buildPageFooterText,
  buildPrevNextButtons,
  PAGE_NEXT_LABEL,
  PAGE_PREV_LABEL,
} from "../functions/PaginationUtils.js";

function describe(buttons: { toJSON(): unknown }[]): Array<Record<string, unknown>> {
  return buttons.map((b) => b.toJSON() as Record<string, unknown>);
}

test("buildPrevNextButtons returns nothing for a single page", () => {
  assert.deepEqual(buildPrevNextButtons("p", "n", 0, 1), []);
});

test("buildPrevNextButtons omits the button at each boundary", () => {
  const first = describe(buildPrevNextButtons("p", "n", 0, 3));
  assert.deepEqual(first.map((b) => b.custom_id), ["n"]);
  assert.equal(first[0].label, PAGE_NEXT_LABEL);

  const middle = describe(buildPrevNextButtons("p", "n", 1, 3));
  assert.deepEqual(middle.map((b) => b.label), [PAGE_PREV_LABEL, PAGE_NEXT_LABEL]);

  const last = describe(buildPrevNextButtons("p", "n", 2, 3));
  assert.deepEqual(last.map((b) => b.custom_id), ["p"]);
});

test("buildPrevNextButtons honors custom labels", () => {
  const buttons = describe(buildPrevNextButtons("p", "n", 1, 3, {
    prev: "Next Entry",
    next: "Previous Entry",
  }));
  assert.deepEqual(buttons.map((b) => b.label), ["Next Entry", "Previous Entry"]);
});

test("buildOptionalPrevNextRow keeps the base:page:dir custom ID format", () => {
  const row = buildOptionalPrevNextRow("base:1", 1, 3);
  assert.ok(row);
  assert.deepEqual(
    describe(row.components).map((b) => b.custom_id),
    ["base:1:1:prev", "base:1:1:next"],
  );
  assert.equal(buildOptionalPrevNextRow("base", 0, 1), null);
});

test("buildDisabledPrevNextRowWithIds disables the boundary button", () => {
  const row = buildDisabledPrevNextRowWithIds("p", "n", 0, 2);
  assert.ok(row);
  assert.deepEqual(describe(row.components).map((b) => b.disabled), [true, false]);
  assert.equal(buildDisabledPrevNextRowWithIds("p", "n", 0, 1), null);
});

test("buildPageFooterText is one-based with an optional suffix", () => {
  assert.equal(buildPageFooterText(0, 4), "Page 1/4");
  assert.equal(buildPageFooterText(1, 4, "12 results"), "Page 2/4 • 12 results");
});
