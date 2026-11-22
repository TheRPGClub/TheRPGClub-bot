import test from "node:test";
import assert from "node:assert/strict";
import type { Client } from "discordx";
import { STARTUP_COMPLETE_LINE } from "../services/StartupSequence.js";
import { logToDiscord, setConsoleLoggingClient } from "../utilities/DiscordConsoleLogger.js";

// Its own file: the logger keeps the first channel it resolves for the whole process.

// Above LOG_BATCH_MAX_CHARS, so the line triggers a size-threshold flush at once.
const OVER_THRESHOLD = 2700;

async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("an error batch is logged without pinging anyone", async () => {
  const sent: { content?: unknown; flags?: unknown; allowedMentions?: unknown; json: string }[] =
    [];
  const channel = {
    isTextBased: () => true,
    send: async (options: {
      content?: unknown;
      flags?: unknown;
      allowedMentions?: unknown;
      components: { toJSON(): unknown }[];
    }) => {
      sent.push({
        content: options.content,
        flags: options.flags,
        allowedMentions: options.allowedMentions,
        json: JSON.stringify(options.components.map((component) => component.toJSON())),
      });
    },
  };
  setConsoleLoggingClient({ channels: { fetch: async () => channel } } as unknown as Client);

  // Until startup completes, the logger only forwards its startup lines.
  await logToDiscord(STARTUP_COMPLETE_LINE);
  await logToDiscord(`boom for <@123456789> ${"z".repeat(OVER_THRESHOLD)}`, "error");
  await waitFor(() => sent.length > 0);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].content, undefined, "a Components V2 message cannot carry content");
  assert.match(sent[0].json, /\[ERROR\] boom/);
  assert.doesNotMatch(sent[0].json, /"content":"<@\d+>"/, "no mention component");
  assert.deepEqual(sent[0].allowedMentions, { parse: [] });
});
