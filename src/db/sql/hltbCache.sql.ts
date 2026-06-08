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
    postgres: ``,
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
    postgres: ``,
  } satisfies SqlEntry,
};
