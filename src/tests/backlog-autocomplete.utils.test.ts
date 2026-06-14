import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBacklogEntryAutocompleteValue,
  parseBacklogEntryAutocompleteValue,
} from "../commands/backlog/backlog-autocomplete.utils.js";

test("buildBacklogEntryAutocompleteValue round-trips through the parser", () => {
  const value = buildBacklogEntryAutocompleteValue(42);
  assert.equal(value, "backlog:42");
  assert.equal(parseBacklogEntryAutocompleteValue(value), 42);
});

test("buildBacklogEntryAutocompleteValue rejects non-finite ids (NaN regression)", () => {
  assert.throws(() => buildBacklogEntryAutocompleteValue(Number(undefined)));
  assert.throws(() => buildBacklogEntryAutocompleteValue(0));
  assert.throws(() => buildBacklogEntryAutocompleteValue(-1));
});

test("parseBacklogEntryAutocompleteValue rejects backlog:NaN and malformed input", () => {
  assert.equal(parseBacklogEntryAutocompleteValue("backlog:NaN"), null);
  assert.equal(parseBacklogEntryAutocompleteValue("backlog:"), null);
  assert.equal(parseBacklogEntryAutocompleteValue("backlog:1.5"), null);
  assert.equal(parseBacklogEntryAutocompleteValue("nope:1"), null);
});
