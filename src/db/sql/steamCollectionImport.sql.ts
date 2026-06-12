import type { ISqlEntry } from "./types.js";

const IMPORT_COLS_PG = `import_id,
       user_id,
       status,
       current_index,
       total_count,
       steam_id64,
       steam_profile_ref,
       source_profile_name,
       created_at,
       updated_at`;

const ITEM_COLS_PG = `item_id,
       import_id,
       row_index,
       steam_app_id,
       steam_app_name,
       playtime_forever_min,
       playtime_windows_min,
       playtime_mac_min,
       playtime_linux_min,
       playtime_deck_min,
       last_played_at,
       status,
       match_confidence,
       match_candidate_json,
       gamedb_game_id,
       collection_entry_id,
       result_reason,
       error_text`;

export const SteamCollectionImportSql = {
  createImport: {
    postgres: `INSERT INTO rpg_club_steam_collection_imports (
         user_id,
         status,
         current_index,
         total_count,
         steam_id64,
         steam_profile_ref,
         source_profile_name
       ) VALUES (
         :userId,
         'ACTIVE',
         0,
         :totalCount,
         :steamId64,
         :steamProfileRef,
         :sourceProfileName
       ) RETURNING import_id`,
  } satisfies ISqlEntry,

  insertItem: {
    postgres: `INSERT INTO rpg_club_steam_collection_import_items (
           import_id,
           row_index,
           steam_app_id,
           steam_app_name,
           playtime_forever_min,
           playtime_windows_min,
           playtime_mac_min,
           playtime_linux_min,
           playtime_deck_min,
           last_played_at,
           status
         ) VALUES (
           :importId,
           :rowIndex,
           :steamAppId,
           :steamAppName,
           :playtimeForeverMin,
           :playtimeWindowsMin,
           :playtimeMacMin,
           :playtimeLinuxMin,
           :playtimeDeckMin,
           :lastPlayedAt,
           'PENDING'
         )`,
  } satisfies ISqlEntry,

  getImportById: {
    postgres: `SELECT ${IMPORT_COLS_PG}
  FROM rpg_club_steam_collection_imports WHERE import_id = :importId`,
  } satisfies ISqlEntry,

  getActiveForUser: {
    postgres: `SELECT ${IMPORT_COLS_PG}
  FROM rpg_club_steam_collection_imports
     WHERE user_id = :userId
       AND status IN ('ACTIVE', 'PAUSED')
     ORDER BY created_at DESC, import_id DESC
     LIMIT 1`,
  } satisfies ISqlEntry,

  setStatus: {
    postgres: `UPDATE rpg_club_steam_collection_imports
        SET status = :status
      WHERE import_id = :importId`,
  } satisfies ISqlEntry,

  updateIndex: {
    postgres: `UPDATE rpg_club_steam_collection_imports
        SET current_index = :currentIndex
      WHERE import_id = :importId`,
  } satisfies ISqlEntry,

  getItemById: {
    postgres: `SELECT ${ITEM_COLS_PG}
  FROM rpg_club_steam_collection_import_items WHERE item_id = :itemId`,
  } satisfies ISqlEntry,

  getNextPendingItem: {
    postgres: `SELECT ${ITEM_COLS_PG}
  FROM rpg_club_steam_collection_import_items
     WHERE import_id = :importId
       AND status = 'PENDING'
     ORDER BY row_index ASC
     LIMIT 1`,
  } satisfies ISqlEntry,

  // Caller must pass lowercase column=value expressions for Postgres (e.g. "status = :status")
  updateItem: (setParts: string[]) =>
    ({
      postgres: `UPDATE rpg_club_steam_collection_import_items
        SET ${setParts.join(", ")}
      WHERE item_id = :itemId`,
    }) satisfies ISqlEntry,

  countItemsByStatus: {
    postgres: `SELECT status, COUNT(*) AS cnt
       FROM rpg_club_steam_collection_import_items
      WHERE import_id = :importId
      GROUP BY status`,
  } satisfies ISqlEntry,

  countItemsByReason: {
    postgres: `SELECT result_reason, COUNT(*) AS cnt
       FROM rpg_club_steam_collection_import_items
      WHERE import_id = :importId
        AND result_reason IS NOT NULL
      GROUP BY result_reason`,
  } satisfies ISqlEntry,

  getAppMap: {
    postgres: `SELECT map_id,
            steam_app_id,
            gamedb_game_id,
            status,
            created_by,
            created_at,
            updated_at
       FROM rpg_club_steam_app_gamedb_map
      WHERE steam_app_id = :steamAppId`,
  } satisfies ISqlEntry,

  upsertAppMap: {
    postgres: `INSERT INTO rpg_club_steam_app_gamedb_map (steam_app_id, gamedb_game_id, status, created_by)
       VALUES (:steamAppId, :gameDbGameId, :status, :createdBy)
       ON CONFLICT (steam_app_id) DO UPDATE SET
         gamedb_game_id = EXCLUDED.gamedb_game_id,
         status = EXCLUDED.status,
         created_by = EXCLUDED.created_by`,
  } satisfies ISqlEntry,

  getHistoricalMappedIds: {
    postgres: `SELECT ii.gamedb_game_id
         FROM rpg_club_steam_collection_import_items ii
         JOIN rpg_club_steam_collection_imports i ON i.import_id = ii.import_id
        WHERE ii.steam_app_id = :steamAppId
          AND ii.gamedb_game_id IS NOT NULL
          AND ii.result_reason = 'MANUAL_REMAP'
          AND (:excludeUserId IS NULL OR i.user_id <> :excludeUserId)
        GROUP BY ii.gamedb_game_id
        ORDER BY COUNT(*) DESC, MAX(ii.item_id) DESC
        LIMIT :limit`,
  } satisfies ISqlEntry,
};
