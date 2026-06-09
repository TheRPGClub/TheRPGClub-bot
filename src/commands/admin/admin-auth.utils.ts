import { MessageFlags, PermissionsBitField } from "discord.js";
import {
  ACCESS_DENIED_ADMIN,
  ACCESS_DENIED_MOD,
  AnyRepliable,
  safeReply,
} from "../../functions/InteractionUtils.js";
import { buildTextReply } from "../../functions/ComponentsV2Utils.js";

export async function isAdmin(interaction: AnyRepliable): Promise<boolean> {
  const member: any = (interaction as any).member;
  const canCheck =
    member && typeof member.permissionsIn === "function" && interaction.channel;
  const isAdmin = canCheck
    ? member.permissionsIn(interaction.channel).has(PermissionsBitField.Flags.Administrator)
    : false;

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
  const member: any = (interaction as any).member;
  const canCheck =
    member && typeof member.permissionsIn === "function" && interaction.channel;
  let isMod = canCheck
    ? member.permissionsIn(interaction.channel).has(PermissionsBitField.Flags.ManageMessages)
    : false;

  if (!isMod) {
    const isAdminCheck = canCheck
      ? member.permissionsIn(interaction.channel).has(PermissionsBitField.Flags.Administrator)
      : false;

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
