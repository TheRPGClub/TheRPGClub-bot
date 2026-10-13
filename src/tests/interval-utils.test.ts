import test from "node:test";
import assert from "node:assert/strict";
import {
  createIntervalTask,
  createScheduledTask,
  stopAllTrackedIntervals,
} from "../utilities/IntervalUtils.js";

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
  await task.runNow();
  assert.equal(runs, 1);

  gate.resolve();
  await first;
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
    task.stop();
    assert.equal(task.start(), true);
  } finally {
    task.stop();
  }
});

test("a throwing task does not block the next run", async () => {
  let runs = 0;
  const task = createIntervalTask({
    name: "test",
    intervalMs: HOUR_MS,
    task: async () => {
      runs++;
      throw new Error("boom");
    },
  });

  const originalError = console.error;
  console.error = () => {};
  try {
    await task.runNow();
    await task.runNow();
  } finally {
    console.error = originalError;
  }
  assert.equal(runs, 2);
});

test("a scheduled task runs on start and again after the delay its run returns", async () => {
  let runs = 0;
  const task = createScheduledTask({
    name: "test",
    retryDelayMs: HOUR_MS,
    task: async () => {
      runs++;
      return runs === 1 ? 0 : HOUR_MS;
    },
  });

  assert.equal(task.start(), true);
  assert.equal(task.start(), false);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(runs, 2);
  task.stop();
});

test("runSoon during a run follows it instead of being lost", async () => {
  const gate = deferred();
  let runs = 0;
  const task = createScheduledTask({
    name: "test",
    retryDelayMs: HOUR_MS,
    task: async () => {
      runs++;
      if (runs === 1) await gate.promise;
      return HOUR_MS;
    },
  });

  task.start();
  task.runSoon();
  assert.equal(runs, 1);
  gate.resolve();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(runs, 2);
  task.stop();
});

test("stopAllTrackedIntervals keeps a run in flight from scheduling another", async () => {
  const gate = deferred();
  let runs = 0;
  const task = createScheduledTask({
    name: "test",
    retryDelayMs: 0,
    task: async () => {
      runs++;
      await gate.promise;
      return 0;
    },
  });

  task.start();
  task.runSoon();
  stopAllTrackedIntervals();
  gate.resolve();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(runs, 1);
  task.runSoon();
  assert.equal(runs, 1);
});
