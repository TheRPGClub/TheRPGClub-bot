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
import type { NominationKind } from "../classes/Nomination.js";
import {
  listNominationsForRound,
  nominationKindLabel,
  parseNominationKind,
} from "../classes/Nomination.js";
import { castVote, getVotesForUser, getVoteTally } from "../classes/Vote.js";
import BotVotingInfo, { type IBotVotingInfoEntry } from "../classes/BotVotingInfo.js";
import { getActiveVotingRound, isRoundDecided } from "../functions/VotingRound.js";
import { buildVotePanelComponents } from "../functions/VotePanelComponents.js";
import {
  buildCastResultText,
  buildHiddenTallyText,
  buildMyVotesText,
  buildTallyText,
  dedupeNominationsByGame,
  mergeTallyWithNominations,
  sumTallyVotes,
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
import { isPositiveInt } from "../utilities/ValidationUtils.js";

const MEMBERS_ONLY_MESSAGE = "Voting is limited to server members with the Members role.";

function parseVoteCustomId(
  customId: string,
): { kind: NominationKind; round: number } | null {
  const parts = customId.split(":");
  const kind = parseNominationKind(parts[1] ?? "");
  const round = Number(parts[2] ?? "");
  if (!kind || !isPositiveInt(round)) {
    return null;
  }
  return { kind, round };
}

function buildVotingClosedText(round: number, info: IBotVotingInfoEntry | null): string {
  if (info?.votingEnded && info.voteDeadline) {
    return `Voting for Round ${round} closed <t:${toUnixTimestamp(info.voteDeadline)}:R>.`;
  }
  return `Voting for Round ${round} is not open.`;
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
      const round = await getActiveVotingRound();
      if (!round) {
        const current = await BotVotingInfo.getCurrentRound();
        const scheduled =
          current && current.nextVoteAt.getTime() > Date.now()
            ? ` The next vote is scheduled for <t:${toUnixTimestamp(current.nextVoteAt)}:F>.`
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
        voteDeadline: round.voteDeadline,
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
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const parsed = parseVoteCustomId(interaction.customId);
    if (!parsed) {
      await safeReply(interaction, buildTextReply("Invalid vote selection.", true));
      return;
    }

    if (!hasMemberRole(interaction.member)) {
      await safeReply(interaction, buildTextReply(MEMBERS_ONLY_MESSAGE, true));
      return;
    }

    await withErrorReply(interaction, async () => {
      const info = await BotVotingInfo.getByRound(parsed.round);
      if (!info?.votingOpen || isRoundDecided(parsed.round)) {
        await safeReply(
          interaction,
          buildTextReply(buildVotingClosedText(parsed.round, info), true),
        );
        return;
      }

      const nominationId = Number(interaction.values?.[0]);
      if (!isPositiveInt(nominationId)) {
        await safeReply(interaction, buildTextReply("Invalid nomination selection.", true));
        return;
      }

      const result = await castVote(
        parsed.kind,
        parsed.round,
        interaction.user.id,
        nominationId,
      );
      if (!result) {
        await safeReply(
          interaction,
          buildTextReply(
            `That nomination no longer exists for Round ${parsed.round}.`,
            true,
          ),
        );
        return;
      }

      const votes = await getVotesForUser(parsed.kind, parsed.round, interaction.user.id);
      const text = buildCastResultText({
        kindLabel: nominationKindLabel(parsed.kind),
        roundNumber: parsed.round,
        result,
        votes,
      });
      await safeReply(interaction, buildTextReply(text, true));
    }, "Could not record your vote");
  }

  @ButtonComponent({ id: /^vote-mine:(gotm|nr-gotm):\d+$/ })
  async handleVoteMine(interaction: ButtonInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const parsed = parseVoteCustomId(interaction.customId);
    if (!parsed) {
      await safeReply(interaction, buildTextReply("Invalid vote panel button.", true));
      return;
    }

    await withErrorReply(interaction, async () => {
      const [votes, tally] = await Promise.all([
        getVotesForUser(parsed.kind, parsed.round, interaction.user.id),
        getVoteTally(parsed.kind, parsed.round),
      ]);
      const text = buildMyVotesText({
        kindLabel: nominationKindLabel(parsed.kind),
        roundNumber: parsed.round,
        votes,
        cap: tally.cap,
      });
      await safeReply(interaction, buildTextReply(text, true));
    }, "Could not load your votes");
  }

  @ButtonComponent({ id: /^vote-tally:(gotm|nr-gotm):\d+$/ })
  async handleVoteTally(interaction: ButtonInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const parsed = parseVoteCustomId(interaction.customId);
    if (!parsed) {
      await safeReply(interaction, buildTextReply("Invalid vote panel button.", true));
      return;
    }

    await withErrorReply(interaction, async () => {
      const kindLabel = nominationKindLabel(parsed.kind);
      const info = await BotVotingInfo.getByRound(parsed.round);
      // Tallies stay hidden for everyone (admins included) until voting ends.
      const revealed = Boolean(info?.votingEnded) || isRoundDecided(parsed.round);

      const tally = await getVoteTally(parsed.kind, parsed.round);
      if (!revealed) {
        const text = buildHiddenTallyText({
          kindLabel,
          roundNumber: parsed.round,
          totalVotes: sumTallyVotes(tally.rows),
          voteDeadline: info?.voteDeadline ?? null,
        });
        await safeReply(interaction, buildTextReply(text, true));
        return;
      }

      const nominations = await listNominationsForRound(parsed.kind, parsed.round);
      const rows = mergeTallyWithNominations(tally.rows, nominations);
      const text = buildTallyText({
        kindLabel,
        roundNumber: parsed.round,
        rows,
        cap: tally.cap,
        votingOpen: Boolean(info?.votingOpen) && !isRoundDecided(parsed.round),
        voteDeadline: info?.voteDeadline ?? null,
      });
      await safeReply(interaction, buildTextReply(text, true));
    }, "Could not load the results");
  }
}
