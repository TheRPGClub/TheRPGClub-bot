import type { ButtonInteraction, StringSelectMenuInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import {
  nominationKindLabel,
  parseNominationKind,
  type NominationKind,
} from "../../classes/Nomination.js";
import type { VoteBallot } from "../../classes/Vote.js";
import {
  isRoundTallyRevealed,
  isRunoffTallyRevealed,
  toVotingRoundCategory,
  type IVotingRound,
} from "../../classes/VotingRounds.js";
import {
  ballotKindLabel,
  buildCastResultText,
  buildHiddenTallyText,
  buildMyVotesText,
  buildTallyText,
  filterRunoffNominations,
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
import { LIVE_VOTE_PANEL_PREFIX } from "../../functions/VotePanelComponents.js";
import type { IVotingDataSource } from "../../services/VotingDataSource.js";

// A vote panel's select and buttons, shared by the live panels (/vote) and the
// voting sandbox's panels, which differ only in the data source they read.

export const MEMBERS_ONLY_MESSAGE = "Voting is limited to server members with the Members role.";

export interface IVotePanelTarget {
  kind: NominationKind;
  round: number;
  /** Which ballot the panel was posted for; a runoff panel's ids say so. */
  ballot: VoteBallot;
}

function ballotOfPrefix(prefix: string): VoteBallot | null {
  for (const ballot of ["main", "runoff"] as const) {
    if (Object.values(LIVE_VOTE_PANEL_PREFIX[ballot]).includes(prefix)) return ballot;
  }
  return null;
}

/** A live panel id (`<prefix>:<kind>:<round>[:<chunk>]`) back to what it targets. */
export function parseVoteCustomId(customId: string): IVotePanelTarget | null {
  const [prefix, rawKind, rawRound] = customId.split(":");
  const ballot = ballotOfPrefix(prefix ?? "");
  const kind = parseNominationKind(rawKind ?? "");
  const round = Number(rawRound ?? "");
  if (!ballot || !kind || !isPositiveInt(round)) {
    return null;
  }
  return { kind, round, ballot };
}

/** Whether the round's runoff is taking votes in the target's category. */
function isRunoffOpenFor(target: IVotePanelTarget, info: IVotingRound | null): boolean {
  return Boolean(
    info?.runoffOpen && info.pendingTies[toVotingRoundCategory(target.kind)]?.length,
  );
}

/** Whether the panel's ballot is taking votes right now. */
export function isBallotOpen(target: IVotePanelTarget, info: IVotingRound | null): boolean {
  return target.ballot === "runoff" ? isRunoffOpenFor(target, info) : Boolean(info?.votingOpen);
}

export function buildBallotClosedText(
  target: IVotePanelTarget,
  info: IVotingRound | null,
): string {
  const { round } = target;
  const label = nominationKindLabel(target.kind);
  if (target.ballot === "runoff") {
    if (info?.runoffClosesAt && info.runoffEnded) {
      return (
        `The ${label} runoff for Round ${round} closed ` +
        `<t:${toUnixTimestamp(info.runoffClosesAt)}:R>.`
      );
    }
    return `The ${label} runoff for Round ${round} is not open.`;
  }
  if (isRunoffOpenFor(target, info)) {
    return (
      `Voting for Round ${round} has closed, and the ${label} vote ended in a tie. ` +
      "Vote in the runoff between the tied games on its panel in the announcements channel."
    );
  }
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
    if (!isBallotOpen(target, info)) {
      await safeReply(interaction, buildTextReply(buildBallotClosedText(target, info), true));
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

    const votes = await source.getVotesForUser(
      target.kind,
      target.round,
      interaction.user.id,
      target.ballot,
    );
    const text = buildCastResultText({
      kindLabel: ballotKindLabel(nominationKindLabel(target.kind), target.ballot),
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
      source.getVotesForUser(target.kind, target.round, interaction.user.id, target.ballot),
      source.getTally(target.kind, target.round, target.ballot),
    ]);
    const text = buildMyVotesText({
      kindLabel: ballotKindLabel(nominationKindLabel(target.kind), target.ballot),
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

  if (target.ballot === "runoff") {
    await respondRunoffTally(interaction, target, source);
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

/** The runoff panel's Results button: hidden until the runoff closes. */
async function respondRunoffTally(
  interaction: ButtonInteraction,
  target: IVotePanelTarget,
  source: IVotingDataSource,
): Promise<void> {
  await withErrorReply(interaction, async () => {
    const kindLabel = ballotKindLabel(nominationKindLabel(target.kind), "runoff");
    const info = await source.getRound(target.round);
    const tally = await source.getTally(target.kind, target.round, "runoff");
    if (!isRunoffTallyRevealed(info)) {
      const text = buildHiddenTallyText({
        kindLabel,
        roundNumber: target.round,
        totalVotes: sumTallyVotes(tally.rows),
        voteDeadline: info?.runoffClosesAt ?? null,
      });
      await safeReply(interaction, buildTextReply(text, true));
      return;
    }

    const tied = info?.runoffTies[toVotingRoundCategory(target.kind)] ?? [];
    const nominations = await source.listNominations(target.kind, target.round);
    const rows = mergeTallyWithNominations(
      tally.rows,
      filterRunoffNominations(nominations, tied),
    );
    const text = buildTallyText({
      kindLabel,
      roundNumber: target.round,
      rows,
      cap: tally.cap,
      votingOpen: false,
      voteDeadline: null,
    });
    await safeReply(interaction, buildTextReply(text, true));
  }, "Could not load the runoff results");
}
