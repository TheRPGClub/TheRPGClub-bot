import type { Client, Guild } from "discord.js";
import Member from "../classes/Member.js";
import { HOME_GUILD_ID } from "../config/guilds.js";
import { fetchAllGuildMembers } from "./GuildMemberFetch.js";
import { logError } from "../utilities/LogUtils.js";

/** What a member scan did: rows upserted, upserts that failed, members marked departed. */
export interface IMemberScanCounts {
  upserted: number;
  failed: number;
  departed: number;
}

/** The scan's summary, shown by /superadmin memberscan and sent as the job's result text. */
export function buildMemberScanSummary(counts: IMemberScanCounts): string {
  return `Member scan complete. Upserts succeeded: ${counts.upserted}. ` +
    `Failed: ${counts.failed}. Marked departed: ${counts.departed}.`;
}

/**
 * Fetches every member of the guild, marks members no longer in it departed, and upserts
 * each member's profile. A failed upsert is logged and counted, never thrown; a failed
 * member fetch or departed write throws. Callers apply the shared-state guard first.
 */
export async function scanGuildMembers(guild: Guild): Promise<IMemberScanCounts> {
  const members = await fetchAllGuildMembers(guild);
  const departed = await Member.markDepartedNotIn(Array.from(members.keys()));
  let upserted = 0;
  let failed = 0;
  for (const member of members.values()) {
    try {
      await Member.upsertGuildMember(member);
      upserted++;
    } catch (err) {
      failed++;
      logError("MemberScan.upsertUser", err);
    }
  }
  return { upserted, failed, departed };
}

/** scanGuildMembers on the home guild, for the website's memberscan job. */
export async function runMemberScan(client: Client): Promise<IMemberScanCounts> {
  const guild = await client.guilds.fetch(HOME_GUILD_ID);
  return scanGuildMembers(guild);
}
