import assert from "node:assert/strict";
import test from "node:test";
import {
  mapImport,
  type CompletionatorImportApiData,
} from "../classes/CompletionatorImport.js";

function buildRow(
  overrides: Partial<CompletionatorImportApiData> = {},
): CompletionatorImportApiData {
  return {
    import_id: 42,
    user_id: "123456789012345678",
    status: "active",
    current_index: 3,
    total_count: 10,
    source_filename: "completionator.csv",
    test_mode: false,
    created_at: "2026-05-01T12:00:00Z",
    updated_at: "2026-05-01T12:30:00Z",
    ...overrides,
  };
}

test("mapImport round-trips test_mode true", () => {
  const mapped = mapImport(buildRow({ test_mode: true }));
  assert.equal(mapped.testMode, true);
});

test("mapImport round-trips test_mode false", () => {
  const mapped = mapImport(buildRow({ test_mode: false }));
  assert.equal(mapped.testMode, false);
});

test("mapImport falls back to false when test_mode is missing", () => {
  const row = buildRow();
  delete (row as Partial<CompletionatorImportApiData>).test_mode;

  const mapped = mapImport(row);
  assert.equal(mapped.testMode, false);
});

test("mapImport maps the remaining import fields", () => {
  const mapped = mapImport(buildRow({ test_mode: true }));

  assert.equal(mapped.importId, 42);
  assert.equal(mapped.userId, "123456789012345678");
  assert.equal(mapped.status, "ACTIVE");
  assert.equal(mapped.currentIndex, 3);
  assert.equal(mapped.totalCount, 10);
  assert.equal(mapped.sourceFilename, "completionator.csv");
  assert.equal(mapped.createdAt.toISOString(), "2026-05-01T12:00:00.000Z");
  assert.equal(mapped.updatedAt.toISOString(), "2026-05-01T12:30:00.000Z");
});
