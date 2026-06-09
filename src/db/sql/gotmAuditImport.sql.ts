import type { SqlEntry } from "./types.js";

const ITEM_COLS = `ITEM_ID,
            IMPORT_ID,
            ROW_INDEX,
            KIND,
            ROUND_NUMBER,
            MONTH_YEAR,
            GAME_INDEX,
            GAME_TITLE,
            THREAD_ID,
            REDDIT_URL,
            STATUS,
            GAMEDB_GAME_ID,
            ERROR_TEXT`;

const ITEM_COLS_PG = `item_id,
            import_id,
            row_index,
            kind,
            round_number,
            month_year,
            game_index,
            game_title,
            thread_id,
            reddit_url,
            status,
            gamedb_game_id,
            error_text`;

export const GotmAuditImportSql = {
  createSession: {
    oracle: `INSERT INTO RPG_CLUB_GOTM_AUDIT_IMPORTS (
         USER_ID, STATUS, CURRENT_INDEX, TOTAL_COUNT, SOURCE_FILENAME
       ) VALUES (
         :userId, 'ACTIVE', 0, :totalCount, :sourceFilename
       ) RETURNING IMPORT_ID INTO :id`,
    postgres: `INSERT INTO rpg_club_gotm_audit_imports (
         user_id, status, current_index, total_count, source_filename
       ) VALUES (
         :userId, 'ACTIVE', 0, :totalCount, :sourceFilename
       ) RETURNING import_id`,
  } satisfies SqlEntry,

  insertItems: {
    oracle: `INSERT INTO RPG_CLUB_GOTM_AUDIT_ITEMS (
           IMPORT_ID,
           ROW_INDEX,
           KIND,
           ROUND_NUMBER,
           MONTH_YEAR,
           GAME_INDEX,
           GAME_TITLE,
           THREAD_ID,
           REDDIT_URL,
           STATUS,
           GAMEDB_GAME_ID
         ) VALUES (
           :importId,
           :rowIndex,
           :kind,
           :roundNumber,
           :monthYear,
           :gameIndex,
           :gameTitle,
           :threadId,
           :redditUrl,
           'PENDING',
           :gameDbGameId
         )`,
    postgres: `INSERT INTO rpg_club_gotm_audit_items (
           import_id,
           row_index,
           kind,
           round_number,
           month_year,
           game_index,
           game_title,
           thread_id,
           reddit_url,
           status,
           gamedb_game_id
         ) VALUES (
           :importId,
           :rowIndex,
           :kind,
           :roundNumber,
           :monthYear,
           :gameIndex,
           :gameTitle,
           :threadId,
           :redditUrl,
           'PENDING',
           :gameDbGameId
         )`,
  } satisfies SqlEntry,

  getById: {
    oracle: `SELECT IMPORT_ID,
            USER_ID,
            STATUS,
            CURRENT_INDEX,
            TOTAL_COUNT,
            SOURCE_FILENAME,
            CREATED_AT,
            UPDATED_AT
       FROM RPG_CLUB_GOTM_AUDIT_IMPORTS
      WHERE IMPORT_ID = :id`,
    postgres: `SELECT import_id,
            user_id,
            status,
            current_index,
            total_count,
            source_filename,
            created_at,
            updated_at
       FROM rpg_club_gotm_audit_imports
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
       FROM RPG_CLUB_GOTM_AUDIT_IMPORTS
      WHERE USER_ID = :userId
        AND STATUS IN ('ACTIVE', 'PAUSED')
      ORDER BY IMPORT_ID DESC`,
    postgres: `SELECT import_id,
            user_id,
            status,
            current_index,
            total_count,
            source_filename,
            created_at,
            updated_at
       FROM rpg_club_gotm_audit_imports
      WHERE user_id = :userId
        AND status IN ('ACTIVE', 'PAUSED')
      ORDER BY import_id DESC`,
  } satisfies SqlEntry,

  setStatus: {
    oracle: `UPDATE RPG_CLUB_GOTM_AUDIT_IMPORTS
        SET STATUS = :status
      WHERE IMPORT_ID = :importId`,
    postgres: `UPDATE rpg_club_gotm_audit_imports
        SET status = :status
      WHERE import_id = :importId`,
  } satisfies SqlEntry,

  updateIndex: {
    oracle: `UPDATE RPG_CLUB_GOTM_AUDIT_IMPORTS
        SET CURRENT_INDEX = :currentIndex
      WHERE IMPORT_ID = :importId`,
    postgres: `UPDATE rpg_club_gotm_audit_imports
        SET current_index = :currentIndex
      WHERE import_id = :importId`,
  } satisfies SqlEntry,

  getNextPendingItem: {
    oracle: `SELECT ${ITEM_COLS}
       FROM RPG_CLUB_GOTM_AUDIT_ITEMS
      WHERE IMPORT_ID = :importId
        AND STATUS = 'PENDING'
      ORDER BY ROW_INDEX
      FETCH FIRST 1 ROWS ONLY`,
    postgres: `SELECT ${ITEM_COLS_PG}
       FROM rpg_club_gotm_audit_items
      WHERE import_id = :importId
        AND status = 'PENDING'
      ORDER BY row_index
      LIMIT 1`,
  } satisfies SqlEntry,

  getItemById: {
    oracle: `SELECT ${ITEM_COLS}
       FROM RPG_CLUB_GOTM_AUDIT_ITEMS
      WHERE ITEM_ID = :itemId`,
    postgres: `SELECT ${ITEM_COLS_PG}
       FROM rpg_club_gotm_audit_items
      WHERE item_id = :itemId`,
  } satisfies SqlEntry,

  // Caller must pass lowercase column=value expressions for Postgres (e.g. "status = :status")
  updateItem: (fields: string[]) =>
    ({
      oracle: `UPDATE RPG_CLUB_GOTM_AUDIT_ITEMS
        SET ${fields.join(", ")}
      WHERE ITEM_ID = :itemId`,
      postgres: `UPDATE rpg_club_gotm_audit_items
        SET ${fields.join(", ")}
      WHERE item_id = :itemId`,
    }) satisfies SqlEntry,

  getItemsForRound: {
    oracle: `SELECT ${ITEM_COLS}
       FROM RPG_CLUB_GOTM_AUDIT_ITEMS
      WHERE IMPORT_ID = :importId
        AND KIND = :kind
        AND ROUND_NUMBER = :roundNumber
      ORDER BY GAME_INDEX`,
    postgres: `SELECT ${ITEM_COLS_PG}
       FROM rpg_club_gotm_audit_items
      WHERE import_id = :importId
        AND kind = :kind
        AND round_number = :roundNumber
      ORDER BY game_index`,
  } satisfies SqlEntry,

  countItems: {
    oracle: `SELECT STATUS, COUNT(*) AS CNT
       FROM RPG_CLUB_GOTM_AUDIT_ITEMS
      WHERE IMPORT_ID = :importId
      GROUP BY STATUS`,
    postgres: `SELECT status, COUNT(*) AS cnt
       FROM rpg_club_gotm_audit_items
      WHERE import_id = :importId
      GROUP BY status`,
  } satisfies SqlEntry,
};
