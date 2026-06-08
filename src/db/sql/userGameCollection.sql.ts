import type { SqlEntry } from "./types.js";

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
    postgres: ``,
  } satisfies SqlEntry,

  getEntryById: {
    oracle: `${ENTRY_SELECT_SQL}
     WHERE c.ENTRY_ID = :entryId
       AND c.USER_ID = :userId`,
    postgres: ``,
  } satisfies SqlEntry,

  getEntryForUser: {
    oracle: `${ENTRY_SELECT_SQL}
       WHERE c.ENTRY_ID = :entryId
         AND c.USER_ID = :userId`,
    postgres: ``,
  } satisfies SqlEntry,

  updateEntry: (updateParts: string[]) =>
    ({
      oracle: `UPDATE USER_GAME_COLLECTIONS
              SET ${updateParts.join(", ")}
            WHERE ENTRY_ID = :entryId
              AND USER_ID = :userId`,
      postgres: ``,
    }) satisfies SqlEntry,

  removeEntry: {
    oracle: `DELETE FROM USER_GAME_COLLECTIONS
        WHERE ENTRY_ID = :entryId
          AND USER_ID = :userId`,
    postgres: ``,
  } satisfies SqlEntry,

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
      postgres: ``,
    }) satisfies SqlEntry,

  getTotalCount: {
    oracle: `SELECT COUNT(*) AS TOTAL_COUNT
           FROM USER_GAME_COLLECTIONS
          WHERE USER_ID = :userId`,
    postgres: ``,
  } satisfies SqlEntry,

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
    postgres: ``,
  } satisfies SqlEntry,

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
    postgres: ``,
  } satisfies SqlEntry,

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
    postgres: ``,
  } satisfies SqlEntry,

  getTotalAllCount: {
    oracle: `SELECT COUNT(*) AS TOTAL_COUNT FROM USER_GAME_COLLECTIONS`,
    postgres: ``,
  } satisfies SqlEntry,

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
      postgres: ``,
    }) satisfies SqlEntry,
};
