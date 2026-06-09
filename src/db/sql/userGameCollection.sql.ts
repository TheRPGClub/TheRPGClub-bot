import type { ISqlEntry } from "./types.js";

const ENTRY_SELECT_SQL = `SELECT c.ENTRY_ID,
       c.USER_ID,
       c.GAMEDB_GAME_ID,
       g.TITLE,
       c.PLATFORM_ID,
       p.PLATFORM_NAME,
       p.PLATFORM_ABBREVIATION,
       c.OWNERSHIP_TYPE,
       c.NOTE,
       c.IS_SHARED,
       c.CREATED_AT,
       c.UPDATED_AT
  FROM USER_GAME_COLLECTIONS c
  JOIN GAMEDB_GAMES g ON g.GAME_ID = c.GAMEDB_GAME_ID
  LEFT JOIN GAMEDB_PLATFORMS p ON p.PLATFORM_ID = c.PLATFORM_ID`;

const ENTRY_SELECT_SQL_PG = `SELECT c.entry_id,
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
  LEFT JOIN gamedb_platforms p ON p.platform_id = c.platform_id`;

export const UserGameCollectionSql = {
  addEntry: {
    oracle: `INSERT INTO USER_GAME_COLLECTIONS (
             USER_ID,
             GAMEDB_GAME_ID,
             PLATFORM_ID,
             OWNERSHIP_TYPE,
             NOTE,
             IS_SHARED
           ) VALUES (
             :userId,
             :gameId,
             :platformId,
             :ownershipType,
             :note,
             :isShared
           )
           RETURNING ENTRY_ID INTO :entryId`,
    postgres: `INSERT INTO user_game_collections (
             user_id,
             gamedb_game_id,
             platform_id,
             ownership_type,
             note,
             is_shared
           ) VALUES (
             :userId,
             :gameId,
             :platformId,
             :ownershipType,
             :note,
             :isShared
           )
           RETURNING entry_id`,
  } satisfies ISqlEntry,

  getEntryById: {
    oracle: `${ENTRY_SELECT_SQL}
     WHERE c.ENTRY_ID = :entryId
       AND c.USER_ID = :userId`,
    postgres: `${ENTRY_SELECT_SQL_PG}
     WHERE c.entry_id = :entryId
       AND c.user_id = :userId`,
  } satisfies ISqlEntry,

  getEntryForUser: {
    oracle: `${ENTRY_SELECT_SQL}
       WHERE c.ENTRY_ID = :entryId
         AND c.USER_ID = :userId`,
    postgres: `${ENTRY_SELECT_SQL_PG}
       WHERE c.entry_id = :entryId
         AND c.user_id = :userId`,
  } satisfies ISqlEntry,

  // Caller must pass lowercase column=value expressions for Postgres (e.g. "note = :note")
  updateEntry: (updateParts: string[]) =>
    ({
      oracle: `UPDATE USER_GAME_COLLECTIONS
              SET ${updateParts.join(", ")}
            WHERE ENTRY_ID = :entryId
              AND USER_ID = :userId`,
      postgres: `UPDATE user_game_collections
              SET ${updateParts.join(", ")}
            WHERE entry_id = :entryId
              AND user_id = :userId`,
    }) satisfies ISqlEntry,

  removeEntry: {
    oracle: `DELETE FROM USER_GAME_COLLECTIONS
        WHERE ENTRY_ID = :entryId
          AND USER_ID = :userId`,
    postgres: `DELETE FROM user_game_collections
        WHERE entry_id = :entryId
          AND user_id = :userId`,
  } satisfies ISqlEntry,

  // Caller must pass dialect-appropriate whereClause and fetchClause
  searchEntries: (whereClause: string, fetchClause: string) =>
    ({
      oracle: `SELECT c.ENTRY_ID,
              c.USER_ID,
              c.GAMEDB_GAME_ID,
              g.TITLE,
              c.PLATFORM_ID,
              p.PLATFORM_NAME,
              p.PLATFORM_ABBREVIATION,
              c.OWNERSHIP_TYPE,
              c.NOTE,
              c.IS_SHARED,
              c.CREATED_AT,
              c.UPDATED_AT
         FROM USER_GAME_COLLECTIONS c
         JOIN GAMEDB_GAMES g ON g.GAME_ID = c.GAMEDB_GAME_ID
        LEFT JOIN GAMEDB_PLATFORMS p ON p.PLATFORM_ID = c.PLATFORM_ID
        WHERE ${whereClause}
        ORDER BY LOWER(g.TITLE), LOWER(NVL(p.PLATFORM_NAME, '')), c.ENTRY_ID
        ${fetchClause}`,
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
    oracle: `SELECT COUNT(*) AS TOTAL_COUNT
           FROM USER_GAME_COLLECTIONS
          WHERE USER_ID = :userId`,
    postgres: `SELECT COUNT(*) AS total_count
           FROM user_game_collections
          WHERE user_id = :userId`,
  } satisfies ISqlEntry,

  getPlatformCounts: {
    oracle: `SELECT c.PLATFORM_ID,
                p.PLATFORM_NAME,
                p.PLATFORM_ABBREVIATION,
                COUNT(*) AS TOTAL_COUNT
           FROM USER_GAME_COLLECTIONS c
           LEFT JOIN GAMEDB_PLATFORMS p ON p.PLATFORM_ID = c.PLATFORM_ID
          WHERE c.USER_ID = :userId
          GROUP BY c.PLATFORM_ID, p.PLATFORM_NAME, p.PLATFORM_ABBREVIATION
          ORDER BY COUNT(*) DESC,
                   LOWER(NVL(p.PLATFORM_NAME, 'Unknown')),
                   c.PLATFORM_ID`,
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
    oracle: `SELECT c.PLATFORM_ID,
                p.PLATFORM_NAME,
                p.PLATFORM_ABBREVIATION,
                COUNT(*) AS TOTAL_COUNT
           FROM USER_GAME_COLLECTIONS c
           LEFT JOIN GAMEDB_PLATFORMS p ON p.PLATFORM_ID = c.PLATFORM_ID
          GROUP BY c.PLATFORM_ID, p.PLATFORM_NAME, p.PLATFORM_ABBREVIATION
          ORDER BY COUNT(*) DESC,
                   LOWER(NVL(p.PLATFORM_NAME, 'Unknown')),
                   c.PLATFORM_ID`,
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
    oracle: `SELECT c.USER_ID,
                u.USERNAME,
                u.GLOBAL_NAME,
                c.PLATFORM_ID,
                p.PLATFORM_NAME,
                p.PLATFORM_ABBREVIATION,
                COUNT(*) AS TOTAL_COUNT
           FROM USER_GAME_COLLECTIONS c
           LEFT JOIN RPG_CLUB_USERS u ON u.USER_ID = c.USER_ID
           LEFT JOIN GAMEDB_PLATFORMS p ON p.PLATFORM_ID = c.PLATFORM_ID
          WHERE NVL(u.IS_BOT, 0) = 0
          GROUP BY c.USER_ID,
                   u.USERNAME,
                   u.GLOBAL_NAME,
                   c.PLATFORM_ID,
                   p.PLATFORM_NAME,
                   p.PLATFORM_ABBREVIATION
          ORDER BY LOWER(COALESCE(u.GLOBAL_NAME, u.USERNAME, c.USER_ID)),
                   c.USER_ID,
                   COUNT(*) DESC,
                   LOWER(NVL(p.PLATFORM_NAME, 'Unknown')),
                   c.PLATFORM_ID`,
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
    oracle: `SELECT COUNT(*) AS TOTAL_COUNT FROM USER_GAME_COLLECTIONS`,
    postgres: `SELECT COUNT(*) AS total_count FROM user_game_collections`,
  } satisfies ISqlEntry,

  autocompleteEntries: (titleWhere: string) =>
    ({
      oracle: `SELECT c.ENTRY_ID,
              c.USER_ID,
              c.GAMEDB_GAME_ID,
              g.TITLE,
              c.PLATFORM_ID,
              p.PLATFORM_NAME,
              p.PLATFORM_ABBREVIATION,
              c.OWNERSHIP_TYPE,
              c.NOTE,
              c.IS_SHARED,
              c.CREATED_AT,
              c.UPDATED_AT
         FROM USER_GAME_COLLECTIONS c
         JOIN GAMEDB_GAMES g ON g.GAME_ID = c.GAMEDB_GAME_ID
         LEFT JOIN GAMEDB_PLATFORMS p ON p.PLATFORM_ID = c.PLATFORM_ID
        WHERE c.USER_ID = :userId
          ${titleWhere}
        ORDER BY LOWER(g.TITLE), LOWER(NVL(p.PLATFORM_NAME, '')), c.ENTRY_ID
        FETCH FIRST :limit ROWS ONLY`,
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
