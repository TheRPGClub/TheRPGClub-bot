import assert from "node:assert/strict";
import test from "node:test";
import axios, { AxiosError, type AxiosAdapter } from "axios";
import { Collection, type GuildMember } from "discord.js";

process.env.RPGCLUB_API_BASE_URL = "https://api.example.test";
process.env.RPGCLUB_BOT_API_TOKEN = "token";

type Recorded = { method: string; url: string; body: unknown };

const requests: Recorded[] = [];
let statusFor: (method: string) => number = () => 200;

const adapter: AxiosAdapter = async (config) => {
  const method = String(config.method).toUpperCase();
  requests.push({
    method,
    url: String(config.url),
    body: typeof config.data === "string" ? JSON.parse(config.data) : config.data,
  });
  const status = statusFor(method);
  const response = { data: { data: {} }, status, statusText: "", headers: {}, config };
  if (status >= 400) {
    throw new AxiosError("failed", "ERR_BAD_REQUEST", config, null, response);
  }
  return response;
};
axios.defaults.adapter = adapter;

const { default: Member } = await import("../classes/Member.js");
const { recordMemberDeparture, reportMemberRoles } = await import(
  "../services/MemberRoleSync.js",
);
const { HOME_GUILD_ID } = await import("../config/guilds.js");

const GUILD_ID = HOME_GUILD_ID;
const OTHER_GUILD_ID = "100000000000000000";
const MEMBERS = "747520789003239530";
const REGULARS = "267883288817958912";
const JOINED_AT = new Date("2026-01-02T03:04:05Z");

function fakeMember(roleIds: string[], guildId = GUILD_ID): GuildMember {
  return {
    guild: { id: guildId },
    roles: { cache: new Collection(roleIds.map((id) => [id, { id }])) },
    joinedAt: JOINED_AT,
    user: { id: "42", bot: false, username: "tester", globalName: "Tester" },
  } as unknown as GuildMember;
}

test("upserting a guild member (member scan, join) sends their role IDs", async () => {
  requests.length = 0;
  statusFor = () => 200;

  await Member.upsertGuildMember(fakeMember([GUILD_ID, REGULARS, MEMBERS]));

  assert.deepEqual(requests, [
    {
      method: "POST",
      url: "/api/v1/users/upsert",
      body: {
        data: {
          discord_id: "42",
          username: "tester",
          global_name: "Tester",
          is_bot: false,
          server_left_at: null,
          server_joined_at: "2026-01-02T03:04:05.000Z",
          role_ids: [REGULARS, MEMBERS],
        },
      },
    },
  ]);
});

test("a role report for an unknown member falls back to an upsert with roles", async () => {
  requests.length = 0;
  statusFor = (method) => (method === "PUT" ? 404 : 201);

  await reportMemberRoles(fakeMember([GUILD_ID, MEMBERS]));

  assert.deepEqual(
    requests.map((r) => `${r.method} ${r.url}`),
    ["PUT /api/v1/users/42/roles", "POST /api/v1/users/upsert"],
  );
  assert.deepEqual(requests[0]?.body, { data: { role_ids: [MEMBERS] } });
  const upsertBody = requests[1]?.body as { data: { role_ids: string[] } } | undefined;
  assert.deepEqual(upsertBody?.data.role_ids, [MEMBERS]);
});

test("upserting a member of another guild leaves their roles alone", async () => {
  requests.length = 0;
  statusFor = () => 200;

  await Member.upsertGuildMember(fakeMember([OTHER_GUILD_ID, MEMBERS], OTHER_GUILD_ID));

  const body = requests[0]?.body as { data: Record<string, unknown> } | undefined;
  assert.equal(body?.data.discord_id, "42");
  assert.equal("role_ids" in (body?.data ?? {}), false);
});

test("a departure for a user the API doesn't know sends only the empty role PUT", async () => {
  requests.length = 0;
  statusFor = (method) => (method === "PUT" ? 404 : 201);

  await recordMemberDeparture(fakeMember([GUILD_ID, MEMBERS]), { testMode: false });

  assert.deepEqual(requests, [
    { method: "PUT", url: "/api/v1/users/42/roles", body: { data: { role_ids: [] } } },
  ]);
});
