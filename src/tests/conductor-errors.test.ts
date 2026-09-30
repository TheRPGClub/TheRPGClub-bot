import assert from "node:assert/strict";
import test from "node:test";
import { isConductorSource } from "../conductor/ConductorErrors.js";

test("isConductorSource matches the conduct command and its components", () => {
  assert.ok(isConductorSource("/conduct"));
  assert.ok(isConductorSource("conductor-check-v1:12:0"));
  assert.ok(isConductorSource("conductor-note-modal-v1:12:0:fail"));
});

test("isConductorSource leaves other commands alone", () => {
  assert.ok(!isConductorSource("/mod presence"));
  assert.ok(!isConductorSource("/conductor"));
  assert.ok(!isConductorSource("conductor-check-v10:12:0"));
});
