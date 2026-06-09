import type { ISqlEntry } from "./types.js";

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

const ITEM_COLS_PG = `item_id,
            import_id,
            row_index,
            raw_title,
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
    postgres: `INSERT INTO rpg_club_collection_csv_imports (
         user_id,
         status,
         current_index,
         total_count,
         source_file_name,
         source_file_size,
         template_version
       ) VALUES (
         :userId,
         'ACTIVE',
         0,
         :totalCount,
         :sourceFileName,
         :sourceFileSize,
         :templateVersion
       ) RETURNING import_id`,
  } satisfies ISqlEntry,

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
    postgres: `INSERT INTO rpg_club_collection_csv_import_items (
           import_id,
           row_index,
           raw_title,
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
  } satisfies ISqlEntry,

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
    postgres: `SELECT import_id,
            user_id,
            status,
            current_index,
            total_count,
            source_file_name,
            source_file_size,
            template_version,
            created_at,
            updated_at
       FROM rpg_club_collection_csv_imports
      WHERE import_id = :importId`,
  } satisfies ISqlEntry,

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
    postgres: `SELECT import_id,
            user_id,
            status,
            current_index,
            total_count,
            source_file_name,
            source_file_size,
            template_version,
            created_at,
            updated_at
       FROM rpg_club_collection_csv_imports
      WHERE user_id = :userId
        AND status IN ('ACTIVE', 'PAUSED')
      ORDER BY created_at DESC, import_id DESC
      LIMIT 1`,
  } satisfies ISqlEntry,

  setStatus: {
    oracle: `UPDATE RPG_CLUB_COLLECTION_CSV_IMPORTS
        SET STATUS = :status
      WHERE IMPORT_ID = :importId`,
    postgres: `UPDATE rpg_club_collection_csv_imports
        SET status = :status
      WHERE import_id = :importId`,
  } satisfies ISqlEntry,

  updateIndex: {
    oracle: `UPDATE RPG_CLUB_COLLECTION_CSV_IMPORTS
        SET CURRENT_INDEX = :currentIndex
      WHERE IMPORT_ID = :importId`,
    postgres: `UPDATE rpg_club_collection_csv_imports
        SET current_index = :currentIndex
      WHERE import_id = :importId`,
  } satisfies ISqlEntry,

  getItemById: {
    oracle: `SELECT ${ITEM_COLS}
       FROM RPG_CLUB_COLLECTION_CSV_IMPORT_ITEMS
      WHERE ITEM_ID = :itemId`,
    postgres: `SELECT ${ITEM_COLS_PG}
       FROM rpg_club_collection_csv_import_items
      WHERE item_id = :itemId`,
  } satisfies ISqlEntry,

  getNextPendingItem: {
    oracle: `SELECT ${ITEM_COLS}
       FROM RPG_CLUB_COLLECTION_CSV_IMPORT_ITEMS
      WHERE IMPORT_ID = :importId
        AND STATUS = 'PENDING'
      ORDER BY ROW_INDEX ASC, ITEM_ID ASC
      FETCH FIRST 1 ROWS ONLY`,
    postgres: `SELECT ${ITEM_COLS_PG}
       FROM rpg_club_collection_csv_import_items
      WHERE import_id = :importId
        AND status = 'PENDING'
      ORDER BY row_index ASC, item_id ASC
      LIMIT 1`,
  } satisfies ISqlEntry,

  // Caller must pass lowercase column=value expressions for Postgres (e.g. "status = :status")
  updateItem: (setParts: string[]) =>
    ({
      oracle: `UPDATE RPG_CLUB_COLLECTION_CSV_IMPORT_ITEMS
        SET ${setParts.join(", ")}
      WHERE ITEM_ID = :itemId`,
      postgres: `UPDATE rpg_club_collection_csv_import_items
        SET ${setParts.join(", ")}
      WHERE item_id = :itemId`,
    }) satisfies ISqlEntry,

  countItemsByStatus: {
    oracle: `SELECT STATUS, COUNT(*) AS TOTAL
       FROM RPG_CLUB_COLLECTION_CSV_IMPORT_ITEMS
      WHERE IMPORT_ID = :importId
      GROUP BY STATUS`,
    postgres: `SELECT status, COUNT(*) AS total
       FROM rpg_club_collection_csv_import_items
      WHERE import_id = :importId
      GROUP BY status`,
  } satisfies ISqlEntry,

  countItemsByReason: {
    oracle: `SELECT RESULT_REASON, COUNT(*) AS TOTAL
       FROM RPG_CLUB_COLLECTION_CSV_IMPORT_ITEMS
      WHERE IMPORT_ID = :importId
        AND RESULT_REASON IS NOT NULL
      GROUP BY RESULT_REASON`,
    postgres: `SELECT result_reason, COUNT(*) AS total
       FROM rpg_club_collection_csv_import_items
      WHERE import_id = :importId
        AND result_reason IS NOT NULL
      GROUP BY result_reason`,
  } satisfies ISqlEntry,
};
