import type { ISqlEntry } from "./types.js";

// addEntry, getEntryById, getEntryForUser, updateEntry, removeEntry migrated to API (issue #802).

export const UserGameCollectionSql = {
  // Caller must pass dialect-appropriate whereClause and fetchClause
  searchEntries: (whereClause: string, fetchClause: string) =>
    ({
      postgres: `SELECT c.entry_id,
              c.user_id,
              c.gamedb_game_id,
              g.title,
              c.platform_id,
              p.platform_name,
              p.platform_abbreviation,
              c.ownership_type,
              c.note,
              c.is_shared,
              c.created_at,
              c.updated_at
         FROM user_game_collections c
         JOIN gamedb_games g ON g.game_id = c.gamedb_game_id
        LEFT JOIN gamedb_platforms p ON p.platform_id = c.platform_id
        WHERE ${whereClause}
        ORDER BY LOWER(g.title), LOWER(COALESCE(p.platform_name, '')), c.entry_id
        ${fetchClause}`,
    }) satisfies ISqlEntry,

  getTotalCount: {
    postgres: `SELECT COUNT(*) AS total_count
           FROM user_game_collections
          WHERE user_id = :userId`,
  } satisfies ISqlEntry,

  getPlatformCounts: {
    postgres: `SELECT c.platform_id,
                p.platform_name,
                p.platform_abbreviation,
                COUNT(*) AS total_count
           FROM user_game_collections c
           LEFT JOIN gamedb_platforms p ON p.platform_id = c.platform_id
          WHERE c.user_id = :userId
          GROUP BY c.platform_id, p.platform_name, p.platform_abbreviation
          ORDER BY COUNT(*) DESC,
                   LOWER(COALESCE(p.platform_name, 'Unknown')),
                   c.platform_id`,
  } satisfies ISqlEntry,

  getAllPlatformCounts: {
    postgres: `SELECT c.platform_id,
                p.platform_name,
                p.platform_abbreviation,
                COUNT(*) AS total_count
           FROM user_game_collections c
           LEFT JOIN gamedb_platforms p ON p.platform_id = c.platform_id
          GROUP BY c.platform_id, p.platform_name, p.platform_abbreviation
          ORDER BY COUNT(*) DESC,
                   LOWER(COALESCE(p.platform_name, 'Unknown')),
                   c.platform_id`,
  } satisfies ISqlEntry,

  getAllUserRows: {
    postgres: `SELECT c.user_id,
                u.username,
                u.global_name,
                c.platform_id,
                p.platform_name,
                p.platform_abbreviation,
                COUNT(*) AS total_count
           FROM user_game_collections c
           LEFT JOIN rpg_club_users u ON u.user_id = c.user_id
           LEFT JOIN gamedb_platforms p ON p.platform_id = c.platform_id
          WHERE COALESCE(u.is_bot, false) = false
          GROUP BY c.user_id,
                   u.username,
                   u.global_name,
                   c.platform_id,
                   p.platform_name,
                   p.platform_abbreviation
          ORDER BY LOWER(COALESCE(u.global_name, u.username, c.user_id)),
                   c.user_id,
                   COUNT(*) DESC,
                   LOWER(COALESCE(p.platform_name, 'Unknown')),
                   c.platform_id`,
  } satisfies ISqlEntry,

  getTotalAllCount: {
    postgres: `SELECT COUNT(*) AS total_count FROM user_game_collections`,
  } satisfies ISqlEntry,

  autocompleteEntries: (titleWhere: string) =>
    ({
      postgres: `SELECT c.entry_id,
              c.user_id,
              c.gamedb_game_id,
              g.title,
              c.platform_id,
              p.platform_name,
              p.platform_abbreviation,
              c.ownership_type,
              c.note,
              c.is_shared,
              c.created_at,
              c.updated_at
         FROM user_game_collections c
         JOIN gamedb_games g ON g.game_id = c.gamedb_game_id
         LEFT JOIN gamedb_platforms p ON p.platform_id = c.platform_id
        WHERE c.user_id = :userId
          ${titleWhere}
        ORDER BY LOWER(g.title), LOWER(COALESCE(p.platform_name, '')), c.entry_id
        LIMIT :limit`,
    }) satisfies ISqlEntry,
};
