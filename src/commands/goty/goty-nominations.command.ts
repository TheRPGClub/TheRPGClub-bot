import {
  ApplicationCommandOptionType,
  MessageFlags,
  type ButtonInteraction,
  type CommandInteraction,
} from "discord.js";
import { ButtonComponent, Discord, Slash, SlashGroup, SlashOption } from "discordx";
import { GOTY_NOMINATION_WITHDRAW_PREFIX } from "../../config/customIdPrefixes.js";
import { buildErrorReply, buildTextReply } from "../../functions/ComponentsV2Utils.js";
import {
  safeDeferReply,
  safeDeferUpdate,
  safeEditReply,
  safeFollowUpIfSettled,
  safeReply,
} from "../../functions/InteractionUtils.js";
import {
  gotyNominationsReply,
  gotyWithdrawReply,
  parseGotyWithdrawId,
  type GotyNominationsReply,
} from "../../services/GotyNominations.js";
import { GOTY_VOTE_API } from "../../services/GotyVoteApi.js";
import { GOTY_YEAR_MAX, GOTY_YEAR_MIN } from "./goty-year.utils.js";

// /goty nominations (bot#1580): the year's Game of the Year nominations with who nominated
// each, or only the member's own. Private, since it carries the member's Withdraw buttons;
// a press re-checks the nomination is theirs and redraws the view in place.

@Discord()
@SlashGroup("goty")
export class GotyNominationsCommand {
  @Slash({ name: "nominations", description: "See the Game of the Year nominations" })
  async nominations(
    @SlashOption({
      name: "mine",
      description: "Only your own nominations",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    mine: boolean | undefined,
    @SlashOption({
      name: "year",
      description: "The GOTY Vote's year (the current one when left out)",
      type: ApplicationCommandOptionType.Integer,
      required: false,
      minValue: GOTY_YEAR_MIN,
      maxValue: GOTY_YEAR_MAX,
    })
    year: number | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const reply = await gotyNominationsReply(GOTY_VOTE_API, {
      userId: interaction.user.id,
      year: year ?? null,
      scope: mine === true ? "mine" : "all",
    });
    await safeReply(interaction, replyPayload(reply));
  }

  @ButtonComponent({ id: new RegExp(`^${GOTY_NOMINATION_WITHDRAW_PREFIX}:`) })
  async withdraw(interaction: ButtonInteraction): Promise<void> {
    const target = parseGotyWithdrawId(interaction.customId);
    if (!target) {
      await safeReply(interaction, buildTextReply("This button is out of date.", true));
      return;
    }
    if (!(await safeDeferUpdate(interaction))) return;
    const reply = await gotyWithdrawReply(GOTY_VOTE_API, target, interaction.user.id);
    if ("view" in reply) {
      await safeEditReply(interaction, reply.view);
    } else {
      await safeFollowUpIfSettled(interaction, replyPayload(reply));
    }
  }
}

function replyPayload(reply: GotyNominationsReply): object {
  if ("error" in reply) return buildErrorReply(reply.error, true);
  if ("text" in reply) return buildTextReply(reply.text, true);
  return reply.view;
}
