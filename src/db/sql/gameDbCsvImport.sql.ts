import type { SqlEntry } from "./types.js";

const ITEM_COLS = `ITEM_ID,
            IMPORT_ID,
            ROW_INDEX,
            GAME_TITLE,
            RAW_GAME_TITLE,
            PLATFORM_NAME,
            REGION_NAME,
            INITIAL_RELEASE_DATE,
            STATUS,
            GAMEDB_GAME_ID,
            ERROR_TEXT`;

const ITEM_COLS_PG = `item_id,
            import_id,
            row_index,
            game_title,
            raw_game_title,
            platform_name,
            region_name,
            initial_release_date,
            status,
            gamedb_game_id,
            error_text`;

export const GameDbCsvImportSql = {
  createImport: {
    oracle: `INSERT INTO RPG_CLUB_GAMEDB_IMPORTS (
         USER_ID, STATUS, CURRENT_INDEX, TOTAL_COUNT, SOURCE_FILENAME
       ) VALUES (
         :userId, 'ACTIVE', 0, :totalCount, :sourceFilename
       ) RETURNING IMPORT_ID INTO :id`,
    postgres: `INSERT INTO rpg_club_gamedb_imports (
         user_id, status, current_index, total_count, source_filename
       ) VALUES (
         :userId, 'ACTIVE', 0, :totalCount, :sourceFilename
       ) RETURNING import_id`,
  } satisfies SqlEntry,

  insertItem: {
    oracle: `INSERT INTO RPG_CLUB_GAMEDB_IMPORT_ITEMS (
           IMPORT_ID,
           ROW_INDEX,
           GAME_TITLE,
           RAW_GAME_TITLE,
           PLATFORM_NAME,
           REGION_NAME,
           INITIAL_RELEASE_DATE,
           STATUS
         ) VALUES (
           :importId,
           :rowIndex,
           :gameTitle,
           :rawGameTitle,
           :platformName,
           :regionName,
           :initialReleaseDate,
           'PENDING'
         )`,
    postgres: `INSERT INTO rpg_club_gamedb_import_items (
           import_id,
           row_index,
           game_title,
           raw_game_title,
           platform_name,
           region_name,
           initial_release_date,
           status
         ) VALUES (
           :importId,
           :rowIndex,
           :gameTitle,
           :rawGameTitle,
           :platformName,
           :regionName,
           :initialReleaseDate,
           'PENDING'
         )`,
  } satisfies SqlEntry,

  getImportById: {
    oracle: `SELECT IMPORT_ID,
            USER_ID,
            STATUS,
            CURRENT_INDEX,
            TOTAL_COUNT,
            SOURCE_FILENAME,
            CREATED_AT,
            UPDATED_AT
       FROM RPG_CLUB_GAMEDB_IMPORTS
      WHERE IMPORT_ID = :id`,
    postgres: `SELECT import_id,
            user_id,
            status,
            current_index,
            total_count,
            source_filename,
            created_at,
            updated_at
       FROM rpg_club_gamedb_imports
      WHERE import_id = :id`,
  } satisfies SqlEntry,

  getActiveForUser: {
    oracle: `SELECT IMPORT_ID,
            USER_ID,
            STATUS,
            CURRENT_INDEX,
            TOTAL_COUNT,
            SOURCE_FILENAME,
            CREATED_AT,
            UPDATED_AT
       FROM RPG_CLUB_GAMEDB_IMPORTS
      WHERE USER_ID = :userId
        AND STATUS IN ('ACTIVE', 'PAUSED')
      ORDER BY CREATED_AT DESC, IMPORT_ID DESC
      FETCH FIRST 1 ROWS ONLY`,
    postgres: `SELECT import_id,
            user_id,
            status,
            current_index,
            total_count,
            source_filename,
            created_at,
            updated_at
       FROM rpg_club_gamedb_imports
      WHERE user_id = :userId
        AND status IN ('ACTIVE', 'PAUSED')
      ORDER BY created_at DESC, import_id DESC
      LIMIT 1`,
  } satisfies SqlEntry,

  setStatus: {
    oracle: `UPDATE RPG_CLUB_GAMEDB_IMPORTS
        SET STATUS = :status
      WHERE IMPORT_ID = :importId`,
    postgres: `UPDATE rpg_club_gamedb_imports
        SET status = :status
      WHERE import_id = :importId`,
  } satisfies SqlEntry,

  updateIndex: {
    oracle: `UPDATE RPG_CLUB_GAMEDB_IMPORTS
        SET CURRENT_INDEX = :currentIndex
      WHERE IMPORT_ID = :importId`,
    postgres: `UPDATE rpg_club_gamedb_imports
        SET current_index = :currentIndex
      WHERE import_id = :importId`,
  } satisfies SqlEntry,

  getNextPendingItem: {
    oracle: `SELECT ${ITEM_COLS}
       FROM RPG_CLUB_GAMEDB_IMPORT_ITEMS
      WHERE IMPORT_ID = :importId
        AND STATUS = 'PENDING'
      ORDER BY ROW_INDEX ASC
      FETCH FIRST 1 ROWS ONLY`,
    postgres: `SELECT ${ITEM_COLS_PG}
       FROM rpg_club_gamedb_import_items
      WHERE import_id = :importId
        AND status = 'PENDING'
      ORDER BY row_index ASC
      LIMIT 1`,
  } satisfies SqlEntry,

  getItemById: {
    oracle: `SELECT ${ITEM_COLS}
       FROM RPG_CLUB_GAMEDB_IMPORT_ITEMS
      WHERE ITEM_ID = :itemId`,
    postgres: `SELECT ${ITEM_COLS_PG}
       FROM rpg_club_gamedb_import_items
      WHERE item_id = :itemId`,
  } satisfies SqlEntry,

  // Caller must pass lowercase column=value expressions for Postgres (e.g. "status = :status")
  updateItem: (fields: string[]) =>
    ({
      oracle: `UPDATE RPG_CLUB_GAMEDB_IMPORT_ITEMS
        SET ${fields.join(", ")}
      WHERE ITEM_ID = :itemId`,
      postgres: `UPDATE rpg_club_gamedb_import_items
        SET ${fields.join(", ")}
      WHERE item_id = :itemId`,
    }) satisfies SqlEntry,

  countItems: {
    oracle: `SELECT STATUS, COUNT(*) AS CNT
       FROM RPG_CLUB_GAMEDB_IMPORT_ITEMS
      WHERE IMPORT_ID = :importId
      GROUP BY STATUS`,
    postgres: `SELECT status, COUNT(*) AS cnt
       FROM rpg_club_gamedb_import_items
      WHERE import_id = :importId
      GROUP BY status`,
  } satisfies SqlEntry,
};
