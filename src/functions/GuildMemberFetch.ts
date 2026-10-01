import {
  GatewayRateLimitError,
  type Collection,
  type Guild,
  type GuildMember,
} from "discord.js";
import { sleep } from "../utilities/DelayUtils.js";

/** Longest rate limit wait worth sitting out before giving up on a full member fetch. */
export const FULL_MEMBER_FETCH_MAX_WAIT_MS = 60_000;

/**
 * Requests the whole member list over the gateway. Discord rate limits these requests per
 * guild, so only paths that need every member use this: the startup emoji sync, which must
 * see members with no DB row and deletes emoji for anyone it does not see, and the admin
 * member and avatar scans. Everything else fetches by ID, with `members.fetch(id)` or
 * `members.fetch({ user: ids })`.
 *
 * A rate limited request waits out Discord's `retry_after` and tries once more.
 */
export async function fetchAllGuildMembers(
  guild: Guild,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<Collection<string, GuildMember>> {
  try {
    return await guild.members.fetch();
  } catch (err) {
    if (!(err instanceof GatewayRateLimitError)) throw err;
    const waitMs = Math.ceil(err.data.retry_after * 1000);
    if (waitMs > FULL_MEMBER_FETCH_MAX_WAIT_MS) throw err;
    await wait(waitMs);
    return guild.members.fetch();
  }
}
