import { MessageFlags, type CommandInteraction } from "discord.js";
import { Discord, Slash } from "discordx";

import { buildErrorReply } from "../functions/ComponentsV2Utils.js";
import { safeDeferReply, safeEditReply } from "../functions/InteractionUtils.js";
import { buildUpcomingBirthdaysView } from "../services/UpcomingBirthdaysService.js";
import { buildApiErrorMessage } from "../utilities/ApiErrorUtils.js";
import { logError } from "../utilities/LogUtils.js";

/** `/birthdays` (bot#1558): the Upcoming Birthdays, privately. No buttons, nothing to resume. */
@Discord()
export class BirthdaysCommand {
  @Slash({ name: "birthdays", description: "Upcoming Birthdays in the next 30 days (private)" })
  async birthdays(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    try {
      await safeEditReply(interaction, await buildUpcomingBirthdaysView(interaction.user.id));
    } catch (err: unknown) {
      logError("BirthdaysCommand.birthdays", err);
      await safeEditReply(
        interaction,
        buildErrorReply(buildApiErrorMessage("Could not read the Upcoming Birthdays.", err), true),
      );
    }
  }
}
