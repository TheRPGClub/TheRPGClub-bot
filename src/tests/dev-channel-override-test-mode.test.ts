import test from "node:test";
import assert from "node:assert/strict";
import { MessageFlags } from "discord.js";

// Test mode is read once at module load, so every module that reaches
// src/config/ must be imported dynamically below this assignment.
process.env.TEST_GUILD_ID = "1547802424301854770";

const { safeDeferReply } = await import("../functions/InteractionUtils.js");
const { BOT_DEV_CHANNEL_ID } = await import("../config/channels.js");

import type { AnyRepliable } from "../functions/InteractionUtils.js";

const OWNER_ID = "42";

test("an owner ephemeral defer stays ephemeral in the dev channel in test mode", async () => {
  const deferred: unknown[] = [];
  const interaction = {
    channelId: BOT_DEV_CHANNEL_ID,
    commandName: "collection",
    guild: { ownerId: OWNER_ID },
    user: { id: OWNER_ID },
    isChatInputCommand: () => true,
    isMessageComponent: () => false,
    isModalSubmit: () => false,
    deferReply: (options: unknown) => {
      deferred.push(options);
      return Promise.resolve();
    },
  } as unknown as AnyRepliable;

  await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

  assert.equal(deferred.length, 1);
  const flags = (deferred[0] as { flags?: number }).flags ?? 0;
  assert.equal(flags & MessageFlags.Ephemeral, MessageFlags.Ephemeral);
});
