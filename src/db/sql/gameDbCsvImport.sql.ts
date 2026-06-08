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

export const GameDbCsvImportSql = {
  createImport: {
    oracle: `INSERT INTO RPG_CLUB_GAMEDB_IMPORTS (
         USER_ID, STATUS, CURRENT_INDEX, TOTAL_COUNT, SOURCE_FILENAME
       ) VALUES (
         :userId, 'ACTIVE', 0, :totalCount, :sourceFilename
       ) RETURNING IMPORT_ID INTO :id`,
    postgres: ``,
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
    postgres: ``,
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
       FROM RPG_CLUB_GAMEDB_IMPORTS
      WHERE USER_ID = :userId
        AND STATUS IN ('ACTIVE', 'PAUSED')
      ORDER BY CREATED_AT DESC, IMPORT_ID DESC
      FETCH FIRST 1 ROWS ONLY`,
    postgres: ``,
  } satisfies SqlEntry,

  setStatus: {
    oracle: `UPDATE RPG_CLUB_GAMEDB_IMPORTS
        SET STATUS = :status
      WHERE IMPORT_ID = :importId`,
    postgres: ``,
  } satisfies SqlEntry,

  updateIndex: {
    oracle: `UPDATE RPG_CLUB_GAMEDB_IMPORTS
        SET CURRENT_INDEX = :currentIndex
      WHERE IMPORT_ID = :importId`,
    postgres: ``,
  } satisfies SqlEntry,

  getNextPendingItem: {
    oracle: `SELECT ${ITEM_COLS}
       FROM RPG_CLUB_GAMEDB_IMPORT_ITEMS
      WHERE IMPORT_ID = :importId
        AND STATUS = 'PENDING'
      ORDER BY ROW_INDEX ASC
      FETCH FIRST 1 ROWS ONLY`,
    postgres: ``,
  } satisfies SqlEntry,

  getItemById: {
    oracle: `SELECT ${ITEM_COLS}
       FROM RPG_CLUB_GAMEDB_IMPORT_ITEMS
      WHERE ITEM_ID = :itemId`,
    postgres: ``,
  } satisfies SqlEntry,

  updateItem: (fields: string[]) =>
    ({
      oracle: `UPDATE RPG_CLUB_GAMEDB_IMPORT_ITEMS
        SET ${fields.join(", ")}
      WHERE ITEM_ID = :itemId`,
      postgres: ``,
    }) satisfies SqlEntry,

  countItems: {
    oracle: `SELECT STATUS, COUNT(*) AS CNT
       FROM RPG_CLUB_GAMEDB_IMPORT_ITEMS
      WHERE IMPORT_ID = :importId
      GROUP BY STATUS`,
    postgres: ``,
  } satisfies SqlEntry,
};
