import type { ButtonInteraction, StringSelectMenuInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import { nominationKindLabel, type NominationKind } from "../../classes/Nomination.js";
import { isRoundTallyRevealed, type IVotingRound } from "../../classes/VotingRounds.js";
import {
  buildCastResultText,
  buildHiddenTallyText,
  buildMyVotesText,
  buildTallyText,
  mergeTallyWithNominations,
  sumTallyVotes,
} from "../../functions/VoteResultsUtils.js";
import {
  safeDeferReply,
  safeReply,
  withErrorReply,
} from "../../functions/InteractionUtils.js";
import { buildTextReply } from "../../functions/ComponentsV2Utils.js";
import { hasMemberRole } from "../../functions/RoleUtils.js";
import { toUnixTimestamp } from "../../functions/DateFormatUtils.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";
import type { IVotingDataSource } from "../../services/VotingDataSource.js";

// A vote panel's select and buttons, shared by the live panels (/vote) and the
// voting sandbox's panels, which differ only in the data source they read.

export const MEMBERS_ONLY_MESSAGE = "Voting is limited to server members with the Members role.";

export interface IVotePanelTarget {
  kind: NominationKind;
  round: number;
}

function buildVotingClosedText(round: number, info: IVotingRound | null): string {
  if (info?.votingEnded) {
    return `Voting for Round ${round} closed <t:${toUnixTimestamp(info.votingClosesAt)}:R>.`;
  }
  return `Voting for Round ${round} is not open.`;
}

export async function respondVoteCast(
  interaction: StringSelectMenuInteraction,
  target: IVotePanelTarget | null,
  source: IVotingDataSource,
): Promise<void> {
  await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

  if (!target) {
    await safeReply(interaction, buildTextReply("Invalid vote selection.", true));
    return;
  }

  if (!hasMemberRole(interaction.member)) {
    await safeReply(interaction, buildTextReply(MEMBERS_ONLY_MESSAGE, true));
    return;
  }

  await withErrorReply(interaction, async () => {
    const info = await source.getRound(target.round);
    if (!info?.votingOpen) {
      await safeReply(
        interaction,
        buildTextReply(buildVotingClosedText(target.round, info), true),
      );
      return;
    }

    const nominationId = Number(interaction.values?.[0]);
    if (!isPositiveInt(nominationId)) {
      await safeReply(interaction, buildTextReply("Invalid nomination selection.", true));
      return;
    }

    const result = await source.castVote(
      target.kind,
      target.round,
      interaction.user.id,
      nominationId,
    );
    if (!result) {
      await safeReply(
        interaction,
        buildTextReply(`That nomination no longer exists for Round ${target.round}.`, true),
      );
      return;
    }

    const votes = await source.getVotesForUser(target.kind, target.round, interaction.user.id);
    const text = buildCastResultText({
      kindLabel: nominationKindLabel(target.kind),
      roundNumber: target.round,
      result,
      votes,
    });
    await safeReply(interaction, buildTextReply(text, true));
  }, "Could not record your vote");
}

export async function respondVoteMine(
  interaction: ButtonInteraction,
  target: IVotePanelTarget | null,
  source: IVotingDataSource,
): Promise<void> {
  await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

  if (!target) {
    await safeReply(interaction, buildTextReply("Invalid vote panel button.", true));
    return;
  }

  await withErrorReply(interaction, async () => {
    const [votes, tally] = await Promise.all([
      source.getVotesForUser(target.kind, target.round, interaction.user.id),
      source.getTally(target.kind, target.round),
    ]);
    const text = buildMyVotesText({
      kindLabel: nominationKindLabel(target.kind),
      roundNumber: target.round,
      votes,
      cap: tally.cap,
    });
    await safeReply(interaction, buildTextReply(text, true));
  }, "Could not load your votes");
}

export async function respondVoteTally(
  interaction: ButtonInteraction,
  target: IVotePanelTarget | null,
  source: IVotingDataSource,
): Promise<void> {
  await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

  if (!target) {
    await safeReply(interaction, buildTextReply("Invalid vote panel button.", true));
    return;
  }

  await withErrorReply(interaction, async () => {
    const kindLabel = nominationKindLabel(target.kind);
    const info = await source.getRound(target.round);
    // Only a round with no API row needs the current round to judge its age.
    const current = info ? null : await source.getCurrentRound();
    const revealed = isRoundTallyRevealed(target.round, info, current);

    const tally = await source.getTally(target.kind, target.round);
    if (!revealed) {
      const text = buildHiddenTallyText({
        kindLabel,
        roundNumber: target.round,
        totalVotes: sumTallyVotes(tally.rows),
        voteDeadline: info?.votingClosesAt ?? null,
      });
      await safeReply(interaction, buildTextReply(text, true));
      return;
    }

    const nominations = await source.listNominations(target.kind, target.round);
    const rows = mergeTallyWithNominations(tally.rows, nominations);
    const text = buildTallyText({
      kindLabel,
      roundNumber: target.round,
      rows,
      cap: tally.cap,
      votingOpen: Boolean(info?.votingOpen),
      voteDeadline: info?.votingClosesAt ?? null,
    });
    await safeReply(interaction, buildTextReply(text, true));
  }, "Could not load the results");
}
