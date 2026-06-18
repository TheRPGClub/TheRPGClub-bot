import type { ISqlEntry } from "./types.js";

export const PresencePromptOptOutSql = {
  isOptedOutAll: {
    postgres: `SELECT COUNT(*) AS cnt
         FROM rpg_club_presence_prompt_opts
        WHERE user_id = :userId
          AND scope = 'ALL'
          AND game_title_norm = :token`,
  } satisfies ISqlEntry,

  isOptedOutGame: {
    postgres: `SELECT COUNT(*) AS cnt
         FROM rpg_club_presence_prompt_opts
        WHERE user_id = :userId
          AND scope = 'GAME'
          AND game_title_norm = :gameTitleNorm`,
  } satisfies ISqlEntry,

  insertOptOut: {
    postgres: `INSERT INTO rpg_club_presence_prompt_opts
          (user_id, scope, game_title, game_title_norm)
         VALUES (:userId, :scope, :gameTitle, :gameTitleNorm)`,
  } satisfies ISqlEntry,
};
