import {
  ApplicationCommandOptionType,
  MessageFlags,
  type CommandInteraction,
} from "discord.js";
import { Discord, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import { safeDeferReply, safeEditReply } from "../../functions/InteractionUtils.js";
import {
  challengeDmsReply,
  type ChallengeDmsChoice,
} from "../../services/ChallengeDmSettings.js";
import { challengeErrorReply } from "./challenge-interaction.utils.js";

// /challenge dms [set:on|off] (spec api#376, bot#1548): the member's Challenge DM opt-out.
// A slash command with no components, so nothing to resume after a restart.

@Discord()
@SlashGroup("challenge")
export class ChallengeDmsCommand {
  @Slash({ name: "dms", description: "Show or change whether the bot DMs you Challenge reminders" })
  async dms(
    @SlashChoice({ name: "On", value: "on" }, { name: "Off", value: "off" })
    @SlashOption({
      name: "set",
      description: "Turn Challenge DMs on or off; leave it out to see your setting",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    set: ChallengeDmsChoice | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const result = await challengeDmsReply({ userId: interaction.user.id, set });
    await safeEditReply(
      interaction,
      "view" in result ? result.view : challengeErrorReply(result.error),
    );
  }
}
