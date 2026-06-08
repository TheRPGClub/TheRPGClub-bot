import type { SqlEntry } from "./types.js";

const IMPORT_COLS = `IMPORT_ID,
       USER_ID,
       STATUS,
       CURRENT_INDEX,
       TOTAL_COUNT,
       STEAM_ID64,
       STEAM_PROFILE_REF,
       SOURCE_PROFILE_NAME,
       CREATED_AT,
       UPDATED_AT`;

const ITEM_COLS = `ITEM_ID,
       IMPORT_ID,
       ROW_INDEX,
       STEAM_APP_ID,
       STEAM_APP_NAME,
       PLAYTIME_FOREVER_MIN,
       PLAYTIME_WINDOWS_MIN,
       PLAYTIME_MAC_MIN,
       PLAYTIME_LINUX_MIN,
       PLAYTIME_DECK_MIN,
       LAST_PLAYED_AT,
       STATUS,
       MATCH_CONFIDENCE,
       MATCH_CANDIDATE_JSON,
       GAMEDB_GAME_ID,
       COLLECTION_ENTRY_ID,
       RESULT_REASON,
       ERROR_TEXT`;

export const SteamCollectionImportSql = {
  createImport: {
    oracle: `INSERT INTO RPG_CLUB_STEAM_COLLECTION_IMPORTS (
         USER_ID,
         STATUS,
         CURRENT_INDEX,
         TOTAL_COUNT,
         STEAM_ID64,
         STEAM_PROFILE_REF,
         SOURCE_PROFILE_NAME
       ) VALUES (
         :userId,
         'ACTIVE',
         0,
         :totalCount,
         :steamId64,
         :steamProfileRef,
         :sourceProfileName
       ) RETURNING IMPORT_ID INTO :id`,
    postgres: ``,
  } satisfies SqlEntry,

  insertItem: {
    oracle: `INSERT INTO RPG_CLUB_STEAM_COLLECTION_IMPORT_ITEMS (
           IMPORT_ID,
           ROW_INDEX,
           STEAM_APP_ID,
           STEAM_APP_NAME,
           PLAYTIME_FOREVER_MIN,
           PLAYTIME_WINDOWS_MIN,
           PLAYTIME_MAC_MIN,
           PLAYTIME_LINUX_MIN,
           PLAYTIME_DECK_MIN,
           LAST_PLAYED_AT,
           STATUS
         ) VALUES (
           :importId,
           :rowIndex,
           :steamAppId,
           :steamAppName,
           :playtimeForeverMin,
           :playtimeWindowsMin,
           :playtimeMacMin,
           :playtimeLinuxMin,
           :playtimeDeckMin,
           :lastPlayedAt,
           'PENDING'
         )`,
    postgres: ``,
  } satisfies SqlEntry,

  getImportById: {
    oracle: `SELECT ${IMPORT_COLS}
  FROM RPG_CLUB_STEAM_COLLECTION_IMPORTS WHERE IMPORT_ID = :importId`,
    postgres: ``,
  } satisfies SqlEntry,

  getActiveForUser: {
    oracle: `SELECT ${IMPORT_COLS}
  FROM RPG_CLUB_STEAM_COLLECTION_IMPORTS
     WHERE USER_ID = :userId
       AND STATUS IN ('ACTIVE', 'PAUSED')
     ORDER BY CREATED_AT DESC, IMPORT_ID DESC
     FETCH FIRST 1 ROWS ONLY`,
    postgres: ``,
  } satisfies SqlEntry,

  setStatus: {
    oracle: `UPDATE RPG_CLUB_STEAM_COLLECTION_IMPORTS
        SET STATUS = :status
      WHERE IMPORT_ID = :importId`,
    postgres: ``,
  } satisfies SqlEntry,

  updateIndex: {
    oracle: `UPDATE RPG_CLUB_STEAM_COLLECTION_IMPORTS
        SET CURRENT_INDEX = :currentIndex
      WHERE IMPORT_ID = :importId`,
    postgres: ``,
  } satisfies SqlEntry,

  getItemById: {
    oracle: `SELECT ${ITEM_COLS}
  FROM RPG_CLUB_STEAM_COLLECTION_IMPORT_ITEMS WHERE ITEM_ID = :itemId`,
    postgres: ``,
  } satisfies SqlEntry,

  getNextPendingItem: {
    oracle: `SELECT ${ITEM_COLS}
  FROM RPG_CLUB_STEAM_COLLECTION_IMPORT_ITEMS
     WHERE IMPORT_ID = :importId
       AND STATUS = 'PENDING'
     ORDER BY ROW_INDEX ASC
     FETCH FIRST 1 ROWS ONLY`,
    postgres: ``,
  } satisfies SqlEntry,

  updateItem: (setParts: string[]) =>
    ({
      oracle: `UPDATE RPG_CLUB_STEAM_COLLECTION_IMPORT_ITEMS
        SET ${setParts.join(", ")}
      WHERE ITEM_ID = :itemId`,
      postgres: ``,
    }) satisfies SqlEntry,

  countItemsByStatus: {
    oracle: `SELECT STATUS, COUNT(*) AS CNT
       FROM RPG_CLUB_STEAM_COLLECTION_IMPORT_ITEMS
      WHERE IMPORT_ID = :importId
      GROUP BY STATUS`,
    postgres: ``,
  } satisfies SqlEntry,

  countItemsByReason: {
    oracle: `SELECT RESULT_REASON, COUNT(*) AS CNT
       FROM RPG_CLUB_STEAM_COLLECTION_IMPORT_ITEMS
      WHERE IMPORT_ID = :importId
        AND RESULT_REASON IS NOT NULL
      GROUP BY RESULT_REASON`,
    postgres: ``,
  } satisfies SqlEntry,

  getAppMap: {
    oracle: `SELECT MAP_ID,
            STEAM_APP_ID,
            GAMEDB_GAME_ID,
            STATUS,
            CREATED_BY,
            CREATED_AT,
            UPDATED_AT
       FROM RPG_CLUB_STEAM_APP_GAMEDB_MAP
      WHERE STEAM_APP_ID = :steamAppId`,
    postgres: ``,
  } satisfies SqlEntry,

  upsertAppMap: {
    oracle: `MERGE INTO RPG_CLUB_STEAM_APP_GAMEDB_MAP m
       USING (
         SELECT :steamAppId AS steamAppId,
                :gameDbGameId AS gameDbGameId,
                :status AS status,
                :createdBy AS createdBy
           FROM dual
       ) src
          ON (m.STEAM_APP_ID = src.steamAppId)
       WHEN MATCHED THEN UPDATE SET
         m.GAMEDB_GAME_ID = src.gameDbGameId,
         m.STATUS = src.status,
         m.CREATED_BY = src.createdBy
       WHEN NOT MATCHED THEN INSERT (
         STEAM_APP_ID,
         GAMEDB_GAME_ID,
         STATUS,
         CREATED_BY
       ) VALUES (
         src.steamAppId,
         src.gameDbGameId,
         src.status,
         src.createdBy
       )`,
    postgres: ``,
  } satisfies SqlEntry,

  getHistoricalMappedIds: {
    oracle: `SELECT t.GAMEDB_GAME_ID
       FROM (
         SELECT ii.GAMEDB_GAME_ID,
                COUNT(*) AS CNT,
                MAX(ii.ITEM_ID) AS LAST_ITEM_ID
           FROM RPG_CLUB_STEAM_COLLECTION_IMPORT_ITEMS ii
           JOIN RPG_CLUB_STEAM_COLLECTION_IMPORTS i
             ON i.IMPORT_ID = ii.IMPORT_ID
          WHERE ii.STEAM_APP_ID = :steamAppId
            AND ii.GAMEDB_GAME_ID IS NOT NULL
            AND ii.RESULT_REASON = 'MANUAL_REMAP'
            AND (:excludeUserId IS NULL OR i.USER_ID <> :excludeUserId)
          GROUP BY ii.GAMEDB_GAME_ID
          ORDER BY CNT DESC, LAST_ITEM_ID DESC
       ) t
      WHERE ROWNUM <= :limit`,
    postgres: ``,
  } satisfies SqlEntry,
};
