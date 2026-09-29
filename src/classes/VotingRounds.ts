import { apiGet, apiPatch } from "../services/RpgClubApiClient.js";

/**
 * Where a round is in its lifecycle, as the API decides it: members nominate
 * until voting opens, vote until it closes, then the tally decides the
 * winners (or leaves a tie for the admins) and the round is decided.
 */
export type VotingPhase = "nominating" | "voting" | "closed" | "tie" | "decided";

export type VotingRoundCategory = "gotm" | "nr_gotm";

export interface IVotingRoundTieGame {
  gameId: number;
  title: string;
  coverUrl: string | null;
}

/**
 * A GOTM / NR-GOTM round from /api/v1/voting_rounds. `roundNumber` is the round
 * members nominate for, vote on and win; nominations close and voting opens at
 * `votingOpensAt`. The API owns the lifecycle, so `phase` and the booleans are
 * its verdict: read them instead of deriving a round or a window locally.
 */
export interface IVotingRound {
  roundNumber: number;
  monthYear: string;
  votingOpensAt: Date;
  votingClosesAt: Date;
  closedAt: Date | null;
  decidedAt: Date | null;
  phase: VotingPhase;
  nominationsOpen: boolean;
  votingOpen: boolean;
  votingEnded: boolean;
  pendingTies: Partial<Record<VotingRoundCategory, IVotingRoundTieGame[]>>;
}

type TieGameApiData = { game_id: number; title: string; cover_url: string | null };

export type VotingRoundApiData = {
  round_number: number;
  month_year: string;
  voting_opens_at: string;
  voting_closes_at: string;
  closed_at: string | null;
  decided_at: string | null;
  phase: VotingPhase;
  nominations_open: boolean;
  voting_open: boolean;
  voting_ended: boolean;
  pending_ties: Partial<Record<VotingRoundCategory, TieGameApiData[]>>;
};

type VotingRoundResponse = { data: VotingRoundApiData | null };

/**
 * An admin reschedule. Moving the open without a close keeps the default
 * weekend window; closing voting early is `votingClosesAt: now`. The API
 * refuses a decided round and a close that is not after the open.
 */
export interface IVotingRoundUpdate {
  votingOpensAt?: Date;
  votingClosesAt?: Date;
}

function parseApiDate(value: string, field: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${field} on voting round: ${JSON.stringify(value)}`);
  }
  return date;
}

function toDateOrNull(value: string | null, field: string): Date | null {
  return value ? parseApiDate(value, field) : null;
}

export function mapVotingRoundApiData(d: VotingRoundApiData): IVotingRound {
  const pendingTies: IVotingRound["pendingTies"] = {};
  for (const [category, games] of Object.entries(d.pending_ties ?? {})) {
    pendingTies[category as VotingRoundCategory] = (games ?? []).map((game) => ({
      gameId: Number(game.game_id),
      title: game.title,
      coverUrl: game.cover_url ?? null,
    }));
  }
  return {
    roundNumber: Number(d.round_number),
    monthYear: d.month_year,
    votingOpensAt: parseApiDate(d.voting_opens_at, "voting_opens_at"),
    votingClosesAt: parseApiDate(d.voting_closes_at, "voting_closes_at"),
    closedAt: toDateOrNull(d.closed_at, "closed_at"),
    decidedAt: toDateOrNull(d.decided_at, "decided_at"),
    phase: d.phase,
    nominationsOpen: Boolean(d.nominations_open),
    votingOpen: Boolean(d.voting_open),
    votingEnded: Boolean(d.voting_ended),
    pendingTies,
  };
}

/**
 * Whether a round's tally may be shown. Tallies stay hidden for everyone
 * (admins included) until voting ends. A round the API has no row for is
 * only treated as finished when it is older than the current round (it
 * predates the API tracking the lifecycle); anything else fails closed.
 */
export function isRoundTallyRevealed(
  roundNumber: number,
  round: IVotingRound | null,
  current: IVotingRound | null,
): boolean {
  if (round) return round.votingEnded;
  return current !== null && roundNumber < current.roundNumber;
}

function normalizeRoundNumber(roundNumber: number): number {
  const round = Number(roundNumber);
  if (!Number.isInteger(round) || round <= 0) {
    throw new Error(`Invalid voting round number: ${roundNumber}`);
  }
  return round;
}

export default class VotingRounds {
  /**
   * The one round the club is on: the lowest round not yet decided, whatever
   * its phase. Null when the API has no round scheduled.
   */
  static async getCurrent(): Promise<IVotingRound | null> {
    const response = await apiGet<VotingRoundResponse>("/api/v1/voting_rounds/current");
    return response?.data ? mapVotingRoundApiData(response.data) : null;
  }

  /**
   * A specific round, or null when the API has no row for it. Rounds from
   * before the API tracked the lifecycle have no row; every one of them is
   * finished.
   */
  static async getByRound(roundNumber: number): Promise<IVotingRound | null> {
    const round = normalizeRoundNumber(roundNumber);
    const response = await apiGet<VotingRoundResponse>(`/api/v1/voting_rounds/${round}`);
    return response?.data ? mapVotingRoundApiData(response.data) : null;
  }

  /** Reschedules a round. Throws when the API has no row for it. */
  static async reschedule(
    roundNumber: number,
    changes: IVotingRoundUpdate,
  ): Promise<IVotingRound> {
    const round = normalizeRoundNumber(roundNumber);
    const data: Record<string, string> = {};
    if (changes.votingOpensAt) data.voting_opens_at = changes.votingOpensAt.toISOString();
    if (changes.votingClosesAt) data.voting_closes_at = changes.votingClosesAt.toISOString();
    const response = await apiPatch<VotingRoundResponse>(`/api/v1/voting_rounds/${round}`, {
      data,
    });
    if (!response?.data) {
      throw new Error(`No voting round ${round} was found to update.`);
    }
    return mapVotingRoundApiData(response.data);
  }
}
