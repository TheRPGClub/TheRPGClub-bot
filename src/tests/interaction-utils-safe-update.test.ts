import test from "node:test";
import assert from "node:assert/strict";
import { MessageFlags } from "discord.js";
import { safeUpdate, safeUpdateModalSource } from "../functions/InteractionUtils.js";

test("safeUpdate falls back to editReply after acknowledged interaction", async () => {
  const calls: string[] = [];
  const interaction: any = {
    deferred: true,
    replied: false,
    user: { id: "u1" },
    update: async () => {
      const error: any = new Error("already acknowledged");
      error.code = 40060;
      throw error;
    },
    editReply: async (payload: unknown) => {
      calls.push(`edit:${JSON.stringify(payload)}`);
    },
    followUp: async (payload: unknown) => {
      calls.push(`follow:${JSON.stringify(payload)}`);
    },
    reply: async (payload: unknown) => {
      calls.push(`reply:${JSON.stringify(payload)}`);
    },
    isMessageComponent: () => true,
    __rpgAcked: true,
    __rpgDeferred: true,
  };

  await safeUpdate(interaction, {
    content: "Select platform",
    components: [],
    flags: MessageFlags.Ephemeral,
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0], /^edit:/);
});

const MENU_PAYLOAD = { components: [], flags: MessageFlags.IsComponentsV2 };

function makeModalInteraction(fromMessage: boolean, calls: string[]): any {
  return {
    deferred: false,
    replied: false,
    user: { id: "u1" },
    isMessageComponent: () => false,
    isModalSubmit: () => true,
    isFromMessage: () => fromMessage,
    update: async () => {
      calls.push("update");
    },
    reply: async () => {
      calls.push("reply");
    },
    followUp: async () => {
      calls.push("followUp");
    },
    editReply: async () => {
      calls.push("editReply");
    },
  };
}

test("safeUpdate keeps replying to a modal opened from a message", async () => {
  const calls: string[] = [];
  await safeUpdate(makeModalInteraction(true, calls), MENU_PAYLOAD);
  assert.deepEqual(calls, ["reply"]);
});

test("safeUpdateModalSource updates the message a modal was opened from", async () => {
  const calls: string[] = [];
  await safeUpdateModalSource(makeModalInteraction(true, calls), MENU_PAYLOAD);
  assert.deepEqual(calls, ["update"]);
});

test("safeUpdateModalSource replies when the modal has no source message", async () => {
  const calls: string[] = [];
  await safeUpdateModalSource(makeModalInteraction(false, calls), MENU_PAYLOAD);
  assert.deepEqual(calls, ["reply"]);
});
