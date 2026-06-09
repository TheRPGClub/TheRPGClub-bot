import type { SqlEntry } from "./types.js";

const IMPORT_COLS = `IMPORT_ID,
       USER_ID,
       STATUS,
       CURRENT_INDEX,
       TOTAL_COUNT,
       XUID,
       GAMERTAG,
       SOURCE_TYPE,
       SOURCE_FILE_NAME,
       SOURCE_FILE_SIZE,
       TEMPLATE_VERSION,
       CREATED_AT,
       UPDATED_AT`;

const IMPORT_COLS_PG = `import_id,
       user_id,
       status,
       current_index,
       total_count,
       xuid,
       gamertag,
       source_type,
       source_file_name,
       source_file_size,
       template_version,
       created_at,
       updated_at`;

const ITEM_COLS = `ITEM_ID,
       IMPORT_ID,
       ROW_INDEX,
       XBOX_TITLE_ID,
       XBOX_PRODUCT_ID,
       XBOX_TITLE_NAME,
       RAW_PLATFORM,
       RAW_OWNERSHIP_TYPE,
       RAW_NOTE,
       RAW_GAMEDB_ID,
       RAW_IGDB_ID,
       PLATFORM_ID,
       OWNERSHIP_TYPE,
       NOTE,
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
       xbox_title_id,
       xbox_product_id,
       xbox_title_name,
       raw_platform,
       raw_ownership_type,
       raw_note,
       raw_gamedb_id,
       raw_igdb_id,
       platform_id,
       ownership_type,
       note,
       status,
       match_confidence,
       match_candidate_json,
       gamedb_game_id,
       collection_entry_id,
       result_reason,
       error_text`;

export const XboxCollectionImportSql = {
  createImport: {
    oracle: `INSERT INTO RPG_CLUB_XBOX_COLLECTION_IMPORTS (
         USER_ID,
         STATUS,
         CURRENT_INDEX,
         TOTAL_COUNT,
         XUID,
         GAMERTAG,
         SOURCE_TYPE,
         SOURCE_FILE_NAME,
         SOURCE_FILE_SIZE,
         TEMPLATE_VERSION
       ) VALUES (
         :userId,
         'ACTIVE',
         0,
         :totalCount,
         :xuid,
         :gamertag,
         :sourceType,
         :sourceFileName,
         :sourceFileSize,
         :templateVersion
       ) RETURNING IMPORT_ID INTO :id`,
    postgres: `INSERT INTO rpg_club_xbox_collection_imports (
         user_id,
         status,
         current_index,
         total_count,
         xuid,
         gamertag,
         source_type,
         source_file_name,
         source_file_size,
         template_version
       ) VALUES (
         :userId,
         'ACTIVE',
         0,
         :totalCount,
         :xuid,
         :gamertag,
         :sourceType,
         :sourceFileName,
         :sourceFileSize,
         :templateVersion
       ) RETURNING import_id`,
  } satisfies SqlEntry,

  insertItem: {
    oracle: `INSERT INTO RPG_CLUB_XBOX_COLLECTION_IMPORT_ITEMS (
           IMPORT_ID,
           ROW_INDEX,
           XBOX_TITLE_ID,
           XBOX_PRODUCT_ID,
           XBOX_TITLE_NAME,
           RAW_PLATFORM,
           RAW_OWNERSHIP_TYPE,
           RAW_NOTE,
           RAW_GAMEDB_ID,
           RAW_IGDB_ID,
           PLATFORM_ID,
           OWNERSHIP_TYPE,
           NOTE,
           STATUS
         ) VALUES (
           :importId,
           :rowIndex,
           :xboxTitleId,
           :xboxProductId,
           :xboxTitleName,
           :rawPlatform,
           :rawOwnershipType,
           :rawNote,
           :rawGameDbId,
           :rawIgdbId,
           :platformId,
           :ownershipType,
           :note,
           'PENDING'
         )`,
    postgres: `INSERT INTO rpg_club_xbox_collection_import_items (
           import_id,
           row_index,
           xbox_title_id,
           xbox_product_id,
           xbox_title_name,
           raw_platform,
           raw_ownership_type,
           raw_note,
           raw_gamedb_id,
           raw_igdb_id,
           platform_id,
           ownership_type,
           note,
           status
         ) VALUES (
           :importId,
           :rowIndex,
           :xboxTitleId,
           :xboxProductId,
           :xboxTitleName,
           :rawPlatform,
           :rawOwnershipType,
           :rawNote,
           :rawGameDbId,
           :rawIgdbId,
           :platformId,
           :ownershipType,
           :note,
           'PENDING'
         )`,
  } satisfies SqlEntry,

  getImportById: {
    oracle: `SELECT ${IMPORT_COLS}
  FROM RPG_CLUB_XBOX_COLLECTION_IMPORTS WHERE IMPORT_ID = :importId`,
    postgres: `SELECT ${IMPORT_COLS_PG}
  FROM rpg_club_xbox_collection_imports WHERE import_id = :importId`,
  } satisfies SqlEntry,

  getActiveForUser: {
    oracle: `SELECT ${IMPORT_COLS}
  FROM RPG_CLUB_XBOX_COLLECTION_IMPORTS
     WHERE USER_ID = :userId
       AND STATUS IN ('ACTIVE', 'PAUSED')
     ORDER BY IMPORT_ID DESC`,
    postgres: `SELECT ${IMPORT_COLS_PG}
  FROM rpg_club_xbox_collection_imports
     WHERE user_id = :userId
       AND status IN ('ACTIVE', 'PAUSED')
     ORDER BY import_id DESC`,
  } satisfies SqlEntry,

  setStatus: {
    oracle: `UPDATE RPG_CLUB_XBOX_COLLECTION_IMPORTS
        SET STATUS = :status
      WHERE IMPORT_ID = :importId`,
    postgres: `UPDATE rpg_club_xbox_collection_imports
        SET status = :status
      WHERE import_id = :importId`,
  } satisfies SqlEntry,

  updateIndex: {
    oracle: `UPDATE RPG_CLUB_XBOX_COLLECTION_IMPORTS
        SET CURRENT_INDEX = :currentIndex
      WHERE IMPORT_ID = :importId`,
    postgres: `UPDATE rpg_club_xbox_collection_imports
        SET current_index = :currentIndex
      WHERE import_id = :importId`,
  } satisfies SqlEntry,

  getItemById: {
    oracle: `SELECT ${ITEM_COLS}
  FROM RPG_CLUB_XBOX_COLLECTION_IMPORT_ITEMS WHERE ITEM_ID = :itemId`,
    postgres: `SELECT ${ITEM_COLS_PG}
  FROM rpg_club_xbox_collection_import_items WHERE item_id = :itemId`,
  } satisfies SqlEntry,

  getNextPendingItem: {
    oracle: `SELECT ${ITEM_COLS}
  FROM RPG_CLUB_XBOX_COLLECTION_IMPORT_ITEMS
     WHERE IMPORT_ID = :importId
       AND STATUS = 'PENDING'
     ORDER BY ROW_INDEX ASC
     FETCH FIRST 1 ROWS ONLY`,
    postgres: `SELECT ${ITEM_COLS_PG}
  FROM rpg_club_xbox_collection_import_items
     WHERE import_id = :importId
       AND status = 'PENDING'
     ORDER BY row_index ASC
     LIMIT 1`,
  } satisfies SqlEntry,

  // Caller must pass lowercase column=value expressions for Postgres (e.g. "status = :status")
  updateItem: (fields: string[]) =>
    ({
      oracle: `UPDATE RPG_CLUB_XBOX_COLLECTION_IMPORT_ITEMS
        SET ${fields.join(", ")}
      WHERE ITEM_ID = :itemId`,
      postgres: `UPDATE rpg_club_xbox_collection_import_items
        SET ${fields.join(", ")}
      WHERE item_id = :itemId`,
    }) satisfies SqlEntry,

  countItemsByStatus: {
    oracle: `SELECT STATUS, COUNT(*) AS CNT
       FROM RPG_CLUB_XBOX_COLLECTION_IMPORT_ITEMS
      WHERE IMPORT_ID = :importId
      GROUP BY STATUS`,
    postgres: `SELECT status, COUNT(*) AS cnt
       FROM rpg_club_xbox_collection_import_items
      WHERE import_id = :importId
      GROUP BY status`,
  } satisfies SqlEntry,

  countItemsByReason: {
    oracle: `SELECT RESULT_REASON, COUNT(*) AS CNT
       FROM RPG_CLUB_XBOX_COLLECTION_IMPORT_ITEMS
      WHERE IMPORT_ID = :importId
      GROUP BY RESULT_REASON`,
    postgres: `SELECT result_reason, COUNT(*) AS cnt
       FROM rpg_club_xbox_collection_import_items
      WHERE import_id = :importId
      GROUP BY result_reason`,
  } satisfies SqlEntry,

  getTitleMap: {
    oracle: `SELECT MAP_ID,
            XBOX_TITLE_ID,
            GAMEDB_GAME_ID,
            STATUS,
            CREATED_BY,
            CREATED_AT,
            UPDATED_AT
       FROM RPG_CLUB_XBOX_TITLE_GAMEDB_MAP
      WHERE XBOX_TITLE_ID = :xboxTitleId`,
    postgres: `SELECT map_id,
            xbox_title_id,
            gamedb_game_id,
            status,
            created_by,
            created_at,
            updated_at
       FROM rpg_club_xbox_title_gamedb_map
      WHERE xbox_title_id = :xboxTitleId`,
  } satisfies SqlEntry,

  upsertTitleMap: {
    oracle: `MERGE INTO RPG_CLUB_XBOX_TITLE_GAMEDB_MAP m
       USING (
         SELECT :xboxTitleId AS xboxTitleId,
                :gameDbGameId AS gameDbGameId,
                :status AS status,
                :createdBy AS createdBy
           FROM dual
       ) src
          ON (m.XBOX_TITLE_ID = src.xboxTitleId)
       WHEN MATCHED THEN UPDATE SET
         m.GAMEDB_GAME_ID = src.gameDbGameId,
         m.STATUS = src.status,
         m.CREATED_BY = src.createdBy
       WHEN NOT MATCHED THEN INSERT (
         XBOX_TITLE_ID,
         GAMEDB_GAME_ID,
         STATUS,
         CREATED_BY
       ) VALUES (
         src.xboxTitleId,
         src.gameDbGameId,
         src.status,
         src.createdBy
       )`,
    postgres: `INSERT INTO rpg_club_xbox_title_gamedb_map (xbox_title_id, gamedb_game_id, status, created_by)
       VALUES (:xboxTitleId, :gameDbGameId, :status, :createdBy)
       ON CONFLICT (xbox_title_id) DO UPDATE SET
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
           FROM RPG_CLUB_XBOX_COLLECTION_IMPORT_ITEMS ii
           JOIN RPG_CLUB_XBOX_COLLECTION_IMPORTS i
             ON i.IMPORT_ID = ii.IMPORT_ID
          WHERE ii.XBOX_TITLE_ID = :xboxTitleId
            AND ii.GAMEDB_GAME_ID IS NOT NULL
            AND ii.RESULT_REASON = 'MANUAL_REMAP'
            AND (:excludeUserId IS NULL OR i.USER_ID <> :excludeUserId)
          GROUP BY ii.GAMEDB_GAME_ID
          ORDER BY CNT DESC, LAST_ITEM_ID DESC
       ) t
      WHERE ROWNUM <= :limit`,
    postgres: `SELECT ii.gamedb_game_id
         FROM rpg_club_xbox_collection_import_items ii
         JOIN rpg_club_xbox_collection_imports i ON i.import_id = ii.import_id
        WHERE ii.xbox_title_id = :xboxTitleId
          AND ii.gamedb_game_id IS NOT NULL
          AND ii.result_reason = 'MANUAL_REMAP'
          AND (:excludeUserId IS NULL OR i.user_id <> :excludeUserId)
        GROUP BY ii.gamedb_game_id
        ORDER BY COUNT(*) DESC, MAX(ii.item_id) DESC
        LIMIT :limit`,
  } satisfies SqlEntry,
};
