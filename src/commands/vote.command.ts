import type {
  ButtonInteraction,
  CommandInteraction,
  StringSelectMenuInteraction,
} from "discord.js";
import { ApplicationCommandOptionType, MessageFlags } from "discord.js";
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
  listNominationsForRound,
  nominationKindLabel,
  parseNominationKind,
  type NominationKind,
} from "../classes/Nomination.js";
import { getVotesForUser, getVoteTally, type VoteBallot } from "../classes/Vote.js";
import VotingRounds, {
  toVotingRoundCategory,
  type IVotingRound,
} from "../classes/VotingRounds.js";
import { buildVotePanelComponents } from "../functions/VotePanelComponents.js";
import {
  dedupeNominationsByGame,
  filterRunoffNominations,
} from "../functions/VoteResultsUtils.js";
import {
  safeDeferReply,
  safeReply,
  withErrorReply,
} from "../functions/InteractionUtils.js";
import {
  buildComponentsV2Flags,
  buildTextReply,
} from "../functions/ComponentsV2Utils.js";
import { hasMemberRole } from "../functions/RoleUtils.js";
import { toUnixTimestamp } from "../functions/DateFormatUtils.js";
import { apiVotingDataSource } from "../services/VotingDataSource.js";
import {
  MEMBERS_ONLY_MESSAGE,
  parseVoteCustomId,
  respondVoteCast,
  respondVoteMine,
  respondVoteTally,
} from "./vote/vote-panel-actions.service.js";

/**
 * The ballot /gotm vote shows for a category, or why there is none: the main
 * vote while voting is open, then the runoff for a category that tied.
 */
function pickOpenBallot(
  current: IVotingRound | null,
  kind: NominationKind,
): { round: IVotingRound; ballot: VoteBallot; deadline: Date } | string {
  if (current?.votingOpen) {
    return { round: current, ballot: "main", deadline: current.votingClosesAt };
  }
  if (current?.runoffOpen) {
    const label = nominationKindLabel(kind);
    if (!current.pendingTies[toVotingRoundCategory(kind)]?.length || !current.runoffClosesAt) {
      return `Voting is not open right now. The Round ${current.roundNumber} runoff is only ` +
        `for the categories that tied, and ${label} did not.`;
    }
    return { round: current, ballot: "runoff", deadline: current.runoffClosesAt };
  }
  const scheduled =
    current?.phase === "nominating"
      ? ` The next vote is scheduled for <t:${toUnixTimestamp(current.votingOpensAt)}:F>.`
      : "";
  return `Voting is not open right now.${scheduled}`;
}

@Discord()
@SlashGroup("gotm")
export class VoteCommand {
  @Slash({
    description: "Vote on GOTM or NR-GOTM nominations for the open voting round",
    name: "vote",
  })
  async vote(
    @SlashChoice(
      { name: "GOTM", value: "gotm" },
      { name: "NR-GOTM", value: "nr-gotm" },
    )
    @SlashOption({
      description: "Voting category",
      name: "type",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    rawKind: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    const kind = parseNominationKind(rawKind);
    if (!kind) {
      await safeReply(interaction, buildTextReply("Please choose either GOTM or NR-GOTM.", true));
      return;
    }

    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    if (!hasMemberRole(interaction.member)) {
      await safeReply(interaction, buildTextReply(MEMBERS_ONLY_MESSAGE, true));
      return;
    }

    await withErrorReply(interaction, async () => {
      const open = pickOpenBallot(await VotingRounds.getCurrent(), kind);
      if (typeof open === "string") {
        await safeReply(interaction, buildTextReply(open, true));
        return;
      }
      const { round, ballot } = open;

      const kindLabel = nominationKindLabel(kind);
      const listed = await listNominationsForRound(kind, round.roundNumber);
      const nominations = ballot === "runoff"
        ? filterRunoffNominations(listed, round.pendingTies[toVotingRoundCategory(kind)] ?? [])
        : listed;
      if (!dedupeNominationsByGame(nominations).length) {
        await safeReply(
          interaction,
          buildTextReply(
            `There are no ${kindLabel} nominations to vote on for Round ${round.roundNumber}.`,
            true,
          ),
        );
        return;
      }

      const [tally, myVotes] = await Promise.all([
        getVoteTally(kind, round.roundNumber, ballot),
        getVotesForUser(kind, round.roundNumber, interaction.user.id, ballot),
      ]);
      const components = buildVotePanelComponents({
        kind,
        ballot,
        roundNumber: round.roundNumber,
        voteDeadline: open.deadline,
        cap: tally.cap,
        nominations,
        myVotes,
      });
      await safeReply(interaction, {
        components,
        flags: buildComponentsV2Flags(true),
      });
    }, "Could not load the voting panel");
  }

  @SelectMenuComponent({ id: /^vote-(runoff-)?cast:(gotm|nr-gotm):\d+:\d+$/ })
  async handleVoteCast(interaction: StringSelectMenuInteraction): Promise<void> {
    await respondVoteCast(
      interaction,
      parseVoteCustomId(interaction.customId),
      apiVotingDataSource,
    );
  }

  @ButtonComponent({ id: /^vote-(runoff-)?mine:(gotm|nr-gotm):\d+$/ })
  async handleVoteMine(interaction: ButtonInteraction): Promise<void> {
    await respondVoteMine(
      interaction,
      parseVoteCustomId(interaction.customId),
      apiVotingDataSource,
    );
  }

  @ButtonComponent({ id: /^vote-(runoff-)?tally:(gotm|nr-gotm):\d+$/ })
  async handleVoteTally(interaction: ButtonInteraction): Promise<void> {
    await respondVoteTally(
      interaction,
      parseVoteCustomId(interaction.customId),
      apiVotingDataSource,
    );
  }
}
