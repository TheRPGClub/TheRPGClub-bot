import type { SqlEntry } from "./types.js";

export const NominationSql = {
  getNominationForUser: (table: string) =>
    ({
      oracle: `SELECT n.NOMINATION_ID,
            n.ROUND_NUMBER,
            n.USER_ID,
            n.GAMEDB_GAME_ID,
            g.TITLE AS GAMEDB_TITLE,
            n.NOMINATED_AT,
            n.REASON
       FROM ${table} n
       LEFT JOIN GAMEDB_GAMES g ON g.GAME_ID = n.GAMEDB_GAME_ID
      WHERE n.ROUND_NUMBER = :roundNumber
        AND n.USER_ID = :userId`,
      postgres: ``,
    }) satisfies SqlEntry,

  upsertNomination: (table: string) =>
    ({
      oracle: `MERGE INTO ${table} t
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
      postgres: ``,
    }) satisfies SqlEntry,

  deleteNomination: (table: string) =>
    ({
      oracle: `DELETE FROM ${table}
      WHERE ROUND_NUMBER = :roundNumber
        AND USER_ID = :userId`,
      postgres: ``,
    }) satisfies SqlEntry,

  listNominationsForRound: (table: string) =>
    ({
      oracle: `SELECT n.NOMINATION_ID,
            n.ROUND_NUMBER,
            n.USER_ID,
            n.GAMEDB_GAME_ID,
            g.TITLE AS GAMEDB_TITLE,
            n.NOMINATED_AT,
            n.REASON
       FROM ${table} n
       LEFT JOIN GAMEDB_GAMES g ON g.GAME_ID = n.GAMEDB_GAME_ID
      WHERE n.ROUND_NUMBER = :roundNumber
      ORDER BY g.TITLE ASC`,
      postgres: ``,
    }) satisfies SqlEntry,
};
