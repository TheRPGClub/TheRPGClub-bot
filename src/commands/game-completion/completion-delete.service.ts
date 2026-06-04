import { type StringSelectMenuInteraction } from "discord.js";
import Member from "../../classes/Member.js";
import { safeReply } from "../../functions/InteractionUtils.js";
import { buildComponentsV2Flags, buildTextContainer } from "../../functions/ComponentsV2Utils.js";
import { COMPONENTS_V2_FLAG } from "../../config/flags.js";

/**
 * Handles completion deletion from the selection menu
 */
export async function handleCompletionDeleteMenu(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const [, ownerId] = interaction.customId.split(":");
  if (interaction.user.id !== ownerId) {
    await safeReply(interaction, {
      content: "This delete prompt isn't for you.",
      flags: buildComponentsV2Flags(true),
    });
    return;
  }

  const completionId = Number(interaction.values[0]);
  if (!Number.isInteger(completionId) || completionId <= 0) {
    await safeReply(interaction, {
      content: "Invalid selection.",
      flags: buildComponentsV2Flags(true),
    });
    return;
  }

  const ok = await Member.deleteCompletion(ownerId, completionId);
  if (!ok) {
    await safeReply(interaction, {
      content: "Completion not found or could not be deleted.",
      flags: buildComponentsV2Flags(true),
    });
    return;
  }

  await safeReply(interaction, {
    content: `Deleted completion #${completionId}.`,
    flags: buildComponentsV2Flags(true),
  });

  try {
    await interaction.message.edit({
      components: [],
      flags: COMPONENTS_V2_FLAG,
    }).catch(() => {});
  } catch {
    // ignore
  }
}
