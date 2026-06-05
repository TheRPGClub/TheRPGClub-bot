import { PermissionsBitField } from "discord.js";
import { AnyRepliable, safeReply } from "../../functions/InteractionUtils.js";
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
      await safeReply(interaction, buildTextReply("Access denied. Command requires Administrator role.", true));
    } catch {
      // swallow to avoid leaking
    }
  }

  return isAdmin;
}
