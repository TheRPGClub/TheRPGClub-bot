import assert from "node:assert/strict";
import test from "node:test";
import { Collection, type GuildMember } from "discord.js";
import { recordRoleChange, type IRoleReportClient } from "../services/MemberRoleSync.js";
import { memberRoleIds } from "../utilities/MemberRoleUtils.js";
import { HOME_GUILD_ID } from "../config/guilds.js";

const GUILD_ID = HOME_GUILD_ID;
const OTHER_GUILD_ID = "100000000000000000";
const ADMIN = "461891227613265940";
const MEMBERS = "747520789003239530";

function fakeMember(opts: {
  roleIds: string[];
  partial?: boolean;
  bot?: boolean;
  guildId?: string;
}): GuildMember {
  const roles = new Collection(opts.roleIds.map((id) => [id, { id }]));
  return {
    partial: opts.partial ?? false,
    guild: { id: opts.guildId ?? GUILD_ID },
    roles: { cache: roles },
    user: { id: "42", bot: opts.bot ?? false },
  } as unknown as GuildMember;
}

type Call = { kind: "put" | "upsert"; path?: string; body?: unknown; member?: GuildMember };

function fakeClient(putResult: unknown = { data: {} }): {
  client: IRoleReportClient;
  calls: Call[];
} {
  const calls: Call[] = [];
  const client: IRoleReportClient = {
    put: async (path, body) => {
      calls.push({ kind: "put", path, body });
      return putResult;
    },
    upsertMember: async (member) => {
      calls.push({ kind: "upsert", member });
    },
  };
  return { client, calls };
}

test("memberRoleIds lists the member's roles without @everyone", () => {
  const member = fakeMember({ roleIds: [GUILD_ID, MEMBERS, ADMIN] });

  assert.deepEqual(memberRoleIds(member), [ADMIN, MEMBERS]);
});

test("a role change reports the new role IDs to PUT /users/:id/roles", async () => {
  const { client, calls } = fakeClient();
  const oldMember = fakeMember({ roleIds: [GUILD_ID, MEMBERS] });
  const newMember = fakeMember({ roleIds: [GUILD_ID, MEMBERS, ADMIN] });

  await recordRoleChange(oldMember, newMember, { client, testMode: false });

  assert.deepEqual(calls, [
    {
      kind: "put",
      path: "/api/v1/users/42/roles",
      body: { data: { role_ids: [ADMIN, MEMBERS] } },
    },
  ]);
});

test("losing every role reports an empty list", async () => {
  const { client, calls } = fakeClient();
  const oldMember = fakeMember({ roleIds: [GUILD_ID, MEMBERS] });
  const newMember = fakeMember({ roleIds: [GUILD_ID] });

  await recordRoleChange(oldMember, newMember, { client, testMode: false });

  assert.deepEqual(calls[0]?.body, { data: { role_ids: [] } });
});

test("an update with no role change reports nothing", async () => {
  const { client, calls } = fakeClient();
  const oldMember = fakeMember({ roleIds: [GUILD_ID, MEMBERS] });
  const newMember = fakeMember({ roleIds: [MEMBERS, GUILD_ID] });

  await recordRoleChange(oldMember, newMember, { client, testMode: false });

  assert.equal(calls.length, 0);
});

test("an uncached old member reports the current roles", async () => {
  const { client, calls } = fakeClient();
  const oldMember = fakeMember({ roleIds: [], partial: true });
  const newMember = fakeMember({ roleIds: [GUILD_ID, MEMBERS] });

  await recordRoleChange(oldMember, newMember, { client, testMode: false });

  assert.deepEqual(calls[0]?.body, { data: { role_ids: [MEMBERS] } });
});

test("a bot's role change reports nothing", async () => {
  const { client, calls } = fakeClient();
  const oldMember = fakeMember({ roleIds: [], bot: true });
  const newMember = fakeMember({ roleIds: [MEMBERS], bot: true });

  await recordRoleChange(oldMember, newMember, { client, testMode: false });

  assert.equal(calls.length, 0);
});

test("test mode reports nothing", async () => {
  const { client, calls } = fakeClient();
  const oldMember = fakeMember({ roleIds: [] });
  const newMember = fakeMember({ roleIds: [MEMBERS] });

  await recordRoleChange(oldMember, newMember, { client, testMode: true });

  assert.equal(calls.length, 0);
});

test("an unknown member (404) is upserted with their roles instead", async () => {
  const { client, calls } = fakeClient(null);
  const oldMember = fakeMember({ roleIds: [] });
  const newMember = fakeMember({ roleIds: [MEMBERS] });

  await recordRoleChange(oldMember, newMember, { client, testMode: false });

  assert.deepEqual(
    calls.map((call) => call.kind),
    ["put", "upsert"],
  );
  assert.equal(calls[1]?.member, newMember);
});

test("an API failure is logged, not thrown", async (t) => {
  const errors = t.mock.method(console, "error", () => undefined);
  const client: IRoleReportClient = {
    put: async () => {
      throw new Error("boom");
    },
    upsertMember: async () => undefined,
  };
  const oldMember = fakeMember({ roleIds: [] });
  const newMember = fakeMember({ roleIds: [MEMBERS] });

  await recordRoleChange(oldMember, newMember, { client, testMode: false });

  assert.equal(errors.mock.callCount(), 1);
});

test("a role change in another guild reports nothing", async () => {
  const { client, calls } = fakeClient();
  const oldMember = fakeMember({ roleIds: [OTHER_GUILD_ID], guildId: OTHER_GUILD_ID });
  const newMember = fakeMember({ roleIds: [OTHER_GUILD_ID, ADMIN], guildId: OTHER_GUILD_ID });

  await recordRoleChange(oldMember, newMember, { client, testMode: false });

  assert.deepEqual(calls, []);
});
