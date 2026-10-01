import test from "node:test";
import assert from "node:assert/strict";
import { resolveThreadOption } from "../commands/thread-admin.command.js";

const THREAD_ID = "1300000000000000001";

test("resolveThreadOption uses the picked thread", () => {
  assert.deepEqual(resolveThreadOption(THREAD_ID, undefined), { threadId: THREAD_ID });
});

test("resolveThreadOption falls back to a typed thread id", () => {
  assert.deepEqual(resolveThreadOption(undefined, ` ${THREAD_ID} `), { threadId: THREAD_ID });
});

test("resolveThreadOption rejects both options at once", () => {
  assert.ok("error" in resolveThreadOption(THREAD_ID, THREAD_ID));
});

test("resolveThreadOption rejects neither option", () => {
  assert.ok("error" in resolveThreadOption(undefined, "  "));
});

test("resolveThreadOption rejects a typed id that is not a snowflake", () => {
  assert.deepEqual(
    resolveThreadOption(undefined, "abc"),
    { error: "`abc` is not a thread ID." },
  );
});
