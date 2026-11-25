import {
  ApplicationCommandOptionType,
  MessageFlags,
  type CommandInteraction,
} from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import { buildErrorReply, buildTextReply } from "../../functions/ComponentsV2Utils.js";
import {
  PRIVATE_OPTION_DESCRIPTION,
  safeDeferReply,
  safeReply,
} from "../../functions/InteractionUtils.js";
import { gotyResultsReply } from "../../services/GotyResults.js";
import { GOTY_VOTE_API } from "../../services/GotyVoteApi.js";
import { GOTY_YEAR_MAX, GOTY_YEAR_MIN } from "./goty-year.utils.js";

// /goty results [year] (bot#1580): each Award's winner and tally, the latest decided year
// by default. Results are public, so the reply is too unless the member asks otherwise.

@Discord()
@SlashGroup("goty")
export class GotyResultsCommand {
  @Slash({ name: "results", description: "See a GOTY Vote's winners and tallies" })
  async results(
    @SlashOption({
      name: "year",
      description: "The GOTY Vote's year (the latest decided one when left out)",
      type: ApplicationCommandOptionType.Integer,
      required: false,
      minValue: GOTY_YEAR_MIN,
      maxValue: GOTY_YEAR_MAX,
    })
    year: number | undefined,
    @SlashOption({
      name: "private",
      description: PRIVATE_OPTION_DESCRIPTION,
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    isPrivate: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const hidden = isPrivate === true;
    await safeDeferReply(interaction, hidden ? { flags: MessageFlags.Ephemeral } : {});
    const reply = await gotyResultsReply(GOTY_VOTE_API, {
      userId: interaction.user.id,
      year: year ?? null,
      isPrivate: hidden,
    });
    if ("error" in reply) await safeReply(interaction, buildErrorReply(reply.error, hidden));
    else if ("text" in reply) await safeReply(interaction, buildTextReply(reply.text, hidden));
    else await safeReply(interaction, reply.view);
  }
}
