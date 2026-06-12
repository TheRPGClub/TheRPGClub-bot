import type { ISqlEntry } from "./types.js";

export const PresencePromptHistorySql = {
  createPrompt: {
    postgres: `INSERT INTO rpg_club_presence_prompt_history
        (prompt_id, user_id, game_title, game_title_norm, status)
       VALUES (:promptId, :userId, :gameTitle, :gameTitleNorm, 'PENDING')`,
  } satisfies ISqlEntry,

  markResolved: {
    postgres: `UPDATE rpg_club_presence_prompt_history
          SET status = :status,
              resolved_at = NOW()
        WHERE prompt_id = :promptId`,
  } satisfies ISqlEntry,

  getLastPromptDate: {
    postgres: `SELECT created_at
         FROM rpg_club_presence_prompt_history
        WHERE user_id = :userId
          AND game_title_norm = :gameTitleNorm
        ORDER BY created_at DESC
        LIMIT 1`,
  } satisfies ISqlEntry,

  countPendingForGame: {
    postgres: `SELECT COUNT(*) AS cnt
         FROM rpg_club_presence_prompt_history
        WHERE user_id = :userId
          AND game_title_norm = :gameTitleNorm
          AND status = 'PENDING'`,
  } satisfies ISqlEntry,

  countPendingForUser: {
    postgres: `SELECT COUNT(*) AS cnt
         FROM rpg_club_presence_prompt_history
        WHERE user_id = :userId
          AND status = 'PENDING'`,
  } satisfies ISqlEntry,
};

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
