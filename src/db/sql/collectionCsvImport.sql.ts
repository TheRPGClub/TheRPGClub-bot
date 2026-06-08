import type { SqlEntry } from "./types.js";

const ITEM_COLS = `ITEM_ID,
            IMPORT_ID,
            ROW_INDEX,
            RAW_TITLE,
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

export const CollectionCsvImportSql = {
  createImport: {
    oracle: `INSERT INTO RPG_CLUB_COLLECTION_CSV_IMPORTS (
         USER_ID,
         STATUS,
         CURRENT_INDEX,
         TOTAL_COUNT,
         SOURCE_FILE_NAME,
         SOURCE_FILE_SIZE,
         TEMPLATE_VERSION
       ) VALUES (
         :userId,
         'ACTIVE',
         0,
         :totalCount,
         :sourceFileName,
         :sourceFileSize,
         :templateVersion
       ) RETURNING IMPORT_ID INTO :id`,
    postgres: ``,
  } satisfies SqlEntry,

  insertItem: {
    oracle: `INSERT INTO RPG_CLUB_COLLECTION_CSV_IMPORT_ITEMS (
           IMPORT_ID,
           ROW_INDEX,
           RAW_TITLE,
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
           :rawTitle,
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
    oracle: `SELECT IMPORT_ID,
            USER_ID,
            STATUS,
            CURRENT_INDEX,
            TOTAL_COUNT,
            SOURCE_FILE_NAME,
            SOURCE_FILE_SIZE,
            TEMPLATE_VERSION,
            CREATED_AT,
            UPDATED_AT
       FROM RPG_CLUB_COLLECTION_CSV_IMPORTS
      WHERE IMPORT_ID = :importId`,
    postgres: ``,
  } satisfies SqlEntry,

  getActiveForUser: {
    oracle: `SELECT IMPORT_ID,
            USER_ID,
            STATUS,
            CURRENT_INDEX,
            TOTAL_COUNT,
            SOURCE_FILE_NAME,
            SOURCE_FILE_SIZE,
            TEMPLATE_VERSION,
            CREATED_AT,
            UPDATED_AT
       FROM RPG_CLUB_COLLECTION_CSV_IMPORTS
      WHERE USER_ID = :userId
        AND STATUS IN ('ACTIVE', 'PAUSED')
      ORDER BY CREATED_AT DESC, IMPORT_ID DESC
      FETCH FIRST 1 ROWS ONLY`,
    postgres: ``,
  } satisfies SqlEntry,

  setStatus: {
    oracle: `UPDATE RPG_CLUB_COLLECTION_CSV_IMPORTS
        SET STATUS = :status
      WHERE IMPORT_ID = :importId`,
    postgres: ``,
  } satisfies SqlEntry,

  updateIndex: {
    oracle: `UPDATE RPG_CLUB_COLLECTION_CSV_IMPORTS
        SET CURRENT_INDEX = :currentIndex
      WHERE IMPORT_ID = :importId`,
    postgres: ``,
  } satisfies SqlEntry,

  getItemById: {
    oracle: `SELECT ${ITEM_COLS}
       FROM RPG_CLUB_COLLECTION_CSV_IMPORT_ITEMS
      WHERE ITEM_ID = :itemId`,
    postgres: ``,
  } satisfies SqlEntry,

  getNextPendingItem: {
    oracle: `SELECT ${ITEM_COLS}
       FROM RPG_CLUB_COLLECTION_CSV_IMPORT_ITEMS
      WHERE IMPORT_ID = :importId
        AND STATUS = 'PENDING'
      ORDER BY ROW_INDEX ASC, ITEM_ID ASC
      FETCH FIRST 1 ROWS ONLY`,
    postgres: ``,
  } satisfies SqlEntry,

  updateItem: (setParts: string[]) =>
    ({
      oracle: `UPDATE RPG_CLUB_COLLECTION_CSV_IMPORT_ITEMS
        SET ${setParts.join(", ")}
      WHERE ITEM_ID = :itemId`,
      postgres: ``,
    }) satisfies SqlEntry,

  countItemsByStatus: {
    oracle: `SELECT STATUS, COUNT(*) AS TOTAL
       FROM RPG_CLUB_COLLECTION_CSV_IMPORT_ITEMS
      WHERE IMPORT_ID = :importId
      GROUP BY STATUS`,
    postgres: ``,
  } satisfies SqlEntry,

  countItemsByReason: {
    oracle: `SELECT RESULT_REASON, COUNT(*) AS TOTAL
       FROM RPG_CLUB_COLLECTION_CSV_IMPORT_ITEMS
      WHERE IMPORT_ID = :importId
        AND RESULT_REASON IS NOT NULL
      GROUP BY RESULT_REASON`,
    postgres: ``,
  } satisfies SqlEntry,
};
