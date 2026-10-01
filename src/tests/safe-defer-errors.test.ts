import test from "node:test";
import assert from "node:assert/strict";

import {
  safeDeferReply,
  safeDeferUpdate,
  safeDeferUpdateOrBail,
  type AnyRepliable,
} from "../functions/InteractionUtils.js";

const ACK_ERROR = Object.assign(new Error("Interaction has already been acknowledged."), {
  code: 40060,
});
const UNKNOWN_INTERACTION = Object.assign(new Error("Unknown interaction"), { code: 10062 });
const MISSING_ACCESS = Object.assign(new Error("Missing Access"), { code: 50001 });

function buildComponent(deferError?: Error): AnyRepliable {
  return {
    channelId: "1",
    commandName: undefined,
    user: { id: "2" },
    isChatInputCommand: () => false,
    isMessageComponent: () => true,
    isModalSubmit: () => false,
    deferUpdate: () => (deferError ? Promise.reject(deferError) : Promise.resolve()),
    deferReply: () => (deferError ? Promise.reject(deferError) : Promise.resolve()),
  } as unknown as AnyRepliable;
}

async function withSilencedErrors<T>(
  run: () => Promise<T>,
): Promise<{ result: T; logged: number }> {
  const original = console.error;
  let logged = 0;
  console.error = () => {
    logged += 1;
  };
  try {
    const result = await run();
    return { result, logged };
  } finally {
    console.error = original;
  }
}

test("safeDeferUpdate returns true after a successful defer", async () => {
  assert.equal(await safeDeferUpdate(buildComponent()), true);
});

test("safeDeferUpdate treats acknowledgement races as acknowledged", async () => {
  assert.equal(await safeDeferUpdate(buildComponent(ACK_ERROR)), true);
  assert.equal(await safeDeferUpdate(buildComponent(UNKNOWN_INTERACTION)), true);
});

test("safeDeferUpdateOrBail bails and logs when the defer really fails", async () => {
  const { result, logged } = await withSilencedErrors(
    () => safeDeferUpdateOrBail(buildComponent(MISSING_ACCESS)),
  );
  assert.equal(result, false);
  assert.ok(logged > 0);
});

test("safeDeferReply logs a real failure but not an acknowledgement race", async () => {
  const race = await withSilencedErrors(() => safeDeferReply(buildComponent(ACK_ERROR)));
  assert.equal(race.logged, 0);
  const failure = await withSilencedErrors(() => safeDeferReply(buildComponent(MISSING_ACCESS)));
  assert.ok(failure.logged > 0);
});
