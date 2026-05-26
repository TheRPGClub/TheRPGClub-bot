import { ButtonInteraction } from "discord.js";
import { ButtonComponent, Discord } from "discordx";

/**
 * No-op handler for decorative/label buttons used in UI component headers.
 * These buttons are enabled (so they render with full styling) but do nothing.
 */
@Discord()
export class SharedUiHandler {
  @ButtonComponent({ id: /^user-header-label:/ })
  async handleUserHeaderLabel(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferUpdate().catch(() => {});
  }
}
