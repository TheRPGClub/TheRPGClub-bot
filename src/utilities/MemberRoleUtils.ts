import type { GuildMember, GuildMemberRoleManager, Interaction } from "discord.js";
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

/** An interaction's member: a cached GuildMember, or the raw API member (roles: string[]). */
type InteractionRoleHolder = Pick<NonNullable<Interaction["member"]>, "roles">;

/**
 * True when the member holds any of `roleIds`. A cached GuildMember exposes a role manager;
 * a raw API member exposes a string[]; no member (outside a guild) holds nothing.
 */
export function memberHasAnyRole(
  member: InteractionRoleHolder | null | undefined,
  roleIds: readonly string[],
): boolean {
  const roles: GuildMemberRoleManager | readonly string[] | undefined = member?.roles;
  if (!roles) return false;
  if (Array.isArray(roles)) return roleIds.some((roleId) => roles.includes(roleId));
  const cache = (roles as GuildMemberRoleManager).cache;
  if (typeof cache?.has !== "function") return false;
  return roleIds.some((roleId) => cache.has(roleId));
}
