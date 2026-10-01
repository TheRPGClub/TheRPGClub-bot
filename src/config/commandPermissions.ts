import { PermissionFlagsBits } from "discord.js";

// Default member permissions for staff-only slash command groups. These only hide a command
// from the `/` picker for members who lack the permission; server admins can override them in
// Server Settings > Integrations. The runtime checks in admin-auth.utils.ts and isSuperAdmin
// stay the real authorization, so each value here matches what that check requires.

/** Matches isAdmin(): the Administrator permission. */
export const ADMIN_COMMAND_PERMISSIONS = PermissionFlagsBits.Administrator;

/** Matches isModerator(): Manage Messages, which Administrator also grants. */
export const MOD_COMMAND_PERMISSIONS = PermissionFlagsBits.ManageMessages;

/**
 * isSuperAdmin() requires the guild owner, which no permission flag expresses. The owner always
 * holds Administrator, so this hides the group from everyone else short of an admin.
 */
export const SUPERADMIN_COMMAND_PERMISSIONS = PermissionFlagsBits.Administrator;
