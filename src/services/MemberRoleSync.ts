import axios from "axios";
import type { GuildMember, PartialGuildMember } from "discord.js";
import Member from "../classes/Member.js";
import { HOME_GUILD_ID } from "../config/guilds.js";
import { IS_TEST_MODE } from "../config/testMode.js";
import { describeRequestError } from "../utilities/ApiErrorUtils.js";
import { logError } from "../utilities/LogUtils.js";
import { memberRoleIds } from "../utilities/MemberRoleUtils.js";
import { apiPut } from "./RpgClubApiClient.js";
import { memberEventWritesEnabled } from "./MemberEventWrites.js";

/**
 * Role sync: the bot reports a member's Discord role IDs to the API so the website's
 * Admin, Moderator, Regulars and Members access follows Discord straight away.
 */

/** API calls the role report makes. `put` resolves null on a 404. */
export interface IRoleReportClient {
  put(path: string, body: unknown): Promise<unknown | null>;
  upsertMember(member: GuildMember): Promise<void>;
}

const defaultClient: IRoleReportClient = {
  put: (path, body) => apiPut(path, body),
  upsertMember: (member) => Member.upsertGuildMember(member),
};

function rolesChanged(
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember,
): boolean {
  // An uncached old member has no roles to diff against, so report the current ones.
  if (oldMember.partial) return true;
  const before = memberRoleIds(oldMember);
  const after = memberRoleIds(newMember);
  return before.length !== after.length || before.some((id, i) => id !== after[i]);
}

const DUPLICATE_VALUE_TEXT = "duplicate value violates a unique constraint";

/** The API's 422 for a unique insert that lost a race with another insert of the row. */
function isDuplicateInsert(err: unknown): boolean {
  if (!axios.isAxiosError(err) || err.response?.status !== 422) return false;
  return JSON.stringify(err.response.data ?? "").includes(DUPLICATE_VALUE_TEXT);
}

/**
 * Reports the member's roles with `PUT /users/:id/roles`. The API answers 404 for a
 * user it has no record of, so that member is upserted instead (the upsert carries
 * the role IDs too). A new member's join upsert can insert the row first, failing the
 * fallback's insert; the row then exists, so the PUT is sent once more.
 */
export async function reportMemberRoles(
  member: GuildMember,
  client: IRoleReportClient = defaultClient,
): Promise<void> {
  const path = `/api/v1/users/${member.user.id}/roles`;
  const body = { data: { role_ids: memberRoleIds(member) } };
  try {
    const result = await client.put(path, body);
    if (result === null) {
      await upsertOrRetryPut(member, client, path, body);
    }
  } catch (err: unknown) {
    logError("MemberRoleSync.reportMemberRoles", describeRequestError(err));
  }
}

async function upsertOrRetryPut(
  member: GuildMember,
  client: IRoleReportClient,
  path: string,
  body: unknown,
): Promise<void> {
  try {
    await client.upsertMember(member);
  } catch (err: unknown) {
    if (!isDuplicateInsert(err)) throw err;
    await client.put(path, body);
  }
}

/** Reports a guild member update to the API when the member's roles changed. */
export async function recordRoleChange(
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember,
  opts: { client?: IRoleReportClient; testMode?: boolean; homeGuildId?: string } = {},
): Promise<void> {
  if (!memberEventWritesEnabled(opts.testMode ?? IS_TEST_MODE)) return;
  if (newMember.user.bot) return;
  // Only the club's roles set website access; another guild's set would clear it.
  if (newMember.guild.id !== (opts.homeGuildId ?? HOME_GUILD_ID)) return;
  if (!rolesChanged(oldMember, newMember)) return;
  await reportMemberRoles(newMember, opts.client);
}
