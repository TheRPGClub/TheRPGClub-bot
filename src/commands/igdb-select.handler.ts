import { ButtonComponent, Discord, SelectMenuComponent } from "discordx";
import { type ButtonInteraction, type StringSelectMenuInteraction } from "discord.js";
import { safeReply } from "../functions/InteractionUtils.js";
import { buildTextReply } from "../functions/ComponentsV2Utils.js";
import {
  handleIgdbFirstMatchInteraction,
  handleIgdbSelectInteraction,
} from "../services/IGDB/IgdbSelectService.js";

@Discord()
export class IgdbSelectHandler {
  @SelectMenuComponent({ id: /^igdb-select:.+/ })
  async handleIgdbSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const handled = await handleIgdbSelectInteraction(interaction);
    if (!handled && !interaction.replied && !interaction.deferred) {
      await safeReply(interaction, buildTextReply("This IGDB selection is no longer valid.", true));
    }
  }

  @ButtonComponent({ id: /^igdb-first:.+/ })
  async handleIgdbFirstMatch(interaction: ButtonInteraction): Promise<void> {
    const handled = await handleIgdbFirstMatchInteraction(interaction);
    if (!handled && !interaction.replied && !interaction.deferred) {
      await safeReply(interaction, buildTextReply("This IGDB selection is no longer valid.", true));
    }
  }
}
