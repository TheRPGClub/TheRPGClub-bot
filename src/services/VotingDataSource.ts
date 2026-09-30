import {
  listNominationsForRound,
  type INominationEntry,
  type NominationKind,
} from "../classes/Nomination.js";
import {
  castVote,
  getVotesForUser,
  getVoteTally,
  type IVoteCastResult,
  type IVoteEntry,
  type IVoteTally,
} from "../classes/Vote.js";
import VotingRounds, {
  type IVotingRound,
  type VotingRoundCategory,
} from "../classes/VotingRounds.js";

/**
 * Everything the voting posts and panels read or write about a round. The live
 * source is the API; the voting sandbox (/vote-sandbox, test mode only) swaps
 * in an in-memory round so the same handlers run without touching production.
 */
export interface IVotingDataSource {
  getRound(roundNumber: number): Promise<IVotingRound | null>;
  getCurrentRound(): Promise<IVotingRound | null>;
  listNominations(kind: NominationKind, roundNumber: number): Promise<INominationEntry[]>;
  getTally(kind: NominationKind, roundNumber: number): Promise<IVoteTally>;
  getVotesForUser(
    kind: NominationKind,
    roundNumber: number,
    userId: string,
  ): Promise<IVoteEntry[]>;
  castVote(
    kind: NominationKind,
    roundNumber: number,
    userId: string,
    nominationId: number,
  ): Promise<IVoteCastResult | null>;
  resolveTie(
    roundNumber: number,
    category: VotingRoundCategory,
    gameIds: number[],
  ): Promise<IVotingRound>;
}

export const apiVotingDataSource: IVotingDataSource = {
  getRound: (roundNumber) => VotingRounds.getByRound(roundNumber),
  getCurrentRound: () => VotingRounds.getCurrent(),
  listNominations: listNominationsForRound,
  getTally: getVoteTally,
  getVotesForUser,
  castVote,
  resolveTie: (roundNumber, category, gameIds) =>
    VotingRounds.resolveTie(roundNumber, category, gameIds),
};
