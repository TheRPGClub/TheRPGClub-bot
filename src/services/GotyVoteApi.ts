import {
  apiDelete,
  apiGet,
  apiGetOrThrow,
  apiPostOrThrow,
} from "./RpgClubApiClient.js";

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
  /** Each Award's winner in Award order once the year is decided; empty before then. */
  winners?: IGotyVoteWinner[];
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
  /** Counts per candidate, hidden from members while a ballot is open. */
  tally?: IGotyAwardTally;
  /** Every candidate's votes once the GOTY Vote is decided; else null. */
  result?: IGotyAwardResult[] | null;
}

/** A decided year's winner of one Award (`GotyVoteSummary.winners`). */
export interface IGotyVoteWinner extends IGotyAwardWinner {
  award: GotyAwardKey;
  name: string;
}

export interface IGotyAwardTally {
  counts_hidden: boolean;
  runoff_counts_hidden: boolean;
  games?: { gamedb_game_id: number; votes: number; runoff_votes: number }[];
}

export interface IGotyAwardResult {
  gamedb_game_id: number;
  votes: number;
  runoff_votes: number;
}

/** A member as the API summarises them. */
export interface IGotyMember {
  user_id: string;
  username?: string | null;
  global_name?: string | null;
}

/** One Game of the Year nomination. Nominations carry no reason (api#473). */
export interface IGotyNomination {
  id: number;
  year: number;
  user_id: string;
  gamedb_game_id: number;
  nominated_at: string;
  user?: IGotyMember | null;
  game?: (IGotyGame & { initial_release_date?: string | null }) | null;
}

export type GotyIneligibleReason = "not_released_in_year" | "release_unknown";

/** Whether a game may be nominated for a year's Game of the Year, and why not. */
export interface IGotyEligibility {
  game_id: number;
  year: number;
  eligible: boolean;
  reason?: GotyIneligibleReason | null;
  /** The date judged: the earliest dated Release, or the initial release date. */
  released_on?: string | null;
  date_precision?: string | null;
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
  /** The year's Game of the Year nominations, oldest first; only `userId`'s when given. */
  listNominations(year: number, userId?: string): Promise<IGotyNomination[]>;
  /**
   * Nominates a game for `userId` (a no-op for a game they already nominated). Throws the
   * AxiosError on a refusal (422 nominations_closed, nomination_cap_reached,
   * not_released_in_year, release_unknown).
   */
  nominate(year: number, userId: string, gameId: number): Promise<IGotyNomination>;
  /**
   * Removes a nomination by id, as the service (no reason, no announcement): the caller
   * checks it is the member's own. False when it was already gone. Throws on a refusal.
   */
  withdrawNomination(year: number, nominationId: number): Promise<boolean>;
  /** Whether the game may be nominated for the year. Throws on any failure. */
  eligibility(gameId: number, year: number): Promise<IGotyEligibility>;
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
  async listNominations(year, userId) {
    const params: Record<string, string | number> = { per: 500 };
    if (userId) params.user_id = userId;
    const payload = await apiGetOrThrow<{ data: IGotyNomination[] }>(
      `${GOTY_VOTES_PATH}/${year}/nominations`,
      { params },
    );
    return payload.data ?? [];
  },
  async nominate(year, userId, gameId) {
    const payload = await apiPostOrThrow<{ data: IGotyNomination }>(
      `${GOTY_VOTES_PATH}/${year}/nominations`,
      { data: { gamedb_game_id: gameId, user_id: userId } },
    );
    return payload.data;
  },
  async withdrawNomination(year, nominationId) {
    const payload = await apiDelete<{ deleted: boolean }>(
      `${GOTY_VOTES_PATH}/${year}/nominations/${nominationId}`,
    );
    return payload?.deleted === true;
  },
  async eligibility(gameId, year) {
    const payload = await apiGetOrThrow<{ data: IGotyEligibility }>(
      `/api/v1/games/${gameId}/goty_eligibility`,
      { params: { year } },
    );
    return payload.data;
  },
};
