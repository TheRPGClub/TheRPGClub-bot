import type { ISqlEntry } from "./types.js";

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
    postgres: `UPDATE rpg_club_collection_csv_imports
        SET status = :status
      WHERE import_id = :importId`,
  } satisfies ISqlEntry,

  updateIndex: {
    postgres: `UPDATE rpg_club_collection_csv_imports
        SET current_index = :currentIndex
      WHERE import_id = :importId`,
  } satisfies ISqlEntry,

  getItemById: {
    postgres: `SELECT ${ITEM_COLS_PG}
       FROM rpg_club_collection_csv_import_items
      WHERE item_id = :itemId`,
  } satisfies ISqlEntry,

  getNextPendingItem: {
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
      postgres: `UPDATE rpg_club_collection_csv_import_items
        SET ${setParts.join(", ")}
      WHERE item_id = :itemId`,
    }) satisfies ISqlEntry,

  countItemsByStatus: {
    postgres: `SELECT status, COUNT(*) AS total
       FROM rpg_club_collection_csv_import_items
      WHERE import_id = :importId
      GROUP BY status`,
  } satisfies ISqlEntry,

  countItemsByReason: {
    postgres: `SELECT result_reason, COUNT(*) AS total
       FROM rpg_club_collection_csv_import_items
      WHERE import_id = :importId
        AND result_reason IS NOT NULL
      GROUP BY result_reason`,
  } satisfies ISqlEntry,
};
