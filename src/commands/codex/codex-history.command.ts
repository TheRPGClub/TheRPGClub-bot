import {
  ApplicationCommandOptionType,
  MessageFlags,
  type ButtonInteraction,
  type CommandInteraction,
} from "discord.js";
import { ButtonComponent, Discord, Slash, SlashGroup, SlashOption } from "discordx";
import { CODEX_HISTORY_PREFIX } from "../../config/customIdPrefixes.js";
import { parseCodexHistoryId } from "../../functions/CodexCustomIds.js";
import {
  PRIVATE_OPTION_DESCRIPTION,
  safeDeferReply,
  safeDeferUpdate,
} from "../../functions/InteractionUtils.js";
import { codexView } from "../../services/CodexFunFacts.js";
import { historyReply, pageTurnRefusal } from "../../services/CodexReading.js";
import {
  replyPrivately,
  showButtonResult,
  showCommandResult,
} from "./codex-read.utils.js";

// /codex history (spec api#397, bot#1563, design 4B): Club History's latest History Events,
// a card each, with Older pages back in fours. Club History is public, so the reply is
// too unless the member asks for it privately. Newer and Older answer only that member.

@Discord()
@SlashGroup("codex")
export class CodexHistoryCommand {
  @Slash({ name: "history", description: "Show the latest History Events in Club History" })
  async history(
    @SlashOption({
      name: "private",
      description: PRIVATE_OPTION_DESCRIPTION,
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    isPrivate: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const posted = isPrivate !== true;
    await safeDeferReply(interaction, posted ? {} : { flags: MessageFlags.Ephemeral });
    const result = await historyReply({
      page: 1,
      ownerId: interaction.user.id,
      visibility: posted ? "public" : "private",
    });
    await showCommandResult(interaction, result, posted);
  }

  @ButtonComponent({ id: new RegExp(`^${CODEX_HISTORY_PREFIX}:`) })
  async pageButton(interaction: ButtonInteraction): Promise<void> {
    const target = parseCodexHistoryId(interaction.customId);
    if (!target) {
      await replyPrivately(interaction, codexView("This button is out of date."));
      return;
    }
    const refusal = pageTurnRefusal(target, interaction.user.id);
    if (refusal) {
      await replyPrivately(interaction, refusal);
      return;
    }
    if (!(await safeDeferUpdate(interaction))) return;
    await showButtonResult(interaction, await historyReply(target), false);
  }
}
