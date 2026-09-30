import test from "node:test";
import assert from "node:assert/strict";
import { MessageFlags } from "discord.js";
import { MetadataStorage } from "discordx";
import { UserContextMenus } from "../commands/user-context-menus.command.js";

const DISCORD_USER_CONTEXT_MENU_LIMIT = 5;

test("user context menus register within Discord's per-app limit", async () => {
  await MetadataStorage.instance.build();
  const names = MetadataStorage.instance.applicationCommandUsers.map((cmd) => cmd.name);

  for (const name of ["View profile", "Now playing", "Compare completions"]) {
    assert.ok(names.includes(name), `missing user context menu "${name}"`);
  }
  assert.ok(names.length <= DISCORD_USER_CONTEXT_MENU_LIMIT);
});

test("compare completions on yourself replies privately without comparing", async () => {
  const calls: Array<{ kind: string; payload: any }> = [];
  const interaction: any = {
    user: { id: "123" },
    targetUser: { id: "123" },
    deferred: false,
    replied: false,
    deferReply: async (payload: any) => {
      calls.push({ kind: "defer", payload });
      interaction.deferred = true;
    },
    editReply: async (payload: any) => {
      calls.push({ kind: "edit", payload });
      interaction.replied = true;
    },
    reply: async (payload: any) => {
      calls.push({ kind: "reply", payload });
    },
    followUp: async (payload: any) => {
      calls.push({ kind: "followUp", payload });
    },
  };

  await new UserContextMenus().compareCompletions(interaction);

  assert.equal(calls[0]?.kind, "defer");
  assert.ok((calls[0].payload.flags & MessageFlags.Ephemeral) !== 0);
  const answer = calls.find((call) => call.kind !== "defer");
  assert.ok(answer, "expected a reply after deferring");
  assert.match(JSON.stringify(answer.payload), /another member/);
});
