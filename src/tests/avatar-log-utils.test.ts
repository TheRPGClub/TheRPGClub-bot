import assert from "node:assert/strict";
import test from "node:test";
import { AxiosError, AxiosHeaders } from "axios";
import type { GuildMember } from "discord.js";
import Member from "../classes/Member.js";
import {
  buildScanFailureDisplays,
  needsAvatarRecord,
  recordCurrentAvatars,
} from "../utilities/AvatarLogUtils.js";

const CDN_URL = "https://cdn.discordapp.com/avatars/1/abc.png";

test("needsAvatarRecord records a member with no avatar history", () => {
  assert.equal(needsAvatarRecord(undefined, "abc"), true);
});

test("needsAvatarRecord records a changed avatar hash", () => {
  assert.equal(needsAvatarRecord({ avatarHash: "old", avatarUrl: CDN_URL }, "abc"), true);
});

test("needsAvatarRecord backfills a legacy row with the same hash and no URL", () => {
  assert.equal(needsAvatarRecord({ avatarHash: "abc", avatarUrl: null }, "abc"), true);
});

test("needsAvatarRecord skips a current row that already has a URL", () => {
  assert.equal(needsAvatarRecord({ avatarHash: "abc", avatarUrl: CDN_URL }, "abc"), false);
});

function fakeMember(id: string, avatar: string | null = "abc"): GuildMember {
  return {
    avatar: null,
    displayAvatarURL: () => `https://cdn.discordapp.com/avatars/${id}/${avatar}.png`,
    user: { avatar, bot: false, id },
  } as unknown as GuildMember;
}

function unprocessableError(userId: string): AxiosError {
  const config = {
    data: JSON.stringify({ data: { avatar_hash: "abc" } }),
    headers: new AxiosHeaders(),
    method: "post",
    url: `/api/v1/users/${userId}/avatar_history`,
  };
  return new AxiosError("Request failed with status code 422", "ERR_BAD_REQUEST", config, null, {
    config,
    data: { error: "Validation failed: User must exist" },
    headers: {},
    status: 422,
    statusText: "Unprocessable Entity",
  });
}

test("recordCurrentAvatars reports a member whose save is rejected with 422", async (t) => {
  t.mock.method(Member, "getAvatarHistory", async () => []);
  t.mock.method(Member, "insertAvatarHistoryRecord", async (userId: string) => {
    if (userId === "2") throw unprocessableError(userId);
    return true;
  });
  t.mock.method(console, "error", () => undefined);

  const result = await recordCurrentAvatars([fakeMember("1"), fakeMember("2")]);

  assert.equal(result.recorded, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].userId, "2");
  assert.match(result.failures[0].detail, /"status": 422/);
  assert.match(result.failures[0].detail, /User must exist/);
  assert.match(result.failures[0].detail, /\/api\/v1\/users\/2\/avatar_history/);
});

test("recordCurrentAvatars counts a save that returns no record as failed", async (t) => {
  t.mock.method(Member, "getAvatarHistory", async () => []);
  t.mock.method(Member, "insertAvatarHistoryRecord", async () => false);
  t.mock.method(console, "error", () => undefined);

  const result = await recordCurrentAvatars([fakeMember("3")]);

  assert.equal(result.recorded, 0);
  assert.equal(result.failed, 1);
  assert.equal(result.failures[0].userId, "3");
  assert.match(result.failures[0].detail, /"status": 404/);
});

test("recordCurrentAvatars skips members without an avatar", async (t) => {
  const insert = t.mock.method(Member, "insertAvatarHistoryRecord", async () => true);

  const result = await recordCurrentAvatars([fakeMember("4", null)]);

  assert.equal(result.skipped, 1);
  assert.equal(result.failures.length, 0);
  assert.equal(insert.mock.callCount(), 0);
});

test("buildScanFailureDisplays caps the detailed list and notes the rest", () => {
  const failures = ["1", "2", "3", "4", "5"].map((userId) => ({
    detail: "x".repeat(5000),
    userId,
  }));

  const texts = displayContents(failures);

  assert.equal(texts.length, 4);
  assert.equal(texts.slice(0, 3).every((text) => text.length <= 1000), true);
  assert.match(texts[0], /<@1> \(1\)/);
  assert.match(texts[3], /2 more failures not shown/);
  assert.equal(texts.join("").length < 3500, true);
});

test("buildScanFailureDisplays returns nothing when there were no failures", () => {
  assert.deepEqual(displayContents([]), []);
});

function displayContents(failures: { detail: string; userId: string }[]): string[] {
  return buildScanFailureDisplays(failures).map((display) => display.toJSON().content);
}
