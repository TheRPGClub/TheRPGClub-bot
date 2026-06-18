import { apiGet, apiPost, apiPatch, apiDelete } from "../services/RpgClubApiClient.js";
import Game from "./Game.js";
import { getThreadsByGameId } from "./Thread.js";
import { isPositiveInt, requirePositiveInt } from "../utilities/ValidationUtils.js";

export interface INrGotmGame {
  id?: number | null;
  title: string;
  threadId: string | null;
  redditUrl: string | null;
  gamedbGameId: number;
}

export interface INrGotmEntry {
  round: number;
  monthYear: string;
  gameOfTheMonth: INrGotmGame[];
  votingResultsMessageId?: string | null;
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

let nrGotmData: INrGotmEntry[] = [];
let loadPromise: Promise<INrGotmEntry[]> | null = null;
let nrGotmLoaded = false;
const nrGameCache: Map<number, { title: string }> = new Map();

async function getNrGameDetailsCached(gameId: number): Promise<{ title: string }> {
  const cached = nrGameCache.get(gameId);
  if (cached) return cached;
  const game = await Game.getGameById(gameId);
  if (!game) {
    throw new Error(`GameDB game ${gameId} not found for NR-GOTM entry.`);
  }
  const payload = { title: game.title };
  nrGameCache.set(gameId, payload);
  return payload;
}

async function getPrimaryThreadIdForGame(gameId: number): Promise<string | null> {
  const threadIds = await getThreadsByGameId(gameId);
  return threadIds[0] ?? null;
}

type NrGotmEntryApiRow = {
  nr_gotm_id: number;
  round_number: number;
  month_year: string;
  game_index: number;
  reddit_url: string | null;
  voting_results_message_id: string | null;
  gamedb_game_id: number | null;
  game?: { title?: string } | null;
};

type NrGotmEntryListResponse = { data: NrGotmEntryApiRow[] };

async function loadFromDatabaseInternal(): Promise<INrGotmEntry[]> {
  const response = await apiGet<NrGotmEntryListResponse>(
    "/api/v1/nr_gotm_entries",
    { params: { include: "game", per: 500 } },
  );
  const rows = response?.data ?? [];

  const byRound = new Map<number, INrGotmEntry>();

  for (const row of rows) {
    const round = Number(row.round_number);
    if (!Number.isFinite(round)) continue;

    const monthYear = row.month_year;
    const votingId = row.voting_results_message_id ?? null;

    let entry = byRound.get(round);
    if (!entry) {
      entry = {
        round,
        monthYear,
        gameOfTheMonth: [],
      };
      if (votingId) {
        entry.votingResultsMessageId = votingId;
      }
      byRound.set(round, entry);
    } else if (!entry.votingResultsMessageId && votingId) {
      entry.votingResultsMessageId = votingId;
    }

    const gamedbGameId = Number(row.gamedb_game_id);
    if (!isPositiveInt(gamedbGameId)) {
      throw new Error(
        `NR-GOTM round ${round} game ${row.game_index} is missing gamedb_game_id.`,
      );
    }

    const embeddedTitle = row.game?.title;
    const title = embeddedTitle ?? (await getNrGameDetailsCached(gamedbGameId)).title;
    if (embeddedTitle) {
      nrGameCache.set(gamedbGameId, { title: embeddedTitle });
    }

    const derivedThreadId = await getPrimaryThreadIdForGame(gamedbGameId);

    const game: INrGotmGame = {
      id: Number(row.nr_gotm_id),
      title,
      threadId: derivedThreadId,
      redditUrl: row.reddit_url ?? null,
      gamedbGameId,
    };

    entry.gameOfTheMonth.push(game);
  }

  const data = Array.from(byRound.values()).sort((a, b) => a.round - b.round);
  nrGotmData = data;
  nrGotmLoaded = true;
  return nrGotmData;
}

export async function loadNrGotmFromDb(): Promise<void> {
  if (nrGotmLoaded) return;
  if (!loadPromise) {
    loadPromise = loadFromDatabaseInternal().catch((err) => {
      loadPromise = null;
      throw err;
    });
  }
  await loadPromise;
}

function ensureInitialized(): void {
  if (!nrGotmLoaded) {
    throw new Error("NR-GOTM data not initialized. Call loadNrGotmFromDb() during startup.");
  }
}

function parseYear(value: string): number | null {
  const m = value.match(/(\d{4})\s*$/);
  return m ? Number(m[1]) : null;
}

function parseMonthLabel(value: string): string {
  const label = value.replace(/\s*\d{4}\s*$/, "").trim();
  return label;
}

function monthNumberToName(month: number): string | null {
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return MONTHS[month - 1];
}

export default class NrGotm {
  static all(): INrGotmEntry[] {
    ensureInitialized();
    return nrGotmData.slice();
  }

  static getByRound(round: number): INrGotmEntry[] {
    ensureInitialized();
    return nrGotmData.filter((e) => e.round === round);
  }

  static getByYearMonth(year: number, month: number | string): INrGotmEntry[] {
    ensureInitialized();
    const yearNum = Number(year);
    if (!Number.isFinite(yearNum)) return [];

    const wantedLabel: string | null =
      typeof month === "number" ? monthNumberToName(month) : month?.trim() ?? null;

    if (!wantedLabel) return [];
    const wantedLower = wantedLabel.toLowerCase();

    return nrGotmData.filter((e) => {
      const y = parseYear(e.monthYear);
      if (y !== yearNum) return false;
      const labelLower = parseMonthLabel(e.monthYear).toLowerCase();
      return labelLower === wantedLower;
    });
  }

  static getByYear(year: number): INrGotmEntry[] {
    ensureInitialized();
    const yearNum = Number(year);
    if (!Number.isFinite(yearNum)) return [];
    return nrGotmData.filter((e) => parseYear(e.monthYear) === yearNum);
  }

  static searchByTitle(query: string): INrGotmEntry[] {
    ensureInitialized();
    if (!query?.trim()) return [];
    const q = query.toLowerCase();
    return nrGotmData.filter((e) =>
      e.gameOfTheMonth.some((g) => g.title.toLowerCase().includes(q)),
    );
  }

  static addRound(round: number, monthYear: string, games: INrGotmGame[]): INrGotmEntry {
    ensureInitialized();
    const r = Number(round);
    if (!Number.isFinite(r)) {
      throw new Error("Invalid round number for new NR-GOTM round.");
    }
    if (nrGotmData.some((e) => e.round === r)) {
      throw new Error(`NR-GOTM round ${r} already exists.`);
    }
    const entry: INrGotmEntry = {
      round: r,
      monthYear,
      gameOfTheMonth: games.map((g) => {
        requirePositiveInt(g.gamedbGameId, "GameDB id");
        return {
          id: g.id ?? null,
          title: g.title,
          threadId: g.threadId ?? null,
          redditUrl: g.redditUrl ?? null,
          gamedbGameId: g.gamedbGameId,
        };
      }),
    };
    nrGotmData.push(entry);
    nrGotmData.sort((a, b) => a.round - b.round);
    return entry;
  }

  private static getRoundEntry(round: number): INrGotmEntry | null {
    ensureInitialized();
    const r = Number(round);
    if (!Number.isFinite(r)) return null;
    const entry = nrGotmData.find((e) => e.round === r) ?? null;
    return entry ?? null;
  }

  private static resolveIndex(entry: INrGotmEntry, index?: number): number {
    const arrLen = entry.gameOfTheMonth.length;
    if (arrLen === 0) throw new Error(`Round ${entry.round} has no games.`);
    if (arrLen === 1) return 0;
    if (index === undefined || index === null) {
      throw new Error(
        `Round ${entry.round} has ${arrLen} games; provide an index (0-${arrLen - 1}).`,
      );
    }
    if (!Number.isInteger(index) || index < 0 || index >= arrLen) {
      throw new Error(`Index ${index} out of bounds for round ${entry.round}.`);
    }
    return index;
  }

  static updateThreadIdByRound(
    round: number,
    threadId: string | null,
    index?: number,
  ): INrGotmEntry | null {
    const entry = this.getRoundEntry(round);
    if (!entry) return null;
    const i = this.resolveIndex(entry, index);
    entry.gameOfTheMonth[i].threadId = threadId === null ? null : String(threadId);
    return entry;
  }

  static updateRedditUrlByRound(
    round: number,
    redditUrl: string | null,
    index?: number,
  ): INrGotmEntry | null {
    const entry = this.getRoundEntry(round);
    if (!entry) return null;
    const i = this.resolveIndex(entry, index);
    entry.gameOfTheMonth[i].redditUrl = redditUrl;
    return entry;
  }

  static updateGamedbIdByRound(
    round: number,
    gamedbGameId: number,
    index?: number,
  ): INrGotmEntry | null {
    const entry = this.getRoundEntry(round);
    if (!entry) return null;
    requirePositiveInt(gamedbGameId, "GameDB id");
    const i = this.resolveIndex(entry, index);
    entry.gameOfTheMonth[i].gamedbGameId = gamedbGameId;
    void getNrGameDetailsCached(gamedbGameId).then((meta) => {
      entry.gameOfTheMonth[i].title = meta.title;
      nrGameCache.set(gamedbGameId, meta);
    });
    return entry;
  }

  static updateVotingResultsByRound(
    round: number,
    messageId: string | null,
  ): INrGotmEntry | null {
    const entry = this.getRoundEntry(round);
    if (!entry) return null;
    entry.votingResultsMessageId = messageId;
    return entry;
  }

  static deleteRound(round: number): INrGotmEntry | null {
    ensureInitialized();
    const r = Number(round);
    if (!Number.isFinite(r)) return null;
    const index = nrGotmData.findIndex((e) => e.round === r);
    if (index === -1) return null;
    const [removed] = nrGotmData.splice(index, 1);
    return removed ?? null;
  }
}

export type NrGotmDatabaseEditableField = "redditUrl" | "gamedbGameId";

type NrGotmEntrySingleResponse = { data: NrGotmEntryApiRow };

async function fetchNrGotmRowsByRound(round: number): Promise<NrGotmEntryApiRow[]> {
  const response = await apiGet<NrGotmEntryListResponse>(
    "/api/v1/nr_gotm_entries",
    { params: { round_number: round, per: 500 } },
  );
  const rows = response?.data ?? [];
  return rows
    .filter((r) => Number(r.round_number) === round)
    .sort((a, b) => Number(a.game_index) - Number(b.game_index));
}

async function patchNrGotmRow(
  rowId: number,
  field: NrGotmDatabaseEditableField,
  value: string | number | null,
): Promise<void> {
  const data: Record<string, string | number | null> = {};
  if (field === "gamedbGameId") {
    data.gamedb_game_id = value as number;
  } else {
    data.reddit_url = value as string | null;
  }
  await apiPatch(`/api/v1/nr_gotm_entries/${rowId}`, { data });
}

export async function updateNrGotmGameFieldInDatabase(
  opts: {
    rowId?: number | null;
    round?: number;
    gameIndex?: number;
    field: NrGotmDatabaseEditableField;
    value: string | number | null;
  },
): Promise<void> {
  ensureInitialized();

  let value = opts.value;
  if (opts.field === "gamedbGameId") {
    const newId = Number(opts.value);
    requirePositiveInt(newId, "GameDB id");
    const exists = await getNrGameDetailsCached(newId);
    nrGameCache.set(newId, exists);
    value = newId;
  }

  if (opts.rowId) {
    await patchNrGotmRow(opts.rowId, opts.field, value);

    const entryWithRow = nrGotmData.find((e) =>
      e.gameOfTheMonth.some((g) => Number(g.id) === Number(opts.rowId)),
    );
    if (entryWithRow) {
      for (const g of entryWithRow.gameOfTheMonth) {
        if (Number(g.id) === Number(opts.rowId)) {
          if (opts.field === "gamedbGameId") {
            const newId = value as number;
            g.gamedbGameId = newId;
            const meta = await getNrGameDetailsCached(newId);
            g.title = meta.title;
            g.threadId = await getPrimaryThreadIdForGame(newId);
          } else if (opts.field === "redditUrl") {
            g.redditUrl = opts.value as string | null;
          }
        }
      }
    }
    return;
  }

  const { round, gameIndex } = opts;
  if (!Number.isInteger(round)) {
    throw new Error("round is required when rowId is not provided.");
  }
  if (!Number.isInteger(gameIndex)) {
    throw new Error("gameIndex is required when rowId is not provided.");
  }

  const rows = await fetchNrGotmRowsByRound(round as number);
  if (!rows.length) {
    throw new Error(`No NR-GOTM database rows found for round ${round}.`);
  }

  const gi = Number(gameIndex);
  if (!Number.isInteger(gi) || gi < 0 || gi >= rows.length) {
    throw new Error(
      `Game index ${gameIndex} is out of range for NR-GOTM round ${round} ` +
      `(have ${rows.length} games).`,
    );
  }

  const rowId = rows[gi].nr_gotm_id;
  await patchNrGotmRow(rowId, opts.field, value);

  const entry = nrGotmData.find((e) => e.round === round);
  if (entry && entry.gameOfTheMonth[gi]) {
    const target = entry.gameOfTheMonth[gi];
    if (opts.field === "gamedbGameId") {
      const newId = value as number;
      target.gamedbGameId = newId;
      const meta = await getNrGameDetailsCached(newId);
      target.title = meta.title;
      target.threadId = await getPrimaryThreadIdForGame(newId);
    } else if (opts.field === "redditUrl") {
      target.redditUrl = opts.value as string | null;
    }
  }
}

export async function updateNrGotmVotingResultsInDatabase(
  round: number,
  messageId: string | null,
): Promise<void> {
  const rows = await fetchNrGotmRowsByRound(round);
  for (const row of rows) {
    await apiPatch(`/api/v1/nr_gotm_entries/${row.nr_gotm_id}`, {
      data: { voting_results_message_id: messageId },
    });
  }
}

export async function insertNrGotmRoundInDatabase(
  round: number,
  monthYear: string,
  games: INrGotmGame[],
): Promise<number[]> {
  if (!Number.isFinite(round) || round <= 0) {
    throw new Error("Invalid round number for NR-GOTM insert.");
  }
  if (!games.length) {
    throw new Error("At least one game is required for an NR-GOTM round.");
  }

  const existing = await fetchNrGotmRowsByRound(round);
  if (existing.length > 0) {
    throw new Error(`NR-GOTM round ${round} already exists in the database.`);
  }

  const insertedIds: number[] = [];

  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    if (!isPositiveInt(g.gamedbGameId)) {
      throw new Error(`GameDB id is required for NR-GOTM round ${round}, game ${i + 1}.`);
    }
    const meta = await getNrGameDetailsCached(g.gamedbGameId);
    const created = await apiPost<NrGotmEntrySingleResponse>("/api/v1/nr_gotm_entries", {
      data: {
        round_number: round,
        month_year: monthYear,
        game_index: i,
        reddit_url: g.redditUrl ?? null,
        gamedb_game_id: g.gamedbGameId,
      },
    });

    const newId = Number(created?.data?.nr_gotm_id);
    if (Number.isFinite(newId)) insertedIds.push(newId);
    games[i].title = meta.title;
  }

  return insertedIds;
}

export async function deleteNrGotmRoundFromDatabase(round: number): Promise<number> {
  if (!Number.isFinite(round) || round <= 0) {
    throw new Error("Invalid round number for NR-GOTM delete.");
  }

  const rows = await fetchNrGotmRowsByRound(round);
  for (const row of rows) {
    await apiDelete(`/api/v1/nr_gotm_entries/${row.nr_gotm_id}`);
  }
  return rows.length;
}
