import test from "node:test";
import assert from "node:assert/strict";
import { createIntervalTask } from "../utilities/IntervalUtils.js";

const HOUR_MS = 60 * 60 * 1000;

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

test("runNow skips while the previous run is still in flight", async () => {
  const gate = deferred();
  let runs = 0;
  const task = createIntervalTask({
    name: "test",
    intervalMs: HOUR_MS,
    task: async () => {
      runs++;
      await gate.promise;
    },
  });

  const first = task.runNow();
  assert.equal(task.isRunning(), true);
  await task.runNow();
  assert.equal(runs, 1);

  gate.resolve();
  await first;
  assert.equal(task.isRunning(), false);
  await task.runNow();
  assert.equal(runs, 2);
});

test("start is idempotent and stop allows a later start", () => {
  const task = createIntervalTask({
    name: "test",
    intervalMs: HOUR_MS,
    runOnStart: false,
    task: async () => {},
  });

  try {
    assert.equal(task.start(), true);
    assert.equal(task.start(), false);
    assert.equal(task.isStarted(), true);
    task.stop();
    assert.equal(task.isStarted(), false);
    assert.equal(task.start(), true);
  } finally {
    task.stop();
  }
});

test("a throwing task clears the running flag", async () => {
  const task = createIntervalTask({
    name: "test",
    intervalMs: HOUR_MS,
    task: async () => {
      throw new Error("boom");
    },
  });

  const originalError = console.error;
  console.error = () => {};
  try {
    await task.runNow();
  } finally {
    console.error = originalError;
  }
  assert.equal(task.isRunning(), false);
});
