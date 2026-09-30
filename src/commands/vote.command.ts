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
  SlashOption,
} from "discordx";
import {
  listNominationsForRound,
  nominationKindLabel,
  parseNominationKind,
} from "../classes/Nomination.js";
import { getVotesForUser, getVoteTally } from "../classes/Vote.js";
import VotingRounds from "../classes/VotingRounds.js";
import { buildVotePanelComponents } from "../functions/VotePanelComponents.js";
import { dedupeNominationsByGame } from "../functions/VoteResultsUtils.js";
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
import { isPositiveInt } from "../utilities/ValidationUtils.js";
import { apiVotingDataSource } from "../services/VotingDataSource.js";
import {
  MEMBERS_ONLY_MESSAGE,
  respondVoteCast,
  respondVoteMine,
  respondVoteTally,
  type IVotePanelTarget,
} from "./vote/vote-panel-actions.service.js";

function parseVoteCustomId(customId: string): IVotePanelTarget | null {
  const parts = customId.split(":");
  const kind = parseNominationKind(parts[1] ?? "");
  const round = Number(parts[2] ?? "");
  if (!kind || !isPositiveInt(round)) {
    return null;
  }
  return { kind, round };
}

@Discord()
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
      const current = await VotingRounds.getCurrent();
      const round = current?.votingOpen ? current : null;
      if (!round) {
        const scheduled =
          current?.phase === "nominating"
            ? ` The next vote is scheduled for <t:${toUnixTimestamp(current.votingOpensAt)}:F>.`
            : "";
        await safeReply(
          interaction,
          buildTextReply(`Voting is not open right now.${scheduled}`, true),
        );
        return;
      }

      const kindLabel = nominationKindLabel(kind);
      const nominations = await listNominationsForRound(kind, round.roundNumber);
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
        getVoteTally(kind, round.roundNumber),
        getVotesForUser(kind, round.roundNumber, interaction.user.id),
      ]);
      const components = buildVotePanelComponents({
        kind,
        roundNumber: round.roundNumber,
        voteDeadline: round.votingClosesAt,
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

  @SelectMenuComponent({ id: /^vote-cast:(gotm|nr-gotm):\d+:\d+$/ })
  async handleVoteCast(interaction: StringSelectMenuInteraction): Promise<void> {
    await respondVoteCast(
      interaction,
      parseVoteCustomId(interaction.customId),
      apiVotingDataSource,
    );
  }

  @ButtonComponent({ id: /^vote-mine:(gotm|nr-gotm):\d+$/ })
  async handleVoteMine(interaction: ButtonInteraction): Promise<void> {
    await respondVoteMine(
      interaction,
      parseVoteCustomId(interaction.customId),
      apiVotingDataSource,
    );
  }

  @ButtonComponent({ id: /^vote-tally:(gotm|nr-gotm):\d+$/ })
  async handleVoteTally(interaction: ButtonInteraction): Promise<void> {
    await respondVoteTally(
      interaction,
      parseVoteCustomId(interaction.customId),
      apiVotingDataSource,
    );
  }
}
