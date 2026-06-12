import type { ISqlEntry } from "./types.js";

export const GameDbCsvImportMappingSql = {
  getByTitleNorm: {
    postgres: `SELECT map_id,
            title_raw,
            title_norm,
            gamedb_game_id,
            status,
            created_by,
            created_at,
            updated_at
       FROM rpg_club_gamedb_import_title_map
      WHERE title_norm = :titleNorm`,
  } satisfies ISqlEntry,

  upsert: {
    postgres: `INSERT INTO rpg_club_gamedb_import_title_map (title_raw, title_norm, gamedb_game_id, status, created_by)
       VALUES (:titleRaw, :titleNorm, :gameDbGameId, :status, :createdBy)
       ON CONFLICT (title_norm) DO UPDATE SET
         title_raw = EXCLUDED.title_raw,
         gamedb_game_id = EXCLUDED.gamedb_game_id,
         status = EXCLUDED.status,
         created_by = EXCLUDED.created_by`,
  } satisfies ISqlEntry,
};
