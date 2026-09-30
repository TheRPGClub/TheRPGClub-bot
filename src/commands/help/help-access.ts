import { PermissionsBitField, type Interaction } from "discord.js";

export type HelpAccessLevel = "member" | "moderator" | "admin" | "owner";

export type HelpAccess = Readonly<Record<HelpAccessLevel, boolean>>;

type HelpAccessSource = Pick<Interaction, "guild" | "memberPermissions" | "user">;

/**
 * Silent version of the isModerator/isAdmin/isSuperAdmin gates, for deciding what help to
 * list. memberPermissions is resolved for the invoking channel, like permissionsIn, and is
 * present on autocomplete interactions, which the gate helpers do not accept.
 */
export function getHelpAccess(interaction: HelpAccessSource): HelpAccess {
  const permissions = interaction.memberPermissions;
  const admin = permissions?.has(PermissionsBitField.Flags.Administrator) ?? false;
  const moderator = admin || (permissions?.has(PermissionsBitField.Flags.ManageMessages) ?? false);
  const owner = Boolean(interaction.guild) && interaction.guild?.ownerId === interaction.user.id;
  return { member: true, moderator, admin, owner };
}

export function canUseHelpLevel(access: HelpAccess, level: HelpAccessLevel | undefined): boolean {
  return access[level ?? "member"];
}
