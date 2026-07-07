import type { ISqlEntry } from "./types.js";

export const GameSql = {
  getGotmWins: {
    postgres: `SELECT ge.round_number,
                COALESCE(
                  (SELECT MIN(tgl.thread_id)
                     FROM thread_game_links tgl
                    WHERE tgl.gamedb_game_id = ge.gamedb_game_id),
                  (SELECT MIN(th.thread_id)
                     FROM threads th
                    WHERE th.gamedb_game_id = ge.gamedb_game_id)
                ) AS thread_id,
                ge.reddit_url, ge.month_year
           FROM gotm_entries ge
          WHERE ge.gamedb_game_id = :gameId
          ORDER BY ge.round_number`,
  } satisfies ISqlEntry,

  getNrGotmWins: {
    postgres: `SELECT nge.round_number,
                COALESCE(
                  (SELECT MIN(tgl.thread_id)
                     FROM thread_game_links tgl
                    WHERE tgl.gamedb_game_id = nge.gamedb_game_id),
                  (SELECT MIN(th.thread_id)
                     FROM threads th
                    WHERE th.gamedb_game_id = nge.gamedb_game_id)
                ) AS thread_id,
                nge.reddit_url, nge.month_year
           FROM nr_gotm_entries nge
          WHERE nge.gamedb_game_id = :gameId
          ORDER BY nge.round_number`,
  } satisfies ISqlEntry,

  getGotmNominations: {
    postgres: `SELECT n.round_number, n.user_id, u.username, u.global_name
           FROM gotm_nominations n
           LEFT JOIN rpg_club_users u ON u.user_id = n.user_id
          WHERE n.gamedb_game_id = :gameId
          ORDER BY n.round_number`,
  } satisfies ISqlEntry,

  getNrGotmNominations: {
    postgres: `SELECT n.round_number, n.user_id, u.username, u.global_name
           FROM nr_gotm_nominations n
           LEFT JOIN rpg_club_users u ON u.user_id = n.user_id
          WHERE n.gamedb_game_id = :gameId
          ORDER BY n.round_number`,
  } satisfies ISqlEntry,

  getGameCollectionOwners: {
    postgres: `SELECT c.user_id, u.username, u.global_name
         FROM user_game_collections c
         LEFT JOIN rpg_club_users u ON u.user_id = c.user_id
        WHERE c.gamedb_game_id = :gameId
        GROUP BY c.user_id, u.username, u.global_name
        ORDER BY LOWER(COALESCE(u.global_name, u.username, c.user_id))`,
  } satisfies ISqlEntry,
};
