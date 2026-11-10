import assert from "node:assert/strict";
import test from "node:test";
import { MessageFlags, MessageFlagsBitField, type Interaction } from "discord.js";

import { BOT_DEV_CHANNEL_ID } from "../config/channels.js";
import { buildTextReply } from "../functions/ComponentsV2Utils.js";
import {
  enforceFeatureGate,
  safeDeferUpdate,
  safeEditReply,
  safeReply,
  safeUpdate,
} from "../functions/InteractionUtils.js";
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
      return [
        { key: "journals", name: "Journals", state },
        { key: "voting_gotm", name: "Voting & GOTM", state },
      ];
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

type FakeComponent = Interaction & {
  sent: Array<{ via: string; payload: unknown }>;
  replied: boolean;
  deferred: boolean;
};

/**
 * A button click on a message. `owner` is the user whose command the message answers
 * (none for a message the bot posted on its own, such as a voting panel).
 */
function buttonClick(options: {
  customId: string;
  channelId?: string;
  owner?: string;
  ephemeral?: boolean;
  roles?: string[];
}): FakeComponent {
  const sent: Array<{ via: string; payload: unknown }> = [];
  const record = (via: string) => async (payload: unknown) => {
    sent.push({ via, payload });
    if (via === "reply" || via === "update") interaction.replied = true;
  };
  const interaction = {
    sent,
    customId: options.customId,
    channelId: options.channelId ?? "1",
    user: { id: "42" },
    member: { roles: options.roles ?? [] },
    guild: { ownerId: "999" },
    deferred: false,
    replied: false,
    ephemeral: null,
    message: {
      interactionMetadata: options.owner ? { user: { id: options.owner } } : null,
      flags: new MessageFlagsBitField(options.ephemeral ? MessageFlags.Ephemeral : 0),
    },
    isAutocomplete: () => false,
    isChatInputCommand: () => false,
    isContextMenuCommand: () => false,
    isMessageComponent: () => true,
    isModalSubmit: () => false,
    isRepliable: () => true,
    reply: record("reply"),
    followUp: record("followUp"),
    update: record("update"),
    editReply: record("editReply"),
    deferUpdate: async () => {
      interaction.deferred = true;
    },
  } as unknown as FakeComponent;
  return interaction;
}

test("enforceFeatureGate: an Admin without the dev role can use a Preview post in bot-dev",
  async () => {
    const click = buttonClick({ customId: "vote-cast:1", channelId: BOT_DEV_CHANNEL_ID });

    assert.equal(await enforceFeatureGate(click, source("preview", true)), false);
    await safeUpdate(click as never, buildTextReply("Vote counted.", false));

    assert.deepEqual(click.sent.map((entry) => entry.via), ["update"]);
    assert.doesNotMatch(sentJson(click.sent[0].payload), /Only the command owner/);
  });

test("enforceFeatureGate: bot-dev still guards another member's command reply", async () => {
  const click = buttonClick({
    customId: "vote-cast:1",
    channelId: BOT_DEV_CHANNEL_ID,
    owner: "7",
  });

  assert.equal(await enforceFeatureGate(click, source("preview", true)), false);
  await safeUpdate(click as never, buildTextReply("Vote counted.", false));

  assert.match(sentJson(click.sent[0].payload), /Only the command owner/);
});

test("Preview note: an update of a shared message never carries it", async () => {
  const click = buttonClick({ customId: "vote-cast:1" });
  await enforceFeatureGate(click, source("preview", true));

  await safeUpdate(click as never, buildTextReply("Panel", false));

  assert.equal(click.sent[0].via, "update");
  assert.doesNotMatch(sentJson(click.sent[0].payload), /Preview - staff only/);
});

test("Preview note: an edit of a shared message after a deferred update never carries it",
  async () => {
    const click = buttonClick({ customId: "vote-cast:1" });
    await enforceFeatureGate(click, source("preview", true));

    await safeDeferUpdate(click as never);
    await safeEditReply(click as never, buildTextReply("Panel", false));

    assert.deepEqual(click.sent.map((entry) => entry.via), ["editReply"]);
    assert.doesNotMatch(sentJson(click.sent[0].payload), /Preview - staff only/);
  });

test("Preview note: the staff member's own ephemeral message and new replies carry it",
  async () => {
    const own = buttonClick({ customId: "game-journal-hmenu-add:1:2", ephemeral: true });
    await enforceFeatureGate(own, source("preview", true));
    await safeUpdate(own as never, buildTextReply("Your journal.", true));
    assert.match(sentJson(own.sent[0].payload), /Preview - staff only/);

    const shared = buttonClick({ customId: "vote-cast:1" });
    await enforceFeatureGate(shared, source("preview", true));
    await safeReply(shared as never, buildTextReply("Your vote.", true));
    assert.equal(shared.sent[0].via, "reply");
    assert.match(sentJson(shared.sent[0].payload), /Preview - staff only/);
  });
