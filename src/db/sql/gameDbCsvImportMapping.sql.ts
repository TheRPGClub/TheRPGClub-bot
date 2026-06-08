import type { SqlEntry } from "./types.js";

export const GameDbCsvImportMappingSql = {
  getByTitleNorm: {
    oracle: `SELECT MAP_ID,
            TITLE_RAW,
            TITLE_NORM,
            GAMEDB_GAME_ID,
            STATUS,
            CREATED_BY,
            CREATED_AT,
            UPDATED_AT
       FROM RPG_CLUB_GAMEDB_IMPORT_TITLE_MAP
      WHERE TITLE_NORM = :titleNorm`,
    postgres: ``,
  } satisfies SqlEntry,

  upsert: {
    oracle: `MERGE INTO RPG_CLUB_GAMEDB_IMPORT_TITLE_MAP t
     USING (
       SELECT :titleNorm AS TITLE_NORM FROM dual
     ) s
        ON (t.TITLE_NORM = s.TITLE_NORM)
     WHEN MATCHED THEN
       UPDATE SET
         TITLE_RAW = :titleRaw,
         GAMEDB_GAME_ID = :gameDbGameId,
         STATUS = :status,
         CREATED_BY = :createdBy
     WHEN NOT MATCHED THEN
       INSERT (TITLE_RAW, TITLE_NORM, GAMEDB_GAME_ID, STATUS, CREATED_BY)
       VALUES (:titleRaw, :titleNorm, :gameDbGameId, :status, :createdBy)`,
    postgres: ``,
  } satisfies SqlEntry,
};
