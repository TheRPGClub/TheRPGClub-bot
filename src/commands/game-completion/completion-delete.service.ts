import { type StringSelectMenuInteraction } from "discord.js";
import Member from "../../classes/Member.js";
import { safeReply } from "../../functions/InteractionUtils.js";
import { buildTextReply } from "../../functions/ComponentsV2Utils.js";
import { COMPONENTS_V2_FLAG } from "../../config/flags.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";
import { parseCustomIdSegments } from "../../utilities/CustomIdUtils.js";

/**
 * Handles completion deletion from the selection menu
 */
export async function handleCompletionDeleteMenu(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const segs = parseCustomIdSegments(interaction.customId, 1);
  if (!segs) { console.error(`Unexpected customId: ${interaction.customId}`); return; }
  const [ownerId] = segs;
  if (interaction.user.id !== ownerId) {
    await safeReply(interaction, buildTextReply("This delete prompt isn't for you.", true));
    return;
  }

  const completionId = Number(interaction.values[0]);
  if (!isPositiveInt(completionId)) {
    await safeReply(interaction, buildTextReply("Invalid selection.", true));
    return;
  }

  const ok = await Member.deleteCompletion(ownerId, completionId);
  if (!ok) {
    await safeReply(
      interaction,
      buildTextReply("Completion not found or could not be deleted.", true),
    );
    return;
  }

  await safeReply(interaction, buildTextReply(`Deleted completion #${completionId}.`, true));

  try {
    await interaction.message.edit({
      components: [],
      flags: COMPONENTS_V2_FLAG,
    }).catch(() => {});
  } catch {
    // ignore
  }
}
