import type { Client } from "discord.js";
import VotingRounds, { type IVotingRound } from "../classes/VotingRounds.js";
import {
  hasVotableNominations,
  loadNominationsByKind,
  postVotePanels,
  type IPostVotePanelsResult,
} from "./VotePanelPosting.js";

// Reposting the current round's voting panels, shared by /admin voting-open and the
// voting_panels_repost bot job, which has no interaction.

/** What a repost did, or why it posted nothing. */
export type VotingPanelRepostOutcome =
  | { status: "no_round" }
  /** The current round is not the one asked for (the job's round_number). */
  | { status: "other_round"; round: IVotingRound }
  | { status: "not_open_yet"; round: IVotingRound }
  | { status: "ended"; round: IVotingRound }
  | { status: "no_votable_nominations"; round: IVotingRound }
  | { status: "posted"; round: IVotingRound; result: IPostVotePanelsResult };

export interface IRepostVotingPanelsParams {
  client: Client;
  channelId: string;
  /** Posts nothing unless the current round is this one. */
  expectedRoundNumber?: number;
  /** Called after each panel is sent. */
  onPosted?: () => void;
}

/**
 * Posts the current round's voting panels again while its voting is open. Panels that fail
 * to send are reported in the result's lines, not thrown.
 */
export async function repostVotingPanels(
  params: IRepostVotingPanelsParams,
): Promise<VotingPanelRepostOutcome> {
  const round = await VotingRounds.getCurrent();
  if (!round) return { status: "no_round" };
  if (params.expectedRoundNumber != null && round.roundNumber !== params.expectedRoundNumber) {
    return { status: "other_round", round };
  }
  if (round.nominationsOpen) return { status: "not_open_yet", round };
  if (!round.votingOpen) return { status: "ended", round };

  const nominationsByKind = await loadNominationsByKind(round.roundNumber);
  if (!hasVotableNominations(nominationsByKind)) {
    return { status: "no_votable_nominations", round };
  }
  const result = await postVotePanels({
    client: params.client,
    channelId: params.channelId,
    roundNumber: round.roundNumber,
    monthLabel: round.monthYear,
    voteDeadline: round.votingClosesAt,
    nominationsByKind,
    onPosted: params.onPosted,
  });
  return { status: "posted", round, result };
}
