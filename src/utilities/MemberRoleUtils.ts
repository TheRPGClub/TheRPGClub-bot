import type { GuildMember } from "discord.js";
import { HOME_GUILD_ID } from "../config/guilds.js";

type RoleHolder = Pick<GuildMember, "roles" | "guild">;

/** The member's role IDs, sorted, without the guild's @everyone role. */
export function memberRoleIds(member: RoleHolder): string[] {
  return [...member.roles.cache.keys()]
    .filter((id) => id !== member.guild.id)
    .sort();
}

/**
 * The member's role IDs when they belong to the home guild, else undefined. Only the
 * club's roles may set website access: a role set from any other guild would clear it.
 */
export function homeGuildRoleIds(
  member: RoleHolder,
  homeGuildId: string = HOME_GUILD_ID,
): string[] | undefined {
  return member.guild.id === homeGuildId ? memberRoleIds(member) : undefined;
}
