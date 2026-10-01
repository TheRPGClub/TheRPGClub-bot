import type { GuildMember, User } from "discord.js";
import Member, { type IMemberRecord } from "../classes/Member.js";
import { IS_TEST_MODE } from "../config/testMode.js";
import { logError } from "../utilities/LogUtils.js";
import {
  recordCurrentAvatarIfNew,
  updateAvatarRecordFromUrl,
} from "../utilities/AvatarLogUtils.js";

/**
 * API writes made by the member and user event handlers.
 *
 * A PR preview in the test guild talks to the production API. A test account joining
 * would upsert its user and join date (clearing a real member's departed state), and
 * every real member the preview can see would get duplicate avatar history rows and
 * nickname upserts. Each write here is skipped in test mode; the log channel posts the
 * handlers make on their own still run. Any new member event write belongs here.
 */
export function memberEventWritesEnabled(testMode: boolean = IS_TEST_MODE): boolean {
  return !testMode;
}

/** Upserts a joining member, then records their current avatar if it is new. */
export async function recordJoinedMember(
  member: GuildMember,
  testMode: boolean = IS_TEST_MODE,
): Promise<void> {
  if (!memberEventWritesEnabled(testMode)) return;
  // Sequential: both upsert the user, and concurrent upserts can race on the insert.
  await Member.upsertGuildMember(member)
    .catch((err: any) => logError("GuildMemberAdd.upsertUser", err?.message ?? err))
    .then(() => recordCurrentAvatarIfNew(member))
    .catch((err: any) => logError("GuildMemberAdd.recordAvatar", err?.message ?? err));
}

/** Records a changed avatar. Returns true when a new history row was saved. */
export async function recordAvatarChange(
  user: User,
  avatarUrl: string,
  avatarHash: string,
  testMode: boolean = IS_TEST_MODE,
): Promise<boolean> {
  if (!memberEventWritesEnabled(testMode)) return false;
  return updateAvatarRecordFromUrl(user, avatarUrl, avatarHash);
}

/** Upserts a member's new display name. */
export async function recordNicknameChange(
  member: GuildMember,
  globalName: string | null,
  testMode: boolean = IS_TEST_MODE,
): Promise<void> {
  if (!memberEventWritesEnabled(testMode)) return;
  const user = member.user;
  const record: IMemberRecord = {
    userId: user.id,
    isBot: user.bot ? 1 : 0,
    username: user.username ?? null,
    globalName,
    avatarBlob: null,
    serverJoinedAt: member.joinedAt ?? null,
    serverLeftAt: null,
    lastSeenAt: null,
    roleAdmin: 0,
    roleModerator: 0,
    roleRegular: 0,
    roleMember: 0,
    roleNewcomer: 0,
    messageCount: null,
    completionatorUrl: null,
    psnUsername: null,
    xblUsername: null,
    nswFriendCode: null,
    steamUrl: null,
    profileImage: null,
    profileImageAt: null,
  };

  try {
    await Member.upsert(record);
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    logError("GuildMemberUpdate.upsertNicknameChange", msg);
  }
}
