import test from "node:test";
import assert from "node:assert/strict";
import { runStartupSequence, STARTUP_COMPLETE_LINE } from "../services/StartupSequence.js";

function captureConsole(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  const capture = (...args: unknown[]): void => { lines.push(args.map(String).join(" ")); };
  console.log = capture;
  console.warn = capture;
  console.error = capture;
  return { lines, restore: () => Object.assign(console, original) };
}

test("runStartupSequence keeps running the steps after one that throws", async () => {
  const ran: string[] = [];
  const output = captureConsole();
  let failed: string[];
  try {
    failed = await runStartupSequence([
      { name: "A", run: () => { ran.push("A"); } },
      { name: "B", run: async () => { throw new Error("boom"); } },
      { name: "C", run: () => { throw new Error("sync boom"); } },
      { name: "D", run: async () => { ran.push("D"); } },
    ]);
  } finally {
    output.restore();
  }
  assert.deepEqual(ran, ["A", "D"]);
  assert.deepEqual(failed, ["B", "C"]);
  const readyIndex = output.lines.indexOf(STARTUP_COMPLETE_LINE);
  assert.ok(readyIndex >= 0);
  assert.ok(output.lines[readyIndex + 1]?.includes("Failed startup steps: B, C"));
});

test("runStartupSequence prints only the ready line when every step succeeds", async () => {
  const output = captureConsole();
  let failed: string[];
  try {
    failed = await runStartupSequence([{ name: "A", run: async () => {} }]);
  } finally {
    output.restore();
  }
  assert.deepEqual(failed, []);
  assert.deepEqual(output.lines, [STARTUP_COMPLETE_LINE]);
});
