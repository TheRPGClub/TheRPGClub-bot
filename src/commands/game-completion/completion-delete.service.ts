import { type StringSelectMenuInteraction } from "discord.js";
import Member from "../../classes/Member.js";
import { replyIfNotOwner, safeReply } from "../../functions/InteractionUtils.js";
import { buildComponentsV2EditFlags, buildTextReply } from "../../functions/ComponentsV2Utils.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";
import { assertCustomIdSegments } from "../../utilities/CustomIdUtils.js";
import { safeIgnore } from "../../utilities/AsyncUtils.js";

/**
 * Handles completion deletion from the selection menu
 */
export async function handleCompletionDeleteMenu(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const segs = assertCustomIdSegments(interaction, 1);
  if (!segs) return;
  const [ownerId] = segs;
  if (await replyIfNotOwner(interaction, ownerId)) return;

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

  safeIgnore(interaction.message.edit({
    components: [],
    flags: buildComponentsV2EditFlags(),
  }));
}
