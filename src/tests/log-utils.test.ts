import assert from "node:assert/strict";
import test from "node:test";
import { AxiosError, AxiosHeaders } from "axios";
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

test("formatStructuredLog keeps an Error cause without its extra fields", () => {
  const cause = new Error("Request failed with status code 422") as Error & {
    config?: unknown;
  };
  cause.config = { headers: { Authorization: "Bearer hidden" } };
  const error = new Error("That game is already in your backlog.", { cause });
  const parsed = JSON.parse(formatStructuredLog({ context: "ctx", error }));
  assert.equal(parsed.error.cause.message, "Request failed with status code 422");
  assert.equal(parsed.error.cause.config, undefined);
});

test("formatStructuredLog leaves an API error's request config out", () => {
  const error = new AxiosError("Request failed", "ERR_BAD_REQUEST", {
    headers: new AxiosHeaders({ Authorization: "Bearer test-token" }),
    data: JSON.stringify({ data: { key_value: "SECRET-KEY" } }),
    method: "post",
    url: "/api/v1/game_keys",
  });
  error.status = 422;
  const line = formatStructuredLog({ context: "ctx", error: new Error("wrap", { cause: error }) });
  const direct = formatStructuredLog({ context: "ctx", error });

  for (const text of [line, direct]) {
    assert.ok(!text.includes("SECRET-KEY"));
    assert.ok(!text.includes("test-token"));
  }
  const parsed = JSON.parse(direct);
  assert.equal(parsed.error.message, "Request failed");
  assert.equal(parsed.error.status, 422);
  assert.equal(parsed.error.request, "POST /api/v1/game_keys");
});
