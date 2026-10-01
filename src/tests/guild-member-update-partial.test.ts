import assert from "node:assert/strict";
import test from "node:test";
import { Collection } from "discord.js";
import type { ArgsOf, Client } from "discordx";
import { GuildMemberUpdate } from "../events/GuildMemberUpdate.command.js";

type UpdateArgs = ArgsOf<"guildMemberUpdate">;

const UNQUALIFIED_ROLE_ID = "900000000000000001";

function fakeMember(opts: {
  partial: boolean;
  nickname: string | null;
  roleIds: string[];
}): UpdateArgs[1] {
  const roles = new Collection(opts.roleIds.map((id) => [id, { id }]));
  return {
    partial: opts.partial,
    nickname: opts.nickname,
    avatar: null,
    guild: { id: "1" },
    roles: { cache: roles },
    user: { id: "42", bot: false, globalName: "Global", username: "user" },
  } as unknown as UpdateArgs[1];
}

function fakeClient(): { client: Client; fetchCalls: () => number } {
  let calls = 0;
  const client = {
    channels: {
      fetch: async () => {
        calls += 1;
        return null;
      },
    },
  } as unknown as Client;
  return { client, fetchCalls: () => calls };
}

test("guildMemberUpdate skips change logs when the old member is partial", async () => {
  const { client, fetchCalls } = fakeClient();
  const oldMember = fakeMember({ partial: true, nickname: null, roleIds: [] });
  const newMember = fakeMember({
    partial: false,
    nickname: "Nick",
    roleIds: [UNQUALIFIED_ROLE_ID],
  });

  await new GuildMemberUpdate().guildMemberUpdate([oldMember, newMember], client);

  assert.equal(fetchCalls(), 0);
});

test("guildMemberUpdate logs a role change when the old member is cached", async () => {
  const { client, fetchCalls } = fakeClient();
  const oldMember = fakeMember({ partial: false, nickname: null, roleIds: [] });
  const newMember = fakeMember({
    partial: false,
    nickname: null,
    roleIds: [UNQUALIFIED_ROLE_ID],
  });

  await new GuildMemberUpdate().guildMemberUpdate([oldMember, newMember], client);

  assert.equal(fetchCalls(), 1);
});
