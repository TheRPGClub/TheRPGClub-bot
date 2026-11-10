import { PermissionsBitField, type Interaction } from "discord.js";

import { ADMIN_ROLE_ID, DEV_ROLE_ID } from "../../config/roles.js";
import { memberHasAnyRole } from "../../utilities/MemberRoleUtils.js";

/**
 * `staff` is Feature Flag staff (/flag): the API's Admins and Superadmins, by the Admin or
 * dev role, which a Superadmin can hold without Discord's Administrator permission.
 */
export type HelpAccessLevel = "member" | "moderator" | "admin" | "staff" | "owner";

export type HelpAccess = Readonly<Record<HelpAccessLevel, boolean>>;

type HelpAccessSource = Pick<Interaction, "guild" | "member" | "memberPermissions" | "user">;

const STAFF_ROLE_IDS = [ADMIN_ROLE_ID, DEV_ROLE_ID];

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
  const staff = admin || memberHasAnyRole(interaction.member, STAFF_ROLE_IDS);
  return { member: true, moderator, admin, staff, owner };
}

export function canUseHelpLevel(access: HelpAccess, level: HelpAccessLevel | undefined): boolean {
  return access[level ?? "member"];
}
