import assert from "node:assert/strict";
import test from "node:test";
import { formatStructuredLog } from "../utilities/LogUtils.js";

test("formatStructuredLog preserves Error message and stack", () => {
  const error = new Error("Connection terminated unexpectedly");
  const parsed = JSON.parse(formatStructuredLog({ context: "ctx", error }));
  assert.equal(parsed.context, "ctx");
  assert.equal(parsed.error.message, "Connection terminated unexpectedly");
  assert.equal(typeof parsed.error.stack, "string");
});

test("formatStructuredLog drops the pg-pool client blob on errors", () => {
  const error = new Error("idle client error") as Error & { client?: unknown };
  error.client = { connectionParameters: { user: "neondb_owner" } };
  const parsed = JSON.parse(formatStructuredLog({ context: "ctx", error }));
  assert.equal(parsed.error.client, undefined);
  assert.equal(parsed.error.message, "idle client error");
});

test("formatStructuredLog keeps known pg error fields", () => {
  const error = new Error("db error") as Error & Record<string, unknown>;
  error.code = "57P01";
  error.severity = "FATAL";
  const parsed = JSON.parse(formatStructuredLog({ context: "ctx", error }));
  assert.equal(parsed.error.code, "57P01");
  assert.equal(parsed.error.severity, "FATAL");
});

test("formatStructuredLog handles circular references", () => {
  const node: Record<string, unknown> = { name: "root" };
  node.self = node;
  const output = formatStructuredLog({ context: "ctx", node });
  const parsed = JSON.parse(output);
  assert.equal(parsed.node.name, "root");
  assert.equal(parsed.node.self, "[Circular]");
});
