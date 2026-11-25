import { apiGet, apiGetOrThrow, apiPostOrThrow } from "./RpgClubApiClient.js";

// The GOTY Vote endpoints (spec api#471) the bot's /goty reads and writes. Field names
// follow the API's swagger (GotyVoteSummary, GotyVote, GotyAward, GotyVoteCastResult), so
// the shapes below are the wire shapes. Every /goty subcommand shares this client; each
// ticket adds the endpoints it needs (nominations, results, admin) to IGotyVoteApi.

/** The three Awards, in the order the API lists them. */
export const GOTY_AWARDS = ["gotm", "nr_gotm", "game_of_the_year"] as const;
export type GotyAwardKey = (typeof GOTY_AWARDS)[number];

/** The glossary names of the Awards. */
export const GOTY_AWARD_LABELS: Readonly<Record<GotyAwardKey, string>> = {
  gotm: "GOTM of the Year",
  nr_gotm: "NR-GOTM of the Year",
  game_of_the_year: "Game of the Year",
};

export function parseGotyAward(value: string): GotyAwardKey | null {
  return (GOTY_AWARDS as readonly string[]).includes(value) ? (value as GotyAwardKey) : null;
}

export type GotyVotePhase =
  | "upcoming"
  | "nominating"
  | "voting"
  | "closed"
  | "runoff"
  | "tie"
  | "decided";

export interface IGotyGame {
  game_id: number;
  title: string;
  cover_url?: string | null;
}

export interface IGotyVoteSummary {
  year: number;
  /** e.g. "GOTY Vote 2026". */
  name: string;
  nominations_open_at: string;
  voting_opens_at: string;
  voting_closes_at: string;
  closed_at?: string | null;
  runoff_opens_at?: string | null;
  runoff_closes_at?: string | null;
  runoff_closed_at?: string | null;
  decided_at?: string | null;
  phase: GotyVotePhase;
  nominations_open: boolean;
  voting_open: boolean;
  runoff_open: boolean;
}

export type GotyDecidedBy = "vote" | "runoff" | "admin" | "uncontested";

export interface IGotyAwardWinner {
  gamedb_game_id: number;
  decided_by: GotyDecidedBy;
  game?: IGotyGame | null;
}

export interface IGotyAward {
  award: GotyAwardKey;
  name: string;
  /** The candidates (frozen once voting opens). */
  ballot: IGotyGame[];
  /** The viewer's cap on the ballot open now: 1 in the Award's runoff. */
  cap: number;
  /** The Award's runoff games (ids); empty when it had none. */
  runoff_ballot: number[];
  pending_tie: number[];
  own_votes: number[];
  own_runoff_votes: number[];
  winner?: IGotyAwardWinner | null;
}

export interface IGotyVote extends IGotyVoteSummary {
  candidates_frozen_at?: string | null;
  awards: IGotyAward[];
}

export interface IGotyBallotVote {
  id: number;
  year: number;
  award: GotyAwardKey;
  user_id: string;
  gamedb_game_id: number;
  runoff: boolean;
  voted_at: string;
  game?: IGotyGame | null;
}

export interface IGotyVoteCastResult {
  action: "voted" | "unvoted";
  vote: IGotyBallotVote | null;
  removed_votes: IGotyBallotVote[];
  cap: number;
  runoff: boolean;
  warning: string | null;
}

export interface IGotyVoteApi {
  /** Every year's GOTY Vote, newest first. */
  listVotes(): Promise<IGotyVoteSummary[]>;
  /** One year's GOTY Vote with `userId`'s own votes; null for a year with none. */
  getVote(year: number, userId: string): Promise<IGotyVote | null>;
  /**
   * Casts or toggles `userId`'s vote in an Award. Throws the AxiosError on a refusal
   * (422 voting_closed, not_a_candidate, uncontested, not_in_runoff, ...).
   */
  castVote(
    year: number,
    userId: string,
    award: GotyAwardKey,
    gameId: number,
  ): Promise<IGotyVoteCastResult>;
}

const GOTY_VOTES_PATH = "/api/v1/goty_votes";

export const GOTY_VOTE_API: IGotyVoteApi = {
  async listVotes() {
    const payload = await apiGetOrThrow<{ data: IGotyVoteSummary[] }>(GOTY_VOTES_PATH, {
      params: { per: 50 },
    });
    return payload.data ?? [];
  },
  async getVote(year, userId) {
    const payload = await apiGet<{ data: IGotyVote }>(`${GOTY_VOTES_PATH}/${year}`, {
      params: { user_id: userId },
    });
    return payload?.data ?? null;
  },
  async castVote(year, userId, award, gameId) {
    const payload = await apiPostOrThrow<{ data: IGotyVoteCastResult }>(
      `${GOTY_VOTES_PATH}/${year}/votes`,
      { data: { award, gamedb_game_id: gameId, user_id: userId } },
    );
    return payload.data;
  },
};
