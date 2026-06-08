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
    postgres: ``,
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
    postgres: ``,
  } satisfies SqlEntry,

  getImportById: {
    oracle: `SELECT ${IMPORT_COLS}
  FROM RPG_CLUB_XBOX_COLLECTION_IMPORTS WHERE IMPORT_ID = :importId`,
    postgres: ``,
  } satisfies SqlEntry,

  getActiveForUser: {
    oracle: `SELECT ${IMPORT_COLS}
  FROM RPG_CLUB_XBOX_COLLECTION_IMPORTS
     WHERE USER_ID = :userId
       AND STATUS IN ('ACTIVE', 'PAUSED')
     ORDER BY IMPORT_ID DESC`,
    postgres: ``,
  } satisfies SqlEntry,

  setStatus: {
    oracle: `UPDATE RPG_CLUB_XBOX_COLLECTION_IMPORTS
        SET STATUS = :status
      WHERE IMPORT_ID = :importId`,
    postgres: ``,
  } satisfies SqlEntry,

  updateIndex: {
    oracle: `UPDATE RPG_CLUB_XBOX_COLLECTION_IMPORTS
        SET CURRENT_INDEX = :currentIndex
      WHERE IMPORT_ID = :importId`,
    postgres: ``,
  } satisfies SqlEntry,

  getItemById: {
    oracle: `SELECT ${ITEM_COLS}
  FROM RPG_CLUB_XBOX_COLLECTION_IMPORT_ITEMS WHERE ITEM_ID = :itemId`,
    postgres: ``,
  } satisfies SqlEntry,

  getNextPendingItem: {
    oracle: `SELECT ${ITEM_COLS}
  FROM RPG_CLUB_XBOX_COLLECTION_IMPORT_ITEMS
     WHERE IMPORT_ID = :importId
       AND STATUS = 'PENDING'
     ORDER BY ROW_INDEX ASC
     FETCH FIRST 1 ROWS ONLY`,
    postgres: ``,
  } satisfies SqlEntry,

  updateItem: (fields: string[]) =>
    ({
      oracle: `UPDATE RPG_CLUB_XBOX_COLLECTION_IMPORT_ITEMS
        SET ${fields.join(", ")}
      WHERE ITEM_ID = :itemId`,
      postgres: ``,
    }) satisfies SqlEntry,

  countItemsByStatus: {
    oracle: `SELECT STATUS, COUNT(*) AS CNT
       FROM RPG_CLUB_XBOX_COLLECTION_IMPORT_ITEMS
      WHERE IMPORT_ID = :importId
      GROUP BY STATUS`,
    postgres: ``,
  } satisfies SqlEntry,

  countItemsByReason: {
    oracle: `SELECT RESULT_REASON, COUNT(*) AS CNT
       FROM RPG_CLUB_XBOX_COLLECTION_IMPORT_ITEMS
      WHERE IMPORT_ID = :importId
      GROUP BY RESULT_REASON`,
    postgres: ``,
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
    postgres: ``,
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
    postgres: ``,
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
    postgres: ``,
  } satisfies SqlEntry,
};
