import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDisabledPrevNextButtons,
  buildDisabledPrevNextRow,
  buildDisabledPrevNextRowWithIds,
  buildPageFooterText,
  buildPageIndicatorLabel,
  buildPrevNextButtons,
  PAGE_INDICATOR_CUSTOM_ID,
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

test("buildDisabledPrevNextRow keeps the base:page:dir custom ID format", () => {
  const row = buildDisabledPrevNextRow("base:1", 1, 3);
  assert.ok(row);
  assert.deepEqual(
    describe(row.components).map((b) => b.custom_id),
    ["base:1:1:prev", PAGE_INDICATOR_CUSTOM_ID, "base:1:1:next"],
  );
  assert.equal(buildDisabledPrevNextRow("base", 0, 1), null);
});

test("buildDisabledPrevNextRowWithIds keeps every button in place across pages", () => {
  for (const [page, disabled] of [
    [0, [true, true, false]],
    [1, [false, true, false]],
    [2, [false, true, true]],
  ] as const) {
    const row = buildDisabledPrevNextRowWithIds("p", "n", page, 3);
    assert.ok(row);
    const buttons = describe(row.components);
    assert.deepEqual(buttons.map((b) => b.custom_id), ["p", PAGE_INDICATOR_CUSTOM_ID, "n"]);
    assert.deepEqual(
      buttons.map((b) => b.label),
      [PAGE_PREV_LABEL, `${page + 1} / 3`, PAGE_NEXT_LABEL],
    );
    assert.deepEqual(buttons.map((b) => b.disabled), [...disabled]);
  }
  assert.equal(buildDisabledPrevNextRowWithIds("p", "n", 0, 1), null);
});

test("buildDisabledPrevNextRowWithIds passes custom labels to the arrows", () => {
  const row = buildDisabledPrevNextRowWithIds("p", "n", 0, 2, {
    labels: { prev: "Previous Result", next: "Next Result" },
  });
  assert.ok(row);
  assert.deepEqual(
    describe(row.components).map((b) => b.label),
    ["Previous Result", "1 / 2", "Next Result"],
  );
});

test("buildPageIndicatorLabel is one-based", () => {
  assert.equal(buildPageIndicatorLabel(1, 7), "2 / 7");
});

test("buildDisabledPrevNextButtons keeps both buttons and disables the boundary", () => {
  assert.deepEqual(buildDisabledPrevNextButtons("p", "n", 0, 1), []);
  const last = describe(buildDisabledPrevNextButtons("p", "n", 2, 3));
  assert.deepEqual(last.map((b) => b.custom_id), ["p", "n"]);
  assert.deepEqual(last.map((b) => b.label), [PAGE_PREV_LABEL, PAGE_NEXT_LABEL]);
  assert.deepEqual(last.map((b) => b.disabled), [false, true]);
});

test("buildPageFooterText is one-based with an optional suffix", () => {
  assert.equal(buildPageFooterText(0, 4), "Page 1/4");
  assert.equal(buildPageFooterText(1, 4, "12 results"), "Page 2/4 • 12 results");
});
