import assert from "node:assert/strict";
import test from "node:test";
import {
  completionAddContextFromJson,
  completionAddContextToJson,
} from "../commands/game-completion/completion-add-context.codec.js";
import type { CompletionAddContext } from "../commands/game-completion/completion.types.js";

const CTX: CompletionAddContext = {
  userId: "333333333333333333",
  completionType: "Completionist",
  completedAt: new Date("2026-08-15T12:00:00Z"),
  finalPlaytimeHours: 42.5,
  selectedPlatformId: 7,
  note: "Line one\nLine two",
  source: "igdb",
  query: "Chrono Trigger",
  announce: true,
};

test("a completion add context survives a JSON round trip", () => {
  const raw = JSON.parse(JSON.stringify(completionAddContextToJson(CTX)));
  assert.deepEqual(completionAddContextFromJson(raw), CTX);
});

test("null dates and platforms round trip as null", () => {
  const ctx = { ...CTX, completedAt: null, selectedPlatformId: null, note: null };
  const raw = JSON.parse(JSON.stringify(completionAddContextToJson(ctx)));
  const parsed = completionAddContextFromJson(raw);
  assert.equal(parsed?.completedAt, null);
  assert.equal(parsed?.selectedPlatformId, null);
  assert.equal(parsed?.note, null);
});

test("a malformed persisted context is rejected", () => {
  assert.equal(completionAddContextFromJson(null), null);
  assert.equal(completionAddContextFromJson({ ...CTX, completionType: "Speedrun" }), null);
  assert.equal(completionAddContextFromJson({ ...CTX, completedAt: "not a date" }), null);
  assert.equal(completionAddContextFromJson({ ...CTX, userId: "" }), null);
});
