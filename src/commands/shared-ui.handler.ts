import { ButtonInteraction } from "discord.js";
import { ButtonComponent, Discord } from "discordx";
import { safeDeferUpdate } from "../functions/InteractionUtils.js";

/**
 * No-op handler for decorative/label buttons used in UI component headers.
 * These buttons are enabled (so they render with full styling) but do nothing.
 */
@Discord()
export class SharedUiHandler {
  @ButtonComponent({ id: /^user-header-label:/ })
  async handleUserHeaderLabel(interaction: ButtonInteraction): Promise<void> {
    await safeDeferUpdate(interaction);
  }
}
