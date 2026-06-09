import type { ISqlEntry } from "./types.js";

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
      postgres: `SELECT n.nomination_id,
            n.round_number,
            n.user_id,
            n.gamedb_game_id,
            g.title AS gamedb_title,
            n.nominated_at,
            n.reason
       FROM ${table.toLowerCase()} n
       LEFT JOIN gamedb_games g ON g.game_id = n.gamedb_game_id
      WHERE n.round_number = :roundNumber
        AND n.user_id = :userId`,
    }) satisfies ISqlEntry,

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
      postgres: `INSERT INTO ${table.toLowerCase()} (round_number, user_id, gamedb_game_id, nominated_at, reason)
      VALUES (:roundNumber, :userId, :gamedbGameId, :nominatedAt, :reason)
      ON CONFLICT (round_number, user_id) DO UPDATE SET
        gamedb_game_id = EXCLUDED.gamedb_game_id,
        nominated_at = EXCLUDED.nominated_at,
        reason = EXCLUDED.reason`,
    }) satisfies ISqlEntry,

  deleteNomination: (table: string) =>
    ({
      oracle: `DELETE FROM ${table}
      WHERE ROUND_NUMBER = :roundNumber
        AND USER_ID = :userId`,
      postgres: `DELETE FROM ${table.toLowerCase()}
      WHERE round_number = :roundNumber
        AND user_id = :userId`,
    }) satisfies ISqlEntry,

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
      postgres: `SELECT n.nomination_id,
            n.round_number,
            n.user_id,
            n.gamedb_game_id,
            g.title AS gamedb_title,
            n.nominated_at,
            n.reason
       FROM ${table.toLowerCase()} n
       LEFT JOIN gamedb_games g ON g.game_id = n.gamedb_game_id
      WHERE n.round_number = :roundNumber
      ORDER BY g.title ASC`,
    }) satisfies ISqlEntry,
};
