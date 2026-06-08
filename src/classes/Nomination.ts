import { oraQuery, oraMutate } from "../db/SqlManager.js";
import { getDialect } from "../db/dialect.js";
import { NominationSql } from "../db/sql/index.js";

const dialect = getDialect();

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
  const rows = await oraQuery(
    NominationSql.getNominationForUser(tableName(kind))[dialect],
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
  if (!Number.isInteger(gamedbGameId) || gamedbGameId <= 0) {
    throw new Error("A valid GameDB game id is required to save a nomination.");
  }

  await oraMutate(
    NominationSql.upsertNomination(tableName(kind))[dialect],
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
  const result = await oraMutate(
    NominationSql.deleteNomination(tableName(kind))[dialect],
    { roundNumber, userId },
  );
  return (result.rowsAffected ?? 0) > 0;
}

export async function listNominationsForRound(
  kind: NominationKind,
  roundNumber: number,
): Promise<INominationEntry[]> {
  return oraQuery(
    NominationSql.listNominationsForRound(tableName(kind))[dialect],
    { roundNumber },
    mapRow,
  );
}
