import test from "node:test";
import assert from "node:assert/strict";
import type { Client } from "discordx";
import { logToDiscord, setConsoleLoggingClient } from "../utilities/DiscordConsoleLogger.js";

// Above LOG_BATCH_MAX_CHARS, so each line triggers its own size-threshold flush.
const OVER_THRESHOLD = 2700;

async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("a flush requested while one is in flight runs after it instead of being lost", async () => {
  let releaseFirstSend = (): void => {};
  const firstSendGate = new Promise<void>((resolve) => {
    releaseFirstSend = resolve;
  });
  const sent: string[] = [];
  const channel = {
    isTextBased: () => true,
    send: async (options: { components: { toJSON(): unknown }[] }) => {
      sent.push(JSON.stringify(options.components.map((component) => component.toJSON())));
      if (sent.length === 1) await firstSendGate;
    },
  };
  setConsoleLoggingClient({ channels: { fetch: async () => channel } } as unknown as Client);

  await logToDiscord("Startup sequence completed.");
  await logToDiscord("x".repeat(OVER_THRESHOLD));
  await waitFor(() => sent.length === 1);
  assert.equal(sent.length, 1);

  await logToDiscord("y".repeat(OVER_THRESHOLD), "warn");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(sent.length, 1, "the second flush must wait for the first");

  releaseFirstSend();
  await waitFor(() => sent.length === 2);
  assert.equal(sent.length, 2);
  assert.ok(sent[1].includes("yyyy"));
});
