import type { ISqlEntry } from "./types.js";

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
    postgres: `INSERT INTO rpg_club_gotm_audit_imports (
         user_id, status, current_index, total_count, source_filename
       ) VALUES (
         :userId, 'ACTIVE', 0, :totalCount, :sourceFilename
       ) RETURNING import_id`,
  } satisfies ISqlEntry,

  insertItems: {
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
  } satisfies ISqlEntry,

  getById: {
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
       FROM rpg_club_gotm_audit_imports
      WHERE user_id = :userId
        AND status IN ('ACTIVE', 'PAUSED')
      ORDER BY import_id DESC`,
  } satisfies ISqlEntry,

  setStatus: {
    postgres: `UPDATE rpg_club_gotm_audit_imports
        SET status = :status
      WHERE import_id = :importId`,
  } satisfies ISqlEntry,

  updateIndex: {
    postgres: `UPDATE rpg_club_gotm_audit_imports
        SET current_index = :currentIndex
      WHERE import_id = :importId`,
  } satisfies ISqlEntry,

  getNextPendingItem: {
    postgres: `SELECT ${ITEM_COLS_PG}
       FROM rpg_club_gotm_audit_items
      WHERE import_id = :importId
        AND status = 'PENDING'
      ORDER BY row_index
      LIMIT 1`,
  } satisfies ISqlEntry,

  getItemById: {
    postgres: `SELECT ${ITEM_COLS_PG}
       FROM rpg_club_gotm_audit_items
      WHERE item_id = :itemId`,
  } satisfies ISqlEntry,

  // Caller must pass lowercase column=value expressions for Postgres (e.g. "status = :status")
  updateItem: (fields: string[]) =>
    ({
      postgres: `UPDATE rpg_club_gotm_audit_items
        SET ${fields.join(", ")}
      WHERE item_id = :itemId`,
    }) satisfies ISqlEntry,

  getItemsForRound: {
    postgres: `SELECT ${ITEM_COLS_PG}
       FROM rpg_club_gotm_audit_items
      WHERE import_id = :importId
        AND kind = :kind
        AND round_number = :roundNumber
      ORDER BY game_index`,
  } satisfies ISqlEntry,

  countItems: {
    postgres: `SELECT status, COUNT(*) AS cnt
       FROM rpg_club_gotm_audit_items
      WHERE import_id = :importId
      GROUP BY status`,
  } satisfies ISqlEntry,
};
