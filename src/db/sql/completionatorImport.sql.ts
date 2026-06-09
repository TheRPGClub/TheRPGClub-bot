import type { ISqlEntry } from "./types.js";

const ITEM_COLS = `ITEM_ID,
            IMPORT_ID,
            ROW_INDEX,
            GAME_TITLE,
            PLATFORM_NAME,
            REGION_NAME,
            SOURCE_TYPE,
            TIME_TEXT,
            COMPLETED_AT,
            COMPLETION_TYPE,
            PLAYTIME_HRS,
            STATUS,
            GAMEDB_GAME_ID,
            COMPLETION_ID,
            ERROR_TEXT`;

const ITEM_COLS_PG = `item_id,
            import_id,
            row_index,
            game_title,
            platform_name,
            region_name,
            source_type,
            time_text,
            completed_at,
            completion_type,
            playtime_hrs,
            status,
            gamedb_game_id,
            completion_id,
            error_text`;

export const CompletionatorImportSql = {
  createImport: {
    oracle: `INSERT INTO RPG_CLUB_COMPLETIONATOR_IMPORTS (
         USER_ID, STATUS, CURRENT_INDEX, TOTAL_COUNT, SOURCE_FILENAME
       ) VALUES (
         :userId, 'ACTIVE', 0, :totalCount, :sourceFilename
       ) RETURNING IMPORT_ID INTO :id`,
    postgres: `INSERT INTO rpg_club_completionator_imports (
         user_id, status, current_index, total_count, source_filename
       ) VALUES (
         :userId, 'ACTIVE', 0, :totalCount, :sourceFilename
       ) RETURNING import_id`,
  } satisfies ISqlEntry,

  insertItem: {
    oracle: `INSERT INTO RPG_CLUB_COMPLETIONATOR_IMPORT_ITEMS (
           IMPORT_ID,
           ROW_INDEX,
           GAME_TITLE,
           PLATFORM_NAME,
           REGION_NAME,
           SOURCE_TYPE,
           TIME_TEXT,
           COMPLETED_AT,
           COMPLETION_TYPE,
           PLAYTIME_HRS,
           STATUS
         ) VALUES (
           :importId,
           :rowIndex,
           :gameTitle,
           :platformName,
           :regionName,
           :sourceType,
           :timeText,
           :completedAt,
           :completionType,
           :playtimeHours,
           'PENDING'
         )`,
    postgres: `INSERT INTO rpg_club_completionator_import_items (
           import_id,
           row_index,
           game_title,
           platform_name,
           region_name,
           source_type,
           time_text,
           completed_at,
           completion_type,
           playtime_hrs,
           status
         ) VALUES (
           :importId,
           :rowIndex,
           :gameTitle,
           :platformName,
           :regionName,
           :sourceType,
           :timeText,
           :completedAt,
           :completionType,
           :playtimeHours,
           'PENDING'
         )`,
  } satisfies ISqlEntry,

  getImportById: {
    oracle: `SELECT IMPORT_ID,
            USER_ID,
            STATUS,
            CURRENT_INDEX,
            TOTAL_COUNT,
            SOURCE_FILENAME,
            CREATED_AT,
            UPDATED_AT
       FROM RPG_CLUB_COMPLETIONATOR_IMPORTS
      WHERE IMPORT_ID = :id`,
    postgres: `SELECT import_id,
            user_id,
            status,
            current_index,
            total_count,
            source_filename,
            created_at,
            updated_at
       FROM rpg_club_completionator_imports
      WHERE import_id = :id`,
  } satisfies ISqlEntry,

  getActiveForUser: {
    oracle: `SELECT IMPORT_ID,
            USER_ID,
            STATUS,
            CURRENT_INDEX,
            TOTAL_COUNT,
            SOURCE_FILENAME,
            CREATED_AT,
            UPDATED_AT
       FROM RPG_CLUB_COMPLETIONATOR_IMPORTS
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
       FROM rpg_club_completionator_imports
      WHERE user_id = :userId
        AND status IN ('ACTIVE', 'PAUSED')
      ORDER BY created_at DESC, import_id DESC
      LIMIT 1`,
  } satisfies ISqlEntry,

  setStatus: {
    oracle: `UPDATE RPG_CLUB_COMPLETIONATOR_IMPORTS
        SET STATUS = :status
      WHERE IMPORT_ID = :importId`,
    postgres: `UPDATE rpg_club_completionator_imports
        SET status = :status
      WHERE import_id = :importId`,
  } satisfies ISqlEntry,

  updateIndex: {
    oracle: `UPDATE RPG_CLUB_COMPLETIONATOR_IMPORTS
        SET CURRENT_INDEX = :currentIndex
      WHERE IMPORT_ID = :importId`,
    postgres: `UPDATE rpg_club_completionator_imports
        SET current_index = :currentIndex
      WHERE import_id = :importId`,
  } satisfies ISqlEntry,

  getItemById: {
    oracle: `SELECT ${ITEM_COLS}
       FROM RPG_CLUB_COMPLETIONATOR_IMPORT_ITEMS
      WHERE ITEM_ID = :itemId`,
    postgres: `SELECT ${ITEM_COLS_PG}
       FROM rpg_club_completionator_import_items
      WHERE item_id = :itemId`,
  } satisfies ISqlEntry,

  getNextPendingItem: {
    oracle: `SELECT ${ITEM_COLS}
       FROM RPG_CLUB_COMPLETIONATOR_IMPORT_ITEMS
      WHERE IMPORT_ID = :importId
        AND STATUS = 'PENDING'
      ORDER BY ROW_INDEX ASC
      FETCH FIRST 1 ROWS ONLY`,
    postgres: `SELECT ${ITEM_COLS_PG}
       FROM rpg_club_completionator_import_items
      WHERE import_id = :importId
        AND status = 'PENDING'
      ORDER BY row_index ASC
      LIMIT 1`,
  } satisfies ISqlEntry,

  // Caller must pass lowercase column=value expressions for Postgres (e.g. "status = :status")
  updateItem: (fields: string[]) =>
    ({
      oracle: `UPDATE RPG_CLUB_COMPLETIONATOR_IMPORT_ITEMS
        SET ${fields.join(", ")}
      WHERE ITEM_ID = :itemId`,
      postgres: `UPDATE rpg_club_completionator_import_items
        SET ${fields.join(", ")}
      WHERE item_id = :itemId`,
    }) satisfies ISqlEntry,

  countItemsByStatus: {
    oracle: `SELECT STATUS, COUNT(*) AS CNT
       FROM RPG_CLUB_COMPLETIONATOR_IMPORT_ITEMS
      WHERE IMPORT_ID = :importId
      GROUP BY STATUS`,
    postgres: `SELECT status, COUNT(*) AS cnt
       FROM rpg_club_completionator_import_items
      WHERE import_id = :importId
      GROUP BY status`,
  } satisfies ISqlEntry,
};
