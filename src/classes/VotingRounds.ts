import { apiGet, apiPatch, apiPost } from "../services/RpgClubApiClient.js";

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

type VotingRoundResponse = { data: VotingRoundApiData };

export type VotingRoundUpdate = {
  votingOpensAt?: Date;
  votingClosesAt?: Date;
  monthYear?: string;
};

function toDateOrNull(value: string | null): Date | null {
  return value ? new Date(value) : null;
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
    votingOpensAt: new Date(d.voting_opens_at),
    votingClosesAt: new Date(d.voting_closes_at),
    closedAt: toDateOrNull(d.closed_at),
    decidedAt: toDateOrNull(d.decided_at),
    phase: d.phase,
    nominationsOpen: Boolean(d.nominations_open),
    votingOpen: Boolean(d.voting_open),
    votingEnded: Boolean(d.voting_ended),
    pendingTies,
  };
}

/**
 * Whether a round's tally may be shown. Tallies stay hidden for everyone
 * (admins included) until voting ends. A round the API has no row for
 * predates it tracking the lifecycle, so it is long finished.
 */
export function isRoundTallyRevealed(round: IVotingRound | null): boolean {
  return round === null || round.votingEnded;
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
    return response ? mapVotingRoundApiData(response.data) : null;
  }

  /**
   * A specific round, or null when the API has no row for it. Rounds from
   * before the API tracked the lifecycle have no row; every one of them is
   * finished.
   */
  static async getByRound(roundNumber: number): Promise<IVotingRound | null> {
    const round = normalizeRoundNumber(roundNumber);
    const response = await apiGet<VotingRoundResponse>(`/api/v1/voting_rounds/${round}`);
    return response ? mapVotingRoundApiData(response.data) : null;
  }

  /** Reschedules a round. Moving only the open keeps the default weekend window. */
  static async update(roundNumber: number, changes: VotingRoundUpdate): Promise<IVotingRound> {
    const round = normalizeRoundNumber(roundNumber);
    const response = await apiPatch<VotingRoundResponse>(`/api/v1/voting_rounds/${round}`, {
      data: {
        ...(changes.votingOpensAt ? { voting_opens_at: changes.votingOpensAt.toISOString() } : {}),
        ...(changes.votingClosesAt
          ? { voting_closes_at: changes.votingClosesAt.toISOString() }
          : {}),
        ...(changes.monthYear ? { month_year: changes.monthYear } : {}),
      },
    });
    if (!response) {
      throw new Error(`No voting round ${round} was found to update.`);
    }
    return mapVotingRoundApiData(response.data);
  }

  /** Breaks a category's tie with one or more of the tied games. */
  static async resolveTie(
    roundNumber: number,
    category: VotingRoundCategory,
    gamedbGameIds: number[],
  ): Promise<IVotingRound> {
    const round = normalizeRoundNumber(roundNumber);
    const response = await apiPost<VotingRoundResponse>(
      `/api/v1/voting_rounds/${round}/resolve_tie`,
      { data: { category, gamedb_game_ids: gamedbGameIds } },
    );
    if (!response) {
      throw new Error(`No voting round ${round} was found to resolve a tie on.`);
    }
    return mapVotingRoundApiData(response.data);
  }
}
