import {
  ApplicationCommandOptionType,
  MessageFlags,
  type ButtonInteraction,
  type CommandInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import {
  ButtonComponent,
  Discord,
  SelectMenuComponent,
  Slash,
  SlashChoice,
  SlashGroup,
  SlashOption,
} from "discordx";
import {
  GOTY_VOTE_PICK_PREFIX,
  GOTY_VOTE_SELECT_PREFIX,
} from "../../config/customIdPrefixes.js";
import { buildErrorReply, buildTextReply } from "../../functions/ComponentsV2Utils.js";
import {
  safeDeferReply,
  safeDeferUpdate,
  safeEditReply,
  safeFollowUpIfSettled,
  safeReply,
} from "../../functions/InteractionUtils.js";
import { hasMemberRole } from "../../functions/RoleUtils.js";
import {
  GOTY_AWARDS,
  GOTY_AWARD_LABELS,
  GOTY_VOTE_API,
  parseGotyAward,
} from "../../services/GotyVoteApi.js";
import {
  GOTY_MEMBERS_ONLY_MESSAGE,
  gotyVoteCast,
  gotyVoteCommandReply,
  parseGotyVoteId,
  type IGotyVoteTarget,
} from "../../services/GotyVotePanels.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";

// /goty vote (bot#1581): the member's own ballot panel per Award. A press casts or toggles
// and redraws the panel in place; its custom id carries the year, Award, ballot and game,
// so a panel keeps working after a restart.

@Discord()
@SlashGroup("goty")
export class GotyVoteCommand {
  @Slash({ name: "vote", description: "Vote in the GOTY Vote's Awards" })
  async vote(
    @SlashChoice(...GOTY_AWARDS.map((award) => ({ name: GOTY_AWARD_LABELS[award], value: award })))
    @SlashOption({
      name: "award",
      description: "One Award's ballot (all of them when left out)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    rawAward: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    if (!hasMemberRole(interaction.member)) {
      await safeReply(interaction, buildTextReply(GOTY_MEMBERS_ONLY_MESSAGE, true));
      return;
    }
    const award = rawAward ? parseGotyAward(rawAward) : null;
    const reply = await gotyVoteCommandReply(GOTY_VOTE_API, interaction.user.id, award);
    if ("error" in reply) {
      await safeReply(interaction, buildErrorReply(reply.error, true));
    } else if ("text" in reply) {
      await safeReply(interaction, buildTextReply(reply.text, true));
    } else {
      // The first panel fills the deferred reply; the others follow it.
      const [first, ...rest] = reply.views;
      await safeReply(interaction, first);
      for (const view of rest) await safeFollowUpIfSettled(interaction, view);
    }
  }

  @ButtonComponent({ id: new RegExp(`^${GOTY_VOTE_PICK_PREFIX}:`) })
  async pick(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseGotyVoteId(interaction.customId);
    await this.cast(interaction, parsed?.target ?? null, parsed?.gameId ?? null);
  }

  @SelectMenuComponent({ id: new RegExp(`^${GOTY_VOTE_SELECT_PREFIX}:`) })
  async select(interaction: StringSelectMenuInteraction): Promise<void> {
    const parsed = parseGotyVoteId(interaction.customId);
    await this.cast(interaction, parsed?.target ?? null, Number(interaction.values[0]));
  }

  private async cast(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
    target: IGotyVoteTarget | null,
    gameId: number | null,
  ): Promise<void> {
    if (!target || !isPositiveInt(gameId)) {
      await safeReply(interaction, buildTextReply("This vote panel is out of date.", true));
      return;
    }
    if (!hasMemberRole(interaction.member)) {
      await safeReply(interaction, buildTextReply(GOTY_MEMBERS_ONLY_MESSAGE, true));
      return;
    }
    if (!(await safeDeferUpdate(interaction))) return;
    const outcome = await gotyVoteCast(GOTY_VOTE_API, target, gameId, interaction.user.id);
    if (outcome.panel) await safeEditReply(interaction, outcome.panel);
    if (outcome.error) {
      await safeFollowUpIfSettled(interaction, buildErrorReply(outcome.error, true));
    }
  }
}
