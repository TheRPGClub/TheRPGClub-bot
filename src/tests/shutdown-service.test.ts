import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  createShutdown,
  installShutdownSignalHandlers,
  type IShutdownSteps,
} from "../services/ShutdownService.js";
import {
  startTrackedInterval,
  stopAllTrackedIntervals,
} from "../utilities/IntervalUtils.js";

const HOUR_MS = 60 * 60 * 1000;

function recordingSteps(overrides: Partial<IShutdownSteps> = {}): {
  steps: IShutdownSteps;
  calls: string[];
} {
  const calls: string[] = [];
  const steps: IShutdownSteps = {
    stopIntervals: () => {
      calls.push("stopIntervals");
      return 0;
    },
    flushLogs: async () => {
      calls.push("flushLogs");
    },
    destroyClient: async () => {
      calls.push("destroyClient");
    },
    exit: (code) => {
      calls.push(`exit:${code}`);
    },
    stepTimeoutMs: 20,
    ...overrides,
  };
  return { steps, calls };
}

test("shutdown stops intervals, flushes, destroys, then exits 0 in that order", async () => {
  const { steps, calls } = recordingSteps();
  await createShutdown(steps)("SIGTERM");
  assert.deepEqual(calls, ["stopIntervals", "flushLogs", "destroyClient", "exit:0"]);
});

test("shutdown runs once and reuses the running promise", async () => {
  const { steps, calls } = recordingSteps();
  const shutdown = createShutdown(steps);
  const first = shutdown("SIGTERM");
  const second = shutdown("SIGINT", 1);
  assert.equal(first, second);
  await first;
  assert.deepEqual(calls.filter((call) => call.startsWith("exit")), ["exit:0"]);
});

test("shutdown passes a nonzero exit code through", async () => {
  const { steps, calls } = recordingSteps();
  await createShutdown(steps)("fatal", 1);
  assert.equal(calls.at(-1), "exit:1");
});

test("a hung log flush is capped and shutdown still exits", async () => {
  const { steps, calls } = recordingSteps({
    flushLogs: () => new Promise<void>(() => {}),
  });
  await createShutdown(steps)("SIGTERM");
  assert.deepEqual(calls, ["stopIntervals", "destroyClient", "exit:0"]);
});

test("a failing destroy is logged and shutdown still exits", async () => {
  const { steps, calls } = recordingSteps({
    destroyClient: async () => {
      throw new Error("socket already closed");
    },
  });
  await createShutdown(steps)("SIGTERM");
  assert.equal(calls.at(-1), "exit:0");
});

test("every shutdown signal starts the same idempotent shutdown", async () => {
  const emitter = new EventEmitter();
  const { steps, calls } = recordingSteps();
  installShutdownSignalHandlers(
    createShutdown(steps),
    emitter as unknown as Pick<NodeJS.Process, "on">,
  );

  emitter.emit("SIGINT");
  emitter.emit("SIGINT");
  emitter.emit("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(calls, ["stopIntervals", "flushLogs", "destroyClient", "exit:0"]);
});

test("stopAllTrackedIntervals clears every tracked interval", () => {
  stopAllTrackedIntervals();
  startTrackedInterval(() => {}, HOUR_MS);
  startTrackedInterval(() => {}, HOUR_MS);
  assert.equal(stopAllTrackedIntervals(), 2);
  assert.equal(stopAllTrackedIntervals(), 0);
});
