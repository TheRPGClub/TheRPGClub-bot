import { PermissionsBitField } from "discord.js";
import {
  ACCESS_DENIED_MOD_ADMIN,
  ACCESS_DENIED_SERVER_OWNER,
  AnyRepliable,
  memberHasPermission,
  safeReply,
} from "../../functions/InteractionUtils.js";
import { buildTodoTextReply } from "./todoComponents.js";

export function getTodoPermissionFlags(interaction: AnyRepliable): {
  isOwner: boolean;
  isAdmin: boolean;
  isModerator: boolean;
} | null {
  const guild = interaction.guild;
  if (!guild) return null;

  const isOwner = guild.ownerId === interaction.user.id;
  const isAdmin = memberHasPermission(
    interaction,
    PermissionsBitField.Flags.Administrator,
  );
  const isModerator = memberHasPermission(
    interaction,
    PermissionsBitField.Flags.ManageMessages,
  );

  return { isOwner, isAdmin, isModerator };
}

export async function requireModeratorOrAdminOrOwner(
  interaction: AnyRepliable,
): Promise<boolean> {
  const permissions = getTodoPermissionFlags(interaction);
  if (!permissions) {
    await safeReply(
      interaction,
      buildTodoTextReply("This command can only be used inside a server.", true),
    );
    return false;
  }

  if (permissions.isOwner || permissions.isAdmin || permissions.isModerator) {
    return true;
  }

  await safeReply(
    interaction,
    buildTodoTextReply(
      ACCESS_DENIED_MOD_ADMIN,
      true,
    ),
  );
  return false;
}

export async function requireOwner(interaction: AnyRepliable): Promise<boolean> {
  const permissions = getTodoPermissionFlags(interaction);
  if (!permissions) {
    await safeReply(
      interaction,
      buildTodoTextReply("This command can only be used inside a server.", true),
    );
    return false;
  }

  if (permissions.isOwner) {
    return true;
  }

  await safeReply(
    interaction,
    buildTodoTextReply(ACCESS_DENIED_SERVER_OWNER, true),
  );
  return false;
}
