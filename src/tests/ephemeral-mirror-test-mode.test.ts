import test from "node:test";
import assert from "node:assert/strict";
import { MessageFlags } from "discord.js";

// Test mode is read once at module load, so every module that reaches
// src/config/ must be imported dynamically below this assignment. A static
// import would hoist above it and load the config graph with test mode off.
process.env.TEST_GUILD_ID = "1547802424301854770";

const { mirrorEphemeralReply } = await import("../functions/EphemeralMirror.js");
const { TEST_LOG_CHANNEL_ID } = await import("../config/channels.js");
const { buildTextReply } = await import("../functions/ComponentsV2Utils.js");

import type { AnyRepliable } from "../functions/InteractionUtils.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral, content: "secret" };

function interactionWithChannel(channel: unknown, seen: string[]): AnyRepliable {
  return {
    commandName: "admin",
    user: { id: "1" },
    channelId: "2",
    client: {
      channels: {
        fetch: (id: string) => {
          seen.push(id);
          return Promise.resolve(channel);
        },
      },
    },
  } as unknown as AnyRepliable;
}

test("mirrorEphemeralReply posts an ephemeral reply to the test-log channel", async () => {
  const sent: string[] = [];
  const seen: string[] = [];
  const channel = {
    isTextBased: () => true,
    send: (message: { content: string }) => { sent.push(message.content); },
  };

  await mirrorEphemeralReply(interactionWithChannel(channel, seen), EPHEMERAL);

  assert.deepEqual(seen, [TEST_LOG_CHANNEL_ID]);
  assert.equal(sent.length, 1);
  assert.ok(sent[0]?.includes("secret"));
  assert.ok(sent[0]?.includes("/admin"));
});

test("mirrorEphemeralReply skips a public reply in test mode", async () => {
  const sent: string[] = [];
  const seen: string[] = [];
  const channel = {
    isTextBased: () => true,
    send: (message: { content: string }) => { sent.push(message.content); },
  };

  await mirrorEphemeralReply(interactionWithChannel(channel, seen), { flags: 0 });

  assert.deepEqual(seen, []);
  assert.equal(sent.length, 0);
});

test("a thrown mirror error never surfaces to the caller", async () => {
  const seen: string[] = [];
  const channel = {
    isTextBased: () => true,
    send: () => {
      throw new Error("mirror exploded");
    },
  };

  await mirrorEphemeralReply(interactionWithChannel(channel, seen), EPHEMERAL);
  assert.deepEqual(seen, [TEST_LOG_CHANNEL_ID]);
});

function componentInteraction(
  messageFlags: number,
  channel: unknown,
  seen: string[],
  updated: unknown[],
): AnyRepliable {
  return {
    customId: "btn:1",
    user: { id: "1" },
    channelId: "2",
    deferred: false,
    replied: false,
    message: { flags: messageFlags },
    isMessageComponent: () => true,
    isModalSubmit: () => false,
    update: (payload: unknown) => {
      updated.push(payload);
      return Promise.resolve();
    },
    client: {
      channels: {
        fetch: (id: string) => {
          seen.push(id);
          return Promise.resolve(channel);
        },
      },
    },
  } as unknown as AnyRepliable;
}

test("safeUpdate mirrors a successful update of an ephemeral message", async () => {
  const { safeUpdate } = await import("../functions/InteractionUtils.js");
  const sent: string[] = [];
  const seen: string[] = [];
  const updated: unknown[] = [];
  const channel = {
    isTextBased: () => true,
    send: (message: { content: string }) => { sent.push(message.content); },
  };
  const interaction = componentInteraction(MessageFlags.Ephemeral, channel, seen, updated);

  await safeUpdate(interaction, buildTextReply("updated body", true));

  assert.equal(updated.length, 1);
  assert.deepEqual(seen, [TEST_LOG_CHANNEL_ID]);
  assert.equal(sent.length, 1);
  assert.ok(sent[0]?.includes("updated body"));
  assert.ok(sent[0]?.includes('"kind": "update"'));
  assert.ok(sent[0]?.includes("component:btn:1"));
});

test("safeUpdate does not mirror an update of a public message", async () => {
  const { safeUpdate } = await import("../functions/InteractionUtils.js");
  const sent: string[] = [];
  const seen: string[] = [];
  const updated: unknown[] = [];
  const channel = {
    isTextBased: () => true,
    send: (message: { content: string }) => { sent.push(message.content); },
  };
  const interaction = componentInteraction(0, channel, seen, updated);

  await safeUpdate(interaction, buildTextReply("public body", false));

  assert.equal(updated.length, 1);
  assert.deepEqual(seen, []);
  assert.equal(sent.length, 0);
});

test("a thrown update mirror error never surfaces to the caller", async () => {
  const { mirrorEphemeralUpdate } = await import("../functions/EphemeralMirror.js");
  const seen: string[] = [];
  const channel = {
    isTextBased: () => true,
    send: () => {
      throw new Error("mirror exploded");
    },
  };
  const interaction = componentInteraction(MessageFlags.Ephemeral, channel, seen, []);

  await mirrorEphemeralUpdate(interaction, { content: "updated" });
  assert.deepEqual(seen, [TEST_LOG_CHANNEL_ID]);
});

function deferrableCommand(channel: unknown, seen: string[]): AnyRepliable {
  const interaction = {
    ...interactionWithChannel(channel, seen),
    // Not admin/mod/superadmin, which safeDeferReply always defers ephemerally.
    commandName: "profile",
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    isMessageComponent: () => false,
    isModalSubmit: () => false,
    deferReply: () => {
      interaction.deferred = true;
      return Promise.resolve();
    },
    editReply: () => Promise.resolve({ id: "reply" }),
  };
  return interaction as unknown as AnyRepliable;
}

test("a reply filling an ephemeral defer is mirrored without its own flag", async () => {
  const { safeDeferReply, safeReply } = await import("../functions/InteractionUtils.js");
  const sent: string[] = [];
  const seen: string[] = [];
  const channel = {
    isTextBased: () => true,
    send: (message: { content: string }) => { sent.push(message.content); },
  };
  const interaction = deferrableCommand(channel, seen);

  await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
  await safeReply(interaction, buildTextReply("filled", false));

  assert.equal(sent.length, 1);
  assert.ok(sent[0]?.includes("filled"));
});

test("a reply filling a public defer is not mirrored", async () => {
  const { safeDeferReply, safeReply } = await import("../functions/InteractionUtils.js");
  const sent: string[] = [];
  const seen: string[] = [];
  const channel = {
    isTextBased: () => true,
    send: (message: { content: string }) => { sent.push(message.content); },
  };
  const interaction = deferrableCommand(channel, seen);

  await safeDeferReply(interaction);
  await safeReply(interaction, buildTextReply("public", false));

  assert.equal(sent.length, 0);
});

test("safeEditReply after an ephemeral command defer is mirrored", async () => {
  const { safeDeferReply, safeEditReply } = await import("../functions/InteractionUtils.js");
  const sent: string[] = [];
  const seen: string[] = [];
  const channel = {
    isTextBased: () => true,
    send: (message: { content: string }) => { sent.push(message.content); },
  };
  const interaction = deferrableCommand(channel, seen);

  await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
  await safeEditReply(interaction, { content: "edited" });

  assert.equal(sent.length, 1);
  assert.ok(sent[0]?.includes("edited"));
});
