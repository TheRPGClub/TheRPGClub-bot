import type { GuildMember } from "discord.js";

type RoleHolder = Pick<GuildMember, "roles" | "guild">;

/** The member's role IDs, sorted, without the guild's @everyone role. */
export function memberRoleIds(member: RoleHolder): string[] {
  return [...member.roles.cache.keys()]
    .filter((id) => id !== member.guild.id)
    .sort();
}
