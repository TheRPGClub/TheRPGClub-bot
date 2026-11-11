import {
  ApplicationCommandType,
  InteractionContextType,
  type MessageContextMenuCommandInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { ContextMenu, Discord, SelectMenuComponent } from "discordx";

import { CHANGE_NEWS_CATEGORY_COMMAND, NEWS_CHANNEL_PLACES } from "../config/newsHub.js";
import { NEWS_CATEGORY_PICK_PREFIX } from "../config/customIdPrefixes.js";
import { IS_TEST_MODE } from "../config/testMode.js";
import {
  buildComponentsV2EditFlags,
  buildPrivateReply,
  buildTextReply,
} from "../functions/ComponentsV2Utils.js";
import {
  safeDeferUpdate,
  safeEditReply,
  safeReply,
} from "../functions/InteractionUtils.js";
import {
  buildNewsCategoryPrompt,
  isNewsCategoryKey,
  newsCategoryPromptRefusal,
  parseNewsCategoryPickId,
} from "../functions/NewsCategoryChangePrompt.js";
import {
  NEWS_CATEGORY_HISTORY_COPY_MESSAGE,
  changeNewsCategory,
  createNewsCategoryDeps,
} from "../services/NewsCategoryChange.js";
import { NEWS_COPY_LANE } from "../services/NewsCopyLane.js";
import { logUnexpectedCustomId } from "../utilities/CustomIdUtils.js";

/**
 * "Change news category" (spec api#367, bot#1541): the bot's message command. The sharer
 * or staff right-click a News Channel message, choose a News Category privately, and the
 * News Item moves there with its copy and reaction. It belongs to the News Hub Feature, so
 * the gate makes it staff-only in Preview; the API checks author or staff on every change.
 */
@Discord()
export class NewsCategoryCommand {
  @ContextMenu({
    name: CHANGE_NEWS_CATEGORY_COMMAND,
    type: ApplicationCommandType.Message,
    contexts: [InteractionContextType.Guild],
  })
  async changeNewsCategoryMenu(
    interaction: MessageContextMenuCommandInteraction,
  ): Promise<void> {
    const message = interaction.targetMessage;
    const refusal = newsCategoryPromptRefusal(
      message,
      NEWS_CHANNEL_PLACES,
      interaction.client.user.id,
      IS_TEST_MODE,
    ) ?? (NEWS_COPY_LANE.historyRunning() ? NEWS_CATEGORY_HISTORY_COPY_MESSAGE : null);
    if (refusal) {
      await safeReply(interaction, buildTextReply(refusal, true));
      return;
    }
    await safeReply(interaction, buildNewsCategoryPrompt(message.channelId, message.id));
  }

  @SelectMenuComponent({ id: new RegExp(`^${NEWS_CATEGORY_PICK_PREFIX}:\\d+:\\d+$`) })
  async pickNewsCategory(interaction: StringSelectMenuInteraction): Promise<void> {
    const target = parseNewsCategoryPickId(interaction.customId);
    const [categoryKey] = interaction.values;
    if (!target || !categoryKey || !isNewsCategoryKey(categoryKey)) {
      logUnexpectedCustomId(interaction.customId);
      await safeReply(interaction, buildTextReply("This category menu is invalid.", true));
      return;
    }
    if (!(await safeDeferUpdate(interaction))) return;
    const reply = await changeNewsCategory(
      { actingUserId: interaction.user.id, ...target, categoryKey },
      createNewsCategoryDeps(interaction.client),
    );
    await safeEditReply(interaction, {
      ...buildPrivateReply(reply),
      flags: buildComponentsV2EditFlags(),
    });
  }
}
