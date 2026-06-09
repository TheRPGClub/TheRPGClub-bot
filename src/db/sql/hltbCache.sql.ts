import type { SqlEntry } from "./types.js";

export const HltbCacheSql = {
  getByGameId: {
    oracle: `SELECT GAMEDB_GAME_ID,
            HLTB_NAME,
            HLTB_URL,
            HLTB_IMAGE_URL,
            MAIN,
            MAIN_SIDES,
            COMPLETIONIST,
            SINGLE_PLAYER,
            CO_OP,
            VS,
            SOURCE_QUERY,
            SCRAPED_AT,
            UPDATED_AT
       FROM RPG_CLUB_HLTB_CACHE
      WHERE GAMEDB_GAME_ID = :gameId`,
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
  } satisfies SqlEntry,

  upsertCache: {
    oracle: `MERGE INTO RPG_CLUB_HLTB_CACHE t
     USING (SELECT :gameId AS GAME_ID FROM dual) s
        ON (t.GAMEDB_GAME_ID = s.GAME_ID)
     WHEN MATCHED THEN
       UPDATE SET
         HLTB_NAME = :name,
         HLTB_URL = :url,
         HLTB_IMAGE_URL = :imageUrl,
         MAIN = :main,
         MAIN_SIDES = :mainSides,
         COMPLETIONIST = :completionist,
         SINGLE_PLAYER = :singlePlayer,
         CO_OP = :coOp,
         VS = :vs,
         SOURCE_QUERY = :sourceQuery,
         SCRAPED_AT = SYSTIMESTAMP,
         UPDATED_AT = SYSTIMESTAMP
     WHEN NOT MATCHED THEN
       INSERT (
         GAMEDB_GAME_ID,
         HLTB_NAME,
         HLTB_URL,
         HLTB_IMAGE_URL,
         MAIN,
         MAIN_SIDES,
         COMPLETIONIST,
         SINGLE_PLAYER,
         CO_OP,
         VS,
         SOURCE_QUERY,
         SCRAPED_AT,
         UPDATED_AT
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
         SYSTIMESTAMP,
         SYSTIMESTAMP
       )`,
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
  } satisfies SqlEntry,
};
