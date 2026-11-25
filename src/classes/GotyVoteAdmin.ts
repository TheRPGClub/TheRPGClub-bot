import {
  apiDelete,
  apiGet,
  apiGetOrThrow,
  apiPatchOrThrow,
  apiPostOrThrow,
} from "../services/RpgClubApiClient.js";

/**
 * The API calls behind the GOTY Vote admin actions in /admin (bot#1583, spec api#471):
 * moving a GOTY Vote's dates, settling a tie a runoff left, and removing a Game of the
 * Year nomination. The bot acts as the service, so a removal is the plain delete (no
 * reason sent, no API job queued) and the bot announces it itself, as for GOTM.
 */

export const GOTY_AWARDS = ["gotm", "nr_gotm", "game_of_the_year"] as const;
export type GotyAward = (typeof GOTY_AWARDS)[number];

export const GOTY_AWARD_NAMES: Readonly<Record<GotyAward, string>> = {
  gotm: "GOTM of the Year",
  nr_gotm: "NR-GOTM of the Year",
  game_of_the_year: "Game of the Year",
};

export function isGotyAward(value: unknown): value is GotyAward {
  return typeof value === "string" && (GOTY_AWARDS as readonly string[]).includes(value);
}

export interface IGotyGame {
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
  award: GotyAward;
  name: string;
  games: IGotyGame[];
}

export interface IGotyWinner {
  award: GotyAward;
  name: string;
  game: IGotyGame;
  decidedBy: string;
}

export interface IGotyVoteAdminView extends IGotyVoteSchedule {
  ties: IGotyTie[];
  winners: IGotyWinner[];
}

export interface IGotyNomination {
  id: number;
  year: number;
  userId: string;
  gameId: number;
  gameTitle: string | null;
  /** The nominator's display name, for pickers; null when the API sent none. */
  userName: string | null;
}

/** The dates an admin moves; only the ones given are sent. */
export interface IGotyDateChanges {
  nominationsOpenAt?: Date;
  votingOpensAt?: Date;
  votingClosesAt?: Date;
}

export interface IGotyAdminApi {
  /** GET /goty_votes, newest year first. */
  listVotes(): Promise<IGotyVoteSchedule[]>;
  /** GET /goty_votes/:year; null on 404. */
  getVote(year: number): Promise<IGotyVoteAdminView | null>;
  /** PATCH /goty_votes/:year. Throws the AxiosError for every failure. */
  moveDates(year: number, changes: IGotyDateChanges): Promise<IGotyVoteAdminView>;
  /** POST /goty_votes/:year/awards/:award/resolve_tie. Throws the AxiosError. */
  resolveTie(year: number, award: GotyAward, gameId: number): Promise<IGotyVoteAdminView>;
  /** GET /goty_votes/:year/nominations, oldest first. */
  listNominations(year: number): Promise<IGotyNomination[]>;
  /** DELETE /goty_votes/:year/nominations/:id; false when it was already gone (404). */
  deleteNomination(year: number, nominationId: number): Promise<boolean>;
}

type ApiGame = { game_id?: number; id?: number; title?: string | null };

type ApiAward = {
  award?: string;
  name?: string;
  ballot?: ApiGame[];
  pending_tie?: number[];
  winner?: { gamedb_game_id: number; decided_by: string; game?: ApiGame | null } | null;
};

type ApiVote = {
  year: number;
  name?: string;
  phase: string;
  nominations_open_at: string;
  voting_opens_at: string;
  voting_closes_at: string;
  decided_at?: string | null;
  awards?: ApiAward[];
};

type ApiNomination = {
  id: number;
  year: number;
  user_id: string;
  gamedb_game_id: number;
  game?: ApiGame | null;
  user?: { username?: string | null; global_name?: string | null } | null;
};

function gameTitle(game: ApiGame | null | undefined, id: number): string {
  return game?.title?.trim() || `Game ${id}`;
}

export function mapGotyVoteSchedule(data: ApiVote): IGotyVoteSchedule {
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

export function mapGotyVoteAdminView(data: ApiVote): IGotyVoteAdminView {
  const ties: IGotyTie[] = [];
  const winners: IGotyWinner[] = [];
  for (const award of data.awards ?? []) {
    if (!isGotyAward(award.award)) continue;
    const name = award.name ?? GOTY_AWARD_NAMES[award.award];
    const ballot = new Map(
      (award.ballot ?? []).map((game) => {
        const id = Number(game.game_id ?? game.id);
        return [id, gameTitle(game, id)] as const;
      }),
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
        ? gameTitle(award.winner.game, id)
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

function mapNomination(data: ApiNomination): IGotyNomination {
  return {
    id: data.id,
    year: data.year,
    userId: data.user_id,
    gameId: data.gamedb_game_id,
    gameTitle: data.game?.title?.trim() || null,
    userName: data.user?.global_name?.trim() || data.user?.username?.trim() || null,
  };
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

function requireVote(response: { data?: ApiVote } | null, what: string): IGotyVoteAdminView {
  if (!response?.data) throw new Error(`The API returned no GOTY Vote after ${what}.`);
  return mapGotyVoteAdminView(response.data);
}

export const gotyAdminApi: IGotyAdminApi = {
  async listVotes() {
    const response = await apiGetOrThrow<{ data?: ApiVote[] }>("/api/v1/goty_votes", {
      params: { per: 100 },
    });
    return (response?.data ?? []).map(mapGotyVoteSchedule);
  },

  async getVote(year) {
    const response = await apiGet<{ data?: ApiVote }>(`/api/v1/goty_votes/${year}`);
    return response?.data ? mapGotyVoteAdminView(response.data) : null;
  },

  async moveDates(year, changes) {
    const response = await apiPatchOrThrow<{ data?: ApiVote }>(`/api/v1/goty_votes/${year}`, {
      data: buildGotyDatesBody(changes),
    });
    return requireVote(response, `moving the GOTY Vote ${year} dates`);
  },

  async resolveTie(year, award, gameId) {
    const response = await apiPostOrThrow<{ data?: ApiVote }>(
      `/api/v1/goty_votes/${year}/awards/${award}/resolve_tie`,
      { data: { gamedb_game_id: gameId } },
    );
    return requireVote(response, `settling the GOTY Vote ${year} tie`);
  },

  async listNominations(year) {
    const response = await apiGetOrThrow<{ data?: ApiNomination[] }>(
      `/api/v1/goty_votes/${year}/nominations`,
      { params: { per: 500 } },
    );
    return (response?.data ?? []).map(mapNomination);
  },

  async deleteNomination(year, nominationId) {
    const response = await apiDelete<{ deleted?: boolean }>(
      `/api/v1/goty_votes/${year}/nominations/${nominationId}`,
    );
    return response?.deleted === true;
  },
};
