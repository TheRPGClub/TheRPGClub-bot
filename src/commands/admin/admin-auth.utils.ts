import { MessageFlags, PermissionsBitField } from "discord.js";
import { AnyRepliable, safeReply } from "../../functions/InteractionUtils.js";

export async function isAdmin(interaction: AnyRepliable): Promise<boolean> {
  const anyInteraction = interaction as any;
  const member: any = (interaction as any).member;
  const canCheck =
    member && typeof member.permissionsIn === "function" && interaction.channel;
  const isAdmin = canCheck
    ? member.permissionsIn(interaction.channel).has(PermissionsBitField.Flags.Administrator)
    : false;

  if (!isAdmin) {
    const denial = {
      content: "Access denied. Command requires Administrator role.",
      flags: MessageFlags.Ephemeral,
    };

    try {
      await safeReply(interaction, denial);
    } catch {
      // swallow to avoid leaking
    }
  }

  return isAdmin;
}
