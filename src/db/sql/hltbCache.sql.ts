import type { ISqlEntry } from "./types.js";

export const HltbCacheSql = {
  getByGameId: {
    postgres: `SELECT gamedb_game_id,
            hltb_name,
            hltb_url,
            hltb_image_url,
            main,
            main_sides,
            completionist,
            single_player,
            co_op,
            vs,
            source_query,
            scraped_at,
            updated_at
       FROM rpg_club_hltb_cache
      WHERE gamedb_game_id = :gameId`,
  } satisfies ISqlEntry,

  upsertCache: {
    postgres: `INSERT INTO rpg_club_hltb_cache (
         gamedb_game_id,
         hltb_name,
         hltb_url,
         hltb_image_url,
         main,
         main_sides,
         completionist,
         single_player,
         co_op,
         vs,
         source_query,
         scraped_at,
         updated_at
       ) VALUES (
         :gameId,
         :name,
         :url,
         :imageUrl,
         :main,
         :mainSides,
         :completionist,
         :singlePlayer,
         :coOp,
         :vs,
         :sourceQuery,
         NOW(),
         NOW()
       )
       ON CONFLICT (gamedb_game_id) DO UPDATE SET
         hltb_name = EXCLUDED.hltb_name,
         hltb_url = EXCLUDED.hltb_url,
         hltb_image_url = EXCLUDED.hltb_image_url,
         main = EXCLUDED.main,
         main_sides = EXCLUDED.main_sides,
         completionist = EXCLUDED.completionist,
         single_player = EXCLUDED.single_player,
         co_op = EXCLUDED.co_op,
         vs = EXCLUDED.vs,
         source_query = EXCLUDED.source_query,
         scraped_at = NOW(),
         updated_at = NOW()`,
  } satisfies ISqlEntry,
};
