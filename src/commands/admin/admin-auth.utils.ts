import { MessageFlags, PermissionsBitField } from "discord.js";
import {
  ACCESS_DENIED_ADMIN,
  ACCESS_DENIED_MOD,
  AnyRepliable,
  memberHasPermission,
  safeReply,
} from "../../functions/InteractionUtils.js";
import { buildTextReply } from "../../functions/ComponentsV2Utils.js";

export async function isAdmin(interaction: AnyRepliable): Promise<boolean> {
  const isAdmin = memberHasPermission(
    interaction,
    PermissionsBitField.Flags.Administrator,
  );

  if (!isAdmin) {
    try {
      await safeReply(interaction, buildTextReply(ACCESS_DENIED_ADMIN, true));
    } catch {
      // swallow to avoid leaking
    }
  }

  return isAdmin;
}

export async function isModerator(interaction: AnyRepliable): Promise<boolean> {
  let isMod = memberHasPermission(
    interaction,
    PermissionsBitField.Flags.ManageMessages,
  );

  if (!isMod) {
    const isAdminCheck = memberHasPermission(
      interaction,
      PermissionsBitField.Flags.Administrator,
    );

    if (!isAdminCheck) {
      const denial = {
        content: ACCESS_DENIED_MOD,
        flags: MessageFlags.Ephemeral,
      };
      await safeReply(interaction, denial as any);
    } else {
      isMod = true;
    }
  }

  return isMod;
}
