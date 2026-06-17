import test from "node:test";
import assert from "node:assert/strict";
import { isTransientConnectionError } from "../db/postgresClient.js";

test("isTransientConnectionError: true for 57P01 admin_shutdown", () => {
  const err = Object.assign(new Error("terminating connection due to administrator command"), {
    code: "57P01",
  });
  assert.equal(isTransientConnectionError(err), true);
});

test("isTransientConnectionError: true for 57P02 crash_shutdown", () => {
  const err = Object.assign(new Error("terminating connection due to crash"), { code: "57P02" });
  assert.equal(isTransientConnectionError(err), true);
});

test("isTransientConnectionError: true for ECONNRESET", () => {
  const err = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
  assert.equal(isTransientConnectionError(err), true);
});

test("isTransientConnectionError: true for Connection terminated unexpectedly message", () => {
  const err = new Error("Connection terminated unexpectedly");
  assert.equal(isTransientConnectionError(err), true);
});

test("isTransientConnectionError: false for non-connection errors", () => {
  assert.equal(isTransientConnectionError(new Error("syntax error at or near")), false);
  assert.equal(isTransientConnectionError(new Error("relation does not exist")), false);
  assert.equal(isTransientConnectionError("not an error"), false);
  assert.equal(isTransientConnectionError(null), false);
});

test("isTransientConnectionError: false for unknown pg error code", () => {
  const err = Object.assign(new Error("permission denied"), { code: "42501" });
  assert.equal(isTransientConnectionError(err), false);
});
