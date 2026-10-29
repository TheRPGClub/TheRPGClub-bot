import { apiGet } from "../services/RpgClubApiClient.js";
import type { IGotmEntry, IGotmGame } from "./Gotm.js";
import type { INrGotmEntry } from "./NrGotm.js";

export type GotmRoundsKind = "gotm" | "nr_gotm" | "both";

type GotmRoundGameApiData = {
  game_index: number;
  gamedb_game_id?: number | null;
  reddit_url?: string | null;
  thread_id?: string | null;
  game?: { title?: string | null } | null;
};

type GotmRoundBlockApiData = {
  month_year: string;
  voting_results_message_id?: string | null;
  games: GotmRoundGameApiData[];
};

export type GotmRoundApiData = {
  round_number: number;
  gotm: GotmRoundBlockApiData | null;
  nr_gotm: GotmRoundBlockApiData | null;
};

type GotmRoundsListResponse = {
  data: GotmRoundApiData[];
  meta?: { pages?: number };
};

/** One round with each kind's winners in the shape the GOTM cards are built from. */
export type GotmRoundRecord = {
  round: number;
  gotmEntries: IGotmEntry[];
  nrGotmEntries: INrGotmEntry[];
};

const ROUNDS_PER_REQUEST = 100;

function mapGames(block: GotmRoundBlockApiData): IGotmGame[] {
  return [...block.games]
    .sort((a, b) => a.game_index - b.game_index)
    .flatMap((game) => {
      const gamedbGameId = Number(game.gamedb_game_id);
      const title = game.game?.title;
      if (!Number.isInteger(gamedbGameId) || gamedbGameId <= 0 || !title) return [];
      return [{
        title,
        threadId: game.thread_id ?? null,
        redditUrl: game.reddit_url ?? null,
        gamedbGameId,
      }];
    });
}

function mapBlock(round: number, block: GotmRoundBlockApiData | null): IGotmEntry[] {
  if (!block) return [];
  const entry: IGotmEntry = {
    round,
    monthYear: block.month_year,
    gameOfTheMonth: mapGames(block),
  };
  if (block.voting_results_message_id) {
    entry.votingResultsMessageId = block.voting_results_message_id;
  }
  return [entry];
}

export function mapGotmRound(raw: GotmRoundApiData): GotmRoundRecord {
  return {
    round: raw.round_number,
    gotmEntries: mapBlock(raw.round_number, raw.gotm),
    nrGotmEntries: mapBlock(raw.round_number, raw.nr_gotm),
  };
}

/**
 * Every round matching the filters, newest or oldest first. The API pages by round, and the
 * history view packs its own pages by card count, so all API pages are read.
 */
export async function fetchGotmRoundHistory(params: {
  kind: GotmRoundsKind;
  year: number;
  query: string;
  sort: "asc" | "desc";
}): Promise<GotmRoundRecord[]> {
  const rounds: GotmRoundRecord[] = [];
  let pages = 1;
  for (let page = 1; page <= pages; page += 1) {
    const response = await apiGet<GotmRoundsListResponse>("/api/v1/gotm_rounds", {
      params: {
        kind: params.kind,
        year: params.year,
        sort: params.sort,
        per: ROUNDS_PER_REQUEST,
        page,
        ...(params.query.trim() ? { q: params.query.trim() } : {}),
      },
    });
    rounds.push(...(response?.data ?? []).map(mapGotmRound));
    pages = response?.meta?.pages ?? 1;
  }
  return rounds;
}

/** The latest round with winners, or null when no GOTM round exists. */
export async function fetchCurrentGotmRound(): Promise<GotmRoundRecord | null> {
  const response = await apiGet<{ data: GotmRoundApiData }>("/api/v1/gotm_rounds/current");
  return response?.data ? mapGotmRound(response.data) : null;
}
