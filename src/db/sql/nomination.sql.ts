import type { ISqlEntry } from "./types.js";

export const NominationSql = {
  getNominationForUser: (table: string) =>
    ({
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
      postgres: `INSERT INTO ${table.toLowerCase()} (round_number, user_id, gamedb_game_id, nominated_at, reason)
      VALUES (:roundNumber, :userId, :gamedbGameId, :nominatedAt, :reason)
      ON CONFLICT (round_number, user_id) DO UPDATE SET
        gamedb_game_id = EXCLUDED.gamedb_game_id,
        nominated_at = EXCLUDED.nominated_at,
        reason = EXCLUDED.reason`,
    }) satisfies ISqlEntry,

  deleteNomination: (table: string) =>
    ({
      postgres: `DELETE FROM ${table.toLowerCase()}
      WHERE round_number = :roundNumber
        AND user_id = :userId`,
    }) satisfies ISqlEntry,

  listNominationsForRound: (table: string) =>
    ({
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
