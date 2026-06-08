import { oraQuery, oraMutate } from "../db/SqlManager.js";

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
    `SELECT n.NOMINATION_ID,
            n.ROUND_NUMBER,
            n.USER_ID,
            n.GAMEDB_GAME_ID,
            g.TITLE AS GAMEDB_TITLE,
            n.NOMINATED_AT,
            n.REASON
       FROM ${tableName(kind)} n
       LEFT JOIN GAMEDB_GAMES g ON g.GAME_ID = n.GAMEDB_GAME_ID
      WHERE n.ROUND_NUMBER = :roundNumber
        AND n.USER_ID = :userId`,
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
    `MERGE INTO ${tableName(kind)} t
      USING (
        SELECT :roundNumber AS ROUND_NUMBER,
               :userId AS USER_ID,
               :gamedbGameId AS GAMEDB_GAME_ID,
               CAST(:nominatedAt AS TIMESTAMP) AS NOMINATED_AT,
               :reason AS REASON
          FROM dual
      ) src
         ON (t.ROUND_NUMBER = src.ROUND_NUMBER AND t.USER_ID = src.USER_ID)
    WHEN MATCHED THEN
      UPDATE SET t.GAMEDB_GAME_ID = src.GAMEDB_GAME_ID,
                 t.NOMINATED_AT = src.NOMINATED_AT,
                 t.REASON = src.REASON
    WHEN NOT MATCHED THEN
      INSERT (ROUND_NUMBER, USER_ID, GAMEDB_GAME_ID, NOMINATED_AT, REASON)
      VALUES (src.ROUND_NUMBER, src.USER_ID, src.GAMEDB_GAME_ID, src.NOMINATED_AT, src.REASON)`,
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
    `DELETE FROM ${tableName(kind)}
      WHERE ROUND_NUMBER = :roundNumber
        AND USER_ID = :userId`,
    { roundNumber, userId },
  );
  return (result.rowsAffected ?? 0) > 0;
}

export async function listNominationsForRound(
  kind: NominationKind,
  roundNumber: number,
): Promise<INominationEntry[]> {
  return oraQuery(
    `SELECT n.NOMINATION_ID,
            n.ROUND_NUMBER,
            n.USER_ID,
            n.GAMEDB_GAME_ID,
            g.TITLE AS GAMEDB_TITLE,
            n.NOMINATED_AT,
            n.REASON
       FROM ${tableName(kind)} n
       LEFT JOIN GAMEDB_GAMES g ON g.GAME_ID = n.GAMEDB_GAME_ID
      WHERE n.ROUND_NUMBER = :roundNumber
      ORDER BY g.TITLE ASC`,
    { roundNumber },
    mapRow,
  );
}
