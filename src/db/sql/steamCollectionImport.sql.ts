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

const IMPORT_COLS_PG = `import_id,
       user_id,
       status,
       current_index,
       total_count,
       steam_id64,
       steam_profile_ref,
       source_profile_name,
       created_at,
       updated_at`;

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

const ITEM_COLS_PG = `item_id,
       import_id,
       row_index,
       steam_app_id,
       steam_app_name,
       playtime_forever_min,
       playtime_windows_min,
       playtime_mac_min,
       playtime_linux_min,
       playtime_deck_min,
       last_played_at,
       status,
       match_confidence,
       match_candidate_json,
       gamedb_game_id,
       collection_entry_id,
       result_reason,
       error_text`;

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
    postgres: `INSERT INTO rpg_club_steam_collection_imports (
         user_id,
         status,
         current_index,
         total_count,
         steam_id64,
         steam_profile_ref,
         source_profile_name
       ) VALUES (
         :userId,
         'ACTIVE',
         0,
         :totalCount,
         :steamId64,
         :steamProfileRef,
         :sourceProfileName
       ) RETURNING import_id`,
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
    postgres: `INSERT INTO rpg_club_steam_collection_import_items (
           import_id,
           row_index,
           steam_app_id,
           steam_app_name,
           playtime_forever_min,
           playtime_windows_min,
           playtime_mac_min,
           playtime_linux_min,
           playtime_deck_min,
           last_played_at,
           status
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
  } satisfies SqlEntry,

  getImportById: {
    oracle: `SELECT ${IMPORT_COLS}
  FROM RPG_CLUB_STEAM_COLLECTION_IMPORTS WHERE IMPORT_ID = :importId`,
    postgres: `SELECT ${IMPORT_COLS_PG}
  FROM rpg_club_steam_collection_imports WHERE import_id = :importId`,
  } satisfies SqlEntry,

  getActiveForUser: {
    oracle: `SELECT ${IMPORT_COLS}
  FROM RPG_CLUB_STEAM_COLLECTION_IMPORTS
     WHERE USER_ID = :userId
       AND STATUS IN ('ACTIVE', 'PAUSED')
     ORDER BY CREATED_AT DESC, IMPORT_ID DESC
     FETCH FIRST 1 ROWS ONLY`,
    postgres: `SELECT ${IMPORT_COLS_PG}
  FROM rpg_club_steam_collection_imports
     WHERE user_id = :userId
       AND status IN ('ACTIVE', 'PAUSED')
     ORDER BY created_at DESC, import_id DESC
     LIMIT 1`,
  } satisfies SqlEntry,

  setStatus: {
    oracle: `UPDATE RPG_CLUB_STEAM_COLLECTION_IMPORTS
        SET STATUS = :status
      WHERE IMPORT_ID = :importId`,
    postgres: `UPDATE rpg_club_steam_collection_imports
        SET status = :status
      WHERE import_id = :importId`,
  } satisfies SqlEntry,

  updateIndex: {
    oracle: `UPDATE RPG_CLUB_STEAM_COLLECTION_IMPORTS
        SET CURRENT_INDEX = :currentIndex
      WHERE IMPORT_ID = :importId`,
    postgres: `UPDATE rpg_club_steam_collection_imports
        SET current_index = :currentIndex
      WHERE import_id = :importId`,
  } satisfies SqlEntry,

  getItemById: {
    oracle: `SELECT ${ITEM_COLS}
  FROM RPG_CLUB_STEAM_COLLECTION_IMPORT_ITEMS WHERE ITEM_ID = :itemId`,
    postgres: `SELECT ${ITEM_COLS_PG}
  FROM rpg_club_steam_collection_import_items WHERE item_id = :itemId`,
  } satisfies SqlEntry,

  getNextPendingItem: {
    oracle: `SELECT ${ITEM_COLS}
  FROM RPG_CLUB_STEAM_COLLECTION_IMPORT_ITEMS
     WHERE IMPORT_ID = :importId
       AND STATUS = 'PENDING'
     ORDER BY ROW_INDEX ASC
     FETCH FIRST 1 ROWS ONLY`,
    postgres: `SELECT ${ITEM_COLS_PG}
  FROM rpg_club_steam_collection_import_items
     WHERE import_id = :importId
       AND status = 'PENDING'
     ORDER BY row_index ASC
     LIMIT 1`,
  } satisfies SqlEntry,

  // Caller must pass lowercase column=value expressions for Postgres (e.g. "status = :status")
  updateItem: (setParts: string[]) =>
    ({
      oracle: `UPDATE RPG_CLUB_STEAM_COLLECTION_IMPORT_ITEMS
        SET ${setParts.join(", ")}
      WHERE ITEM_ID = :itemId`,
      postgres: `UPDATE rpg_club_steam_collection_import_items
        SET ${setParts.join(", ")}
      WHERE item_id = :itemId`,
    }) satisfies SqlEntry,

  countItemsByStatus: {
    oracle: `SELECT STATUS, COUNT(*) AS CNT
       FROM RPG_CLUB_STEAM_COLLECTION_IMPORT_ITEMS
      WHERE IMPORT_ID = :importId
      GROUP BY STATUS`,
    postgres: `SELECT status, COUNT(*) AS cnt
       FROM rpg_club_steam_collection_import_items
      WHERE import_id = :importId
      GROUP BY status`,
  } satisfies SqlEntry,

  countItemsByReason: {
    oracle: `SELECT RESULT_REASON, COUNT(*) AS CNT
       FROM RPG_CLUB_STEAM_COLLECTION_IMPORT_ITEMS
      WHERE IMPORT_ID = :importId
        AND RESULT_REASON IS NOT NULL
      GROUP BY RESULT_REASON`,
    postgres: `SELECT result_reason, COUNT(*) AS cnt
       FROM rpg_club_steam_collection_import_items
      WHERE import_id = :importId
        AND result_reason IS NOT NULL
      GROUP BY result_reason`,
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
    postgres: `SELECT map_id,
            steam_app_id,
            gamedb_game_id,
            status,
            created_by,
            created_at,
            updated_at
       FROM rpg_club_steam_app_gamedb_map
      WHERE steam_app_id = :steamAppId`,
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
    postgres: `INSERT INTO rpg_club_steam_app_gamedb_map (steam_app_id, gamedb_game_id, status, created_by)
       VALUES (:steamAppId, :gameDbGameId, :status, :createdBy)
       ON CONFLICT (steam_app_id) DO UPDATE SET
         gamedb_game_id = EXCLUDED.gamedb_game_id,
         status = EXCLUDED.status,
         created_by = EXCLUDED.created_by`,
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
    postgres: `SELECT ii.gamedb_game_id
         FROM rpg_club_steam_collection_import_items ii
         JOIN rpg_club_steam_collection_imports i ON i.import_id = ii.import_id
        WHERE ii.steam_app_id = :steamAppId
          AND ii.gamedb_game_id IS NOT NULL
          AND ii.result_reason = 'MANUAL_REMAP'
          AND (:excludeUserId IS NULL OR i.user_id <> :excludeUserId)
        GROUP BY ii.gamedb_game_id
        ORDER BY COUNT(*) DESC, MAX(ii.item_id) DESC
        LIMIT :limit`,
  } satisfies SqlEntry,
};
