import assert from "node:assert/strict";
import test from "node:test";
import { needsAvatarRecord } from "../utilities/AvatarLogUtils.js";

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
