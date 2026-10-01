import assert from "node:assert/strict";
import test from "node:test";
import type { GuildMember, User } from "discord.js";
import Member from "../classes/Member.js";
import {
  memberEventWritesEnabled,
  recordAvatarChange,
  recordJoinedMember,
  recordNicknameChange,
} from "../services/MemberEventWrites.js";

const JOINED_AT = new Date("2026-01-02T03:04:05Z");
const AVATAR_URL = "https://cdn.discordapp.com/avatars/123/abc.png";

function fakeUser(): User {
  return { id: "123", bot: false, username: "tester", avatar: "abc" } as unknown as User;
}

function fakeMember(): GuildMember {
  return {
    user: fakeUser(),
    avatar: null,
    joinedAt: JOINED_AT,
    displayAvatarURL: () => AVATAR_URL,
  } as unknown as GuildMember;
}

test("memberEventWritesEnabled is false only in test mode", () => {
  assert.equal(memberEventWritesEnabled(false), true);
  assert.equal(memberEventWritesEnabled(true), false);
});

test("recordJoinedMember upserts the user and records the avatar outside test mode", async (t) => {
  const upsert = t.mock.method(Member, "upsertGuildMember", async () => undefined);
  const history = t.mock.method(Member, "getAvatarHistory", async () => []);
  t.mock.method(Member, "upsertDiscordUser", async () => undefined);
  const insert = t.mock.method(Member, "insertAvatarHistoryRecord", async () => true);

  await recordJoinedMember(fakeMember(), false);

  assert.equal(upsert.mock.callCount(), 1);
  assert.equal(history.mock.callCount(), 1);
  assert.equal(insert.mock.callCount(), 1);
});

test("recordJoinedMember writes nothing in test mode", async (t) => {
  const upsert = t.mock.method(Member, "upsertGuildMember", async () => undefined);
  const history = t.mock.method(Member, "getAvatarHistory", async () => []);
  const insert = t.mock.method(Member, "insertAvatarHistoryRecord", async () => true);

  await recordJoinedMember(fakeMember(), true);

  assert.equal(upsert.mock.callCount(), 0);
  assert.equal(history.mock.callCount(), 0);
  assert.equal(insert.mock.callCount(), 0);
});

test("recordAvatarChange saves a history row outside test mode", async (t) => {
  const upsert = t.mock.method(Member, "upsertDiscordUser", async () => undefined);
  const insert = t.mock.method(Member, "insertAvatarHistoryRecord", async () => true);

  const saved = await recordAvatarChange(fakeUser(), AVATAR_URL, "abc", false);

  assert.equal(saved, true);
  assert.equal(upsert.mock.callCount(), 1);
  assert.equal(insert.mock.callCount(), 1);
});

test("recordAvatarChange writes nothing in test mode", async (t) => {
  const upsert = t.mock.method(Member, "upsertDiscordUser", async () => undefined);
  const insert = t.mock.method(Member, "insertAvatarHistoryRecord", async () => true);

  const saved = await recordAvatarChange(fakeUser(), AVATAR_URL, "abc", true);

  assert.equal(saved, false);
  assert.equal(upsert.mock.callCount(), 0);
  assert.equal(insert.mock.callCount(), 0);
});

test("recordNicknameChange upserts the new display name outside test mode", async (t) => {
  const upsert = t.mock.method(Member, "upsert", async () => undefined);

  await recordNicknameChange(fakeMember(), "New Name", false);

  assert.equal(upsert.mock.callCount(), 1);
  const record = upsert.mock.calls[0]?.arguments[0];
  assert.equal(record?.userId, "123");
  assert.equal(record?.globalName, "New Name");
  assert.equal(record?.serverJoinedAt, JOINED_AT);
});

test("recordNicknameChange writes nothing in test mode", async (t) => {
  const upsert = t.mock.method(Member, "upsert", async () => undefined);

  await recordNicknameChange(fakeMember(), "New Name", true);

  assert.equal(upsert.mock.callCount(), 0);
});
