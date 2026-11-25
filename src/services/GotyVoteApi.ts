import {
  apiDelete,
  apiGet,
  apiGetOrThrow,
  apiPatchOrThrow,
  apiPostOrThrow,
} from "./RpgClubApiClient.js";

// The GOTY Vote endpoints (spec api#471) the bot reads and writes: the one GOTY API client
// and type module. Field names follow the API's swagger (GotyVoteSummary, GotyVote,
// GotyAward, GotyVoteCastResult), so the shapes below are the wire shapes. /goty uses
// them directly; /admin's GOTY actions and the outbox tie prompt read them through
// gotyAdminApi (end of file), a camelCase view over the same client.

/** The three Awards, in the order the API lists them. */
export const GOTY_AWARDS = ["gotm", "nr_gotm", "game_of_the_year"] as const;
export type GotyAwardKey = (typeof GOTY_AWARDS)[number];

/** The glossary names of the Awards. */
export const GOTY_AWARD_LABELS: Readonly<Record<GotyAwardKey, string>> = {
  gotm: "GOTM of the Year",
  nr_gotm: "NR-GOTM of the Year",
  game_of_the_year: "Game of the Year",
};

export function isGotyAward(value: unknown): value is GotyAwardKey {
  return typeof value === "string" && (GOTY_AWARDS as readonly string[]).includes(value);
}

export function parseGotyAward(value: string): GotyAwardKey | null {
  return isGotyAward(value) ? value : null;
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
  /**
   * One year's GOTY Vote, with `userId`'s own votes when given; null for a year with
   * none (404).
   */
  getVote(year: number, userId?: string): Promise<IGotyVote | null>;
  /**
   * The Current GOTY Vote (api#482): the undecided one taking nominations or votes, or
   * waiting on its tally, a runoff or a tie; else the upcoming one. The API owns that
   * rule. With `userId`'s own votes when given; null when no GOTY Vote is undecided (404).
   */
  current(userId?: string): Promise<IGotyVote | null>;
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
  /**
   * Eligibility for several games in one call (at most 50 ids). Unknown ids are left out,
   * so match the answers by game_id, not by position. Throws on any failure.
   */
  eligibilities(gameIds: number[], year: number): Promise<IGotyEligibility[]>;
  /** PATCH /goty_votes/:year: moves the dates given. Throws the AxiosError on a refusal. */
  moveDates(year: number, changes: IGotyDateChanges): Promise<IGotyVote>;
  /** Records an admin's pick for an Award's tie. Throws the AxiosError on a refusal. */
  resolveTie(year: number, award: GotyAwardKey, gameId: number): Promise<IGotyVote>;
}

/** The dates an admin moves; only the ones given are sent. */
export interface IGotyDateChanges {
  nominationsOpenAt?: Date;
  votingOpensAt?: Date;
  votingClosesAt?: Date;
}

/** The PATCH /goty_votes/:year body: only the dates being moved. */
export function buildGotyDatesBody(changes: IGotyDateChanges): Record<string, string> {
  const data: Record<string, string> = {};
  if (changes.nominationsOpenAt) {
    data.nominations_open_at = changes.nominationsOpenAt.toISOString();
  }
  if (changes.votingOpensAt) data.voting_opens_at = changes.votingOpensAt.toISOString();
  if (changes.votingClosesAt) data.voting_closes_at = changes.votingClosesAt.toISOString();
  return data;
}

function requireVote(payload: { data?: IGotyVote } | null, what: string): IGotyVote {
  if (!payload?.data) throw new Error(`The API returned no GOTY Vote after ${what}.`);
  return payload.data;
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
      params: userId ? { user_id: userId } : {},
    });
    return payload?.data ?? null;
  },
  async current(userId) {
    const payload = await apiGet<{ data: IGotyVote }>(`${GOTY_VOTES_PATH}/current`, {
      params: userId ? { user_id: userId } : {},
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
  async eligibilities(gameIds, year) {
    const payload = await apiGetOrThrow<{ data: IGotyEligibility[] }>(
      "/api/v1/games/goty_eligibility",
      { params: { year, game_ids: gameIds.join(",") } },
    );
    return payload.data;
  },
  async moveDates(year, changes) {
    const payload = await apiPatchOrThrow<{ data?: IGotyVote }>(`${GOTY_VOTES_PATH}/${year}`, {
      data: buildGotyDatesBody(changes),
    });
    return requireVote(payload, `moving the GOTY Vote ${year} dates`);
  },
  async resolveTie(year, award, gameId) {
    const payload = await apiPostOrThrow<{ data?: IGotyVote }>(
      `${GOTY_VOTES_PATH}/${year}/awards/${award}/resolve_tie`,
      { data: { gamedb_game_id: gameId } },
    );
    return requireVote(payload, `settling the GOTY Vote ${year} tie`);
  },
};

// ---------------------------------------------------------------------------
// Admin view (bot#1583): /admin's GOTY actions and the outbox tie prompt read the same
// endpoints as a camelCase view with the ties and winners picked out.
// ---------------------------------------------------------------------------

/** A game as the admin prompts name it. */
export interface IGotyGameRef {
  id: number;
  title: string;
}

export interface IGotyVoteSchedule {
  year: number;
  name: string;
  phase: string;
  nominationsOpenAt: Date;
  votingOpensAt: Date;
  votingClosesAt: Date;
  decidedAt: Date | null;
}

/** An Award whose runoff tied again (or whose runoff is still open), for an admin pick. */
export interface IGotyTie {
  award: GotyAwardKey;
  name: string;
  games: IGotyGameRef[];
}

export interface IGotyWinner {
  award: GotyAwardKey;
  name: string;
  game: IGotyGameRef;
  decidedBy: string;
}

export interface IGotyVoteAdminView extends IGotyVoteSchedule {
  ties: IGotyTie[];
  winners: IGotyWinner[];
}

export interface IGotyAdminNomination {
  id: number;
  year: number;
  userId: string;
  gameId: number;
  gameTitle: string | null;
  /** The nominator's display name, for pickers; null when the API sent none. */
  userName: string | null;
}

export interface IGotyAdminApi {
  /** One year's GOTY Vote; null on 404. */
  getVote(year: number): Promise<IGotyVoteAdminView | null>;
  /** The Current GOTY Vote (see IGotyVoteApi.current); null when none is undecided. */
  current(): Promise<IGotyVoteAdminView | null>;
  /** Moves the dates given. Throws the AxiosError for every failure. */
  moveDates(year: number, changes: IGotyDateChanges): Promise<IGotyVoteAdminView>;
  /** Settles an Award's tie. Throws the AxiosError. */
  resolveTie(year: number, award: GotyAwardKey, gameId: number): Promise<IGotyVoteAdminView>;
  /** The year's nominations, oldest first. */
  listNominations(year: number): Promise<IGotyAdminNomination[]>;
  /** Plain delete as the service; false when it was already gone (404). */
  deleteNomination(year: number, nominationId: number): Promise<boolean>;
}

type IGotyScheduleFields = Pick<
  IGotyVoteSummary,
  "year" | "name" | "phase" | "nominations_open_at" | "voting_opens_at" | "voting_closes_at" |
    "decided_at"
>;

/** What the admin view reads of a GotyVote. */
export type IGotyVoteForAdmin = IGotyScheduleFields & {
  awards?: Pick<IGotyAward, "award" | "name" | "ballot" | "pending_tie" | "winner">[];
};

function gameRefTitle(game: IGotyGame | null | undefined, id: number): string {
  return game?.title?.trim() || `Game ${id}`;
}

export function mapGotyVoteSchedule(data: IGotyScheduleFields): IGotyVoteSchedule {
  return {
    year: data.year,
    name: data.name ?? `GOTY Vote ${data.year}`,
    phase: data.phase,
    nominationsOpenAt: new Date(data.nominations_open_at),
    votingOpensAt: new Date(data.voting_opens_at),
    votingClosesAt: new Date(data.voting_closes_at),
    decidedAt: data.decided_at ? new Date(data.decided_at) : null,
  };
}

export function mapGotyVoteAdminView(data: IGotyVoteForAdmin): IGotyVoteAdminView {
  const ties: IGotyTie[] = [];
  const winners: IGotyWinner[] = [];
  for (const award of data.awards ?? []) {
    if (!isGotyAward(award.award)) continue;
    const name = award.name ?? GOTY_AWARD_LABELS[award.award];
    const ballot = new Map(
      (award.ballot ?? []).map((game) => [game.game_id, gameRefTitle(game, game.game_id)]),
    );
    const tied = award.pending_tie ?? [];
    if (tied.length > 0) {
      ties.push({
        award: award.award,
        name,
        games: tied.map((id) => ({ id, title: ballot.get(id) ?? `Game ${id}` })),
      });
    }
    if (award.winner) {
      const id = award.winner.gamedb_game_id;
      const title = award.winner.game
        ? gameRefTitle(award.winner.game, id)
        : ballot.get(id) ?? `Game ${id}`;
      winners.push({
        award: award.award,
        name,
        game: { id, title },
        decidedBy: award.winner.decided_by,
      });
    }
  }
  return { ...mapGotyVoteSchedule(data), ties, winners };
}

export function mapGotyAdminNomination(data: IGotyNomination): IGotyAdminNomination {
  return {
    id: data.id,
    year: data.year,
    userId: data.user_id,
    gameId: data.gamedb_game_id,
    gameTitle: data.game?.title?.trim() || null,
    userName: data.user?.global_name?.trim() || data.user?.username?.trim() || null,
  };
}

/** The admin view over `api` (GOTY_VOTE_API by default). */
export function createGotyAdminApi(api: IGotyVoteApi = GOTY_VOTE_API): IGotyAdminApi {
  return {
    async getVote(year) {
      const vote = await api.getVote(year);
      return vote ? mapGotyVoteAdminView(vote) : null;
    },
    async current() {
      const vote = await api.current();
      return vote ? mapGotyVoteAdminView(vote) : null;
    },
    async moveDates(year, changes) {
      return mapGotyVoteAdminView(await api.moveDates(year, changes));
    },
    async resolveTie(year, award, gameId) {
      return mapGotyVoteAdminView(await api.resolveTie(year, award, gameId));
    },
    async listNominations(year) {
      return (await api.listNominations(year)).map(mapGotyAdminNomination);
    },
    deleteNomination: (year, nominationId) => api.withdrawNomination(year, nominationId),
  };
}

export const gotyAdminApi: IGotyAdminApi = createGotyAdminApi();
