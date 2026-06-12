import type { ISqlEntry } from "./types.js";

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
    postgres: `INSERT INTO rpg_club_gamedb_imports (
         user_id, status, current_index, total_count, source_filename
       ) VALUES (
         :userId, 'ACTIVE', 0, :totalCount, :sourceFilename
       ) RETURNING import_id`,
  } satisfies ISqlEntry,

  insertItem: {
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
  } satisfies ISqlEntry,

  getImportById: {
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
  } satisfies ISqlEntry,

  getActiveForUser: {
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
  } satisfies ISqlEntry,

  setStatus: {
    postgres: `UPDATE rpg_club_gamedb_imports
        SET status = :status
      WHERE import_id = :importId`,
  } satisfies ISqlEntry,

  updateIndex: {
    postgres: `UPDATE rpg_club_gamedb_imports
        SET current_index = :currentIndex
      WHERE import_id = :importId`,
  } satisfies ISqlEntry,

  getNextPendingItem: {
    postgres: `SELECT ${ITEM_COLS_PG}
       FROM rpg_club_gamedb_import_items
      WHERE import_id = :importId
        AND status = 'PENDING'
      ORDER BY row_index ASC
      LIMIT 1`,
  } satisfies ISqlEntry,

  getItemById: {
    postgres: `SELECT ${ITEM_COLS_PG}
       FROM rpg_club_gamedb_import_items
      WHERE item_id = :itemId`,
  } satisfies ISqlEntry,

  // Caller must pass lowercase column=value expressions for Postgres (e.g. "status = :status")
  updateItem: (fields: string[]) =>
    ({
      postgres: `UPDATE rpg_club_gamedb_import_items
        SET ${fields.join(", ")}
      WHERE item_id = :itemId`,
    }) satisfies ISqlEntry,

  countItems: {
    postgres: `SELECT status, COUNT(*) AS cnt
       FROM rpg_club_gamedb_import_items
      WHERE import_id = :importId
      GROUP BY status`,
  } satisfies ISqlEntry,
};
