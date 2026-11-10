import assert from "node:assert/strict";
import test from "node:test";
import { MessageFlags, type Interaction } from "discord.js";

import { buildTextReply } from "../functions/ComponentsV2Utils.js";
import { enforceFeatureGate, safeReply } from "../functions/InteractionUtils.js";
import type {
  FeatureState,
  IFeatureFlag,
  IFeatureGateSource,
} from "../functions/FeatureGate.js";

function source(state: FeatureState, staff: boolean): IFeatureGateSource & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    async flags(): Promise<IFeatureFlag[]> {
      calls.push("flags");
      return [{ key: "journals", name: "Journals", state }];
    },
    async isStaff(userId: string): Promise<boolean> {
      calls.push(`staff:${userId}`);
      return staff;
    },
  };
}

function slashCommand(commandName: string): Interaction & { sent: unknown[] } {
  const sent: unknown[] = [];
  return {
    sent,
    commandName,
    channelId: "1",
    user: { id: "42" },
    deferred: false,
    replied: false,
    isAutocomplete: () => false,
    isChatInputCommand: () => true,
    isContextMenuCommand: () => false,
    isMessageComponent: () => false,
    isModalSubmit: () => false,
    isRepliable: () => true,
    reply: async (payload: unknown) => {
      sent.push(payload);
    },
  } as unknown as Interaction & { sent: unknown[] };
}

function sentJson(payload: unknown): string {
  return JSON.stringify(payload);
}

test("enforceFeatureGate: a member gets the private not-available reply", async () => {
  const interaction = slashCommand("game-journal");

  assert.equal(await enforceFeatureGate(interaction, source("preview", false)), true);

  assert.equal(interaction.sent.length, 1);
  const payload = interaction.sent[0] as { flags: number };
  assert.equal(payload.flags & MessageFlags.Ephemeral, MessageFlags.Ephemeral);
  assert.match(sentJson(payload), /This feature isn't available yet\./);
});

test("enforceFeatureGate: staff in Preview run the command and see the note", async () => {
  const interaction = slashCommand("game-journal");

  assert.equal(await enforceFeatureGate(interaction, source("preview", true)), false);
  assert.equal(interaction.sent.length, 0);

  await safeReply(interaction as never, buildTextReply("Your journal.", true));
  const sent = sentJson(interaction.sent[0]);
  assert.match(sent, /Your journal\./);
  assert.match(sent, /"type":10,"content":"-# Preview - staff only"/);
});

test("enforceFeatureGate: a Live Feature runs with no note and no member lookup", async () => {
  const interaction = slashCommand("game-journal");
  const lookups = source("live", false);

  assert.equal(await enforceFeatureGate(interaction, lookups), false);
  assert.deepEqual(lookups.calls, ["flags"]);
  await safeReply(interaction as never, buildTextReply("Your journal.", true));
  assert.doesNotMatch(sentJson(interaction.sent[0]), /Preview/);
});

test("enforceFeatureGate: unmapped commands and autocomplete never look anything up", async () => {
  const lookups = source("off", false);
  assert.equal(await enforceFeatureGate(slashCommand("help"), lookups), false);

  const autocomplete = { ...slashCommand("game-journal"), isAutocomplete: () => true };
  assert.equal(await enforceFeatureGate(autocomplete as unknown as Interaction, lookups), false);
  assert.deepEqual(lookups.calls, []);
});
