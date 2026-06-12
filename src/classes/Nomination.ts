import { dbQuery, dbMutate } from "../db/SqlManager.js";
import { NominationSql } from "../db/sql/index.js";
import { isPositiveInt } from "../utilities/ValidationUtils.js";
import { apiGet } from "../services/RpgClubApiClient.js";

export type NominationKind = "gotm" | "nr-gotm";

export interface INominationEntry {
  id: number;
  roundNumber: number;
  userId: string;
  gameTitle: string;
  gamedbGameId: number;
  nominatedAt: Date;
  reason: string | null;
}

function tableName(kind: NominationKind): string {
  return kind === "gotm" ? "GOTM_NOMINATIONS" : "NR_GOTM_NOMINATIONS";
}

function apiPrefix(kind: NominationKind): string {
  return kind === "gotm" ? "gotm_entries" : "nr_gotm_entries";
}

type NominationApiData = {
  nomination_id: number;
  round_number: number;
  user_id: string;
  gamedb_game_id: number | null;
  reason: string | null;
  nominated_at: string;
  game: { title?: string } | null;
};

type NominationListApiResponse = { data: NominationApiData[] };

function mapApiData(d: NominationApiData): INominationEntry {
  const gamedbGameId = Number(d.gamedb_game_id);
  const gameTitle = d.game?.title ?? `(missing GameDB title for id ${gamedbGameId})`;
  return {
    id: Number(d.nomination_id),
    roundNumber: Number(d.round_number),
    userId: String(d.user_id),
    gameTitle,
    gamedbGameId,
    nominatedAt: new Date(d.nominated_at),
    reason: d.reason ?? null,
  };
}

type NominationRow = {
  NOMINATION_ID: number;
  ROUND_NUMBER: number;
  USER_ID: string;
  GAMEDB_GAME_ID?: number | null;
  GAMEDB_TITLE?: string | null;
  NOMINATED_AT: Date | string;
  REASON?: string | null;
};

function mapRow(row: NominationRow): INominationEntry {
  const nominatedAt =
    row.NOMINATED_AT instanceof Date ? row.NOMINATED_AT : new Date(row.NOMINATED_AT);

  if (row.GAMEDB_GAME_ID === null || row.GAMEDB_GAME_ID === undefined) {
    throw new Error("Nomination row is missing a GameDB game id.");
  }

  const gamedbGameId = Number(row.GAMEDB_GAME_ID);
  const gameTitle =
    row.GAMEDB_TITLE !== undefined && row.GAMEDB_TITLE !== null
      ? String(row.GAMEDB_TITLE)
      : `(missing GameDB title for id ${gamedbGameId})`;

  return {
    id: Number(row.NOMINATION_ID),
    roundNumber: Number(row.ROUND_NUMBER),
    userId: String(row.USER_ID),
    gameTitle,
    gamedbGameId,
    nominatedAt,
    reason: row.REASON ?? null,
  };
}

export async function getNominationForUser(
  kind: NominationKind,
  roundNumber: number,
  userId: string,
): Promise<INominationEntry | null> {
  const rows = await dbQuery(
    NominationSql.getNominationForUser(tableName(kind)),
    { roundNumber, userId },
    mapRow,
  );
  return rows[0] ?? null;
}

export async function upsertNomination(
  kind: NominationKind,
  roundNumber: number,
  userId: string,
  gamedbGameId: number,
  reason: string | null,
): Promise<INominationEntry> {
  if (!isPositiveInt(gamedbGameId)) {
    throw new Error("A valid GameDB game id is required to save a nomination.");
  }

  await dbMutate(
    NominationSql.upsertNomination(tableName(kind)),
    { roundNumber, userId, gamedbGameId, nominatedAt: new Date(), reason },
  );

  const refreshed = await getNominationForUser(kind, roundNumber, userId);
  if (!refreshed) {
    throw new Error("Nomination upsert failed to return a row.");
  }
  return refreshed;
}

export async function deleteNominationForUser(
  kind: NominationKind,
  roundNumber: number,
  userId: string,
): Promise<boolean> {
  const count = await dbMutate(
    NominationSql.deleteNomination(tableName(kind)),
    { roundNumber, userId },
  );
  return count > 0;
}

export async function listNominationsForRound(
  kind: NominationKind,
  roundNumber: number,
): Promise<INominationEntry[]> {
  const response = await apiGet<NominationListApiResponse>(
    `/api/v1/${apiPrefix(kind)}/${roundNumber}/nominations`,
    { params: { per: 500 } },
  );
  return (response?.data ?? []).map(mapApiData);
}
