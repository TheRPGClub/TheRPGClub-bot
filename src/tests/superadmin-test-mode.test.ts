import test from "node:test";
import assert from "node:assert/strict";
import type { CommandInteraction } from "discord.js";

// Test mode is read once at module load, so every module that reaches
// src/config/ must be imported dynamically below this assignment.
process.env.TEST_GUILD_ID = "1547802424301854770";

const { SuperAdmin } = await import("../commands/superadmin.command.js");

const OWNER_ID = "42";

function fakeOwnerInteraction(): { interaction: CommandInteraction; payloads: unknown[] } {
  const payloads: unknown[] = [];
  const fake = {
    deferred: false,
    replied: false,
    user: { id: OWNER_ID },
    guild: {
      ownerId: OWNER_ID,
      members: {
        fetch: (): never => {
          throw new Error("memberscan fetched members in test mode");
        },
      },
    },
    isChatInputCommand: (): boolean => true,
    isMessageComponent: (): boolean => false,
    isModalSubmit: (): boolean => false,
    isRepliable: (): boolean => true,
    async deferReply(): Promise<void> {
      fake.deferred = true;
    },
    async editReply(payload: unknown): Promise<void> {
      payloads.push(payload);
    },
    async followUp(payload: unknown): Promise<void> {
      payloads.push(payload);
    },
    async reply(payload: unknown): Promise<void> {
      fake.replied = true;
      payloads.push(payload);
    },
  };
  return { interaction: fake as unknown as CommandInteraction, payloads };
}

for (const [name, run] of [
  ["memberscan", (i: CommandInteraction) => new SuperAdmin().memberScan(i)],
  ["download-missing-images", (i: CommandInteraction) => new SuperAdmin().downloadMissingImages(i)],
] as const) {
  test(`/superadmin ${name} refuses in test mode without writing`, async () => {
    const { interaction, payloads } = fakeOwnerInteraction();
    await run(interaction);

    assert.equal(payloads.length, 1);
    assert.match(JSON.stringify(payloads[0]), /is disabled in test mode/);
  });
}
