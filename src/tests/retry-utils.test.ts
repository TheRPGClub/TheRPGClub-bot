import assert from "node:assert/strict";
import test from "node:test";
import { withRetry } from "../utilities/RetryUtils.js";

test("withRetry returns the first successful result without retrying", async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls += 1;
      return "ok";
    },
    { attempts: 3, baseDelayMs: 1, context: "test" },
  );
  assert.equal(result, "ok");
  assert.equal(calls, 1);
});

test("withRetry retries failures until success", async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls += 1;
      if (calls < 3) {
        throw new Error("transient");
      }
      return "recovered";
    },
    { attempts: 5, baseDelayMs: 1, context: "test" },
  );
  assert.equal(result, "recovered");
  assert.equal(calls, 3);
});

test("withRetry rethrows once attempts are exhausted", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls += 1;
        throw new Error("still down");
      },
      { attempts: 3, baseDelayMs: 1, context: "test" },
    ),
    /still down/,
  );
  assert.equal(calls, 3);
});

test("withRetry rethrows non-retryable errors immediately", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls += 1;
        throw new Error("fatal");
      },
      {
        attempts: 5,
        baseDelayMs: 1,
        isRetryable: () => false,
        context: "test",
      },
    ),
    /fatal/,
  );
  assert.equal(calls, 1);
});

test("withRetry doubles the delay and caps it at maxDelayMs", async () => {
  const warns: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message: string) => {
    warns.push(message);
  };
  try {
    let calls = 0;
    await withRetry(
      async () => {
        calls += 1;
        if (calls < 5) {
          throw new Error("transient");
        }
      },
      { attempts: 6, baseDelayMs: 10, maxDelayMs: 25, context: "test" },
    );
  } finally {
    console.warn = originalWarn;
  }
  const delays = warns.map(
    (raw) => (JSON.parse(raw).message as { nextDelayMs: number }).nextDelayMs,
  );
  assert.deepEqual(delays, [10, 20, 25, 25]);
});
