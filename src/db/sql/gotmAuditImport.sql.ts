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

export const GotmAuditImportSql = {
  createSession: {
    oracle: `INSERT INTO RPG_CLUB_GOTM_AUDIT_IMPORTS (
         USER_ID, STATUS, CURRENT_INDEX, TOTAL_COUNT, SOURCE_FILENAME
       ) VALUES (
         :userId, 'ACTIVE', 0, :totalCount, :sourceFilename
       ) RETURNING IMPORT_ID INTO :id`,
    postgres: ``,
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
    postgres: ``,
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
    postgres: ``,
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
    postgres: ``,
  } satisfies SqlEntry,

  setStatus: {
    oracle: `UPDATE RPG_CLUB_GOTM_AUDIT_IMPORTS
        SET STATUS = :status
      WHERE IMPORT_ID = :importId`,
    postgres: ``,
  } satisfies SqlEntry,

  updateIndex: {
    oracle: `UPDATE RPG_CLUB_GOTM_AUDIT_IMPORTS
        SET CURRENT_INDEX = :currentIndex
      WHERE IMPORT_ID = :importId`,
    postgres: ``,
  } satisfies SqlEntry,

  getNextPendingItem: {
    oracle: `SELECT ${ITEM_COLS}
       FROM RPG_CLUB_GOTM_AUDIT_ITEMS
      WHERE IMPORT_ID = :importId
        AND STATUS = 'PENDING'
      ORDER BY ROW_INDEX
      FETCH FIRST 1 ROWS ONLY`,
    postgres: ``,
  } satisfies SqlEntry,

  getItemById: {
    oracle: `SELECT ${ITEM_COLS}
       FROM RPG_CLUB_GOTM_AUDIT_ITEMS
      WHERE ITEM_ID = :itemId`,
    postgres: ``,
  } satisfies SqlEntry,

  updateItem: (fields: string[]) =>
    ({
      oracle: `UPDATE RPG_CLUB_GOTM_AUDIT_ITEMS
        SET ${fields.join(", ")}
      WHERE ITEM_ID = :itemId`,
      postgres: ``,
    }) satisfies SqlEntry,

  getItemsForRound: {
    oracle: `SELECT ${ITEM_COLS}
       FROM RPG_CLUB_GOTM_AUDIT_ITEMS
      WHERE IMPORT_ID = :importId
        AND KIND = :kind
        AND ROUND_NUMBER = :roundNumber
      ORDER BY GAME_INDEX`,
    postgres: ``,
  } satisfies SqlEntry,

  countItems: {
    oracle: `SELECT STATUS, COUNT(*) AS CNT
       FROM RPG_CLUB_GOTM_AUDIT_ITEMS
      WHERE IMPORT_ID = :importId
      GROUP BY STATUS`,
    postgres: ``,
  } satisfies SqlEntry,
};
