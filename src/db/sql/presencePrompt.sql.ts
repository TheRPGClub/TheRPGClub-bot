import type { ISqlEntry } from "./types.js";

export const PresencePromptHistorySql = {
  createPrompt: {
    oracle: `INSERT INTO RPG_CLUB_PRESENCE_PROMPT_HISTORY
        (PROMPT_ID, USER_ID, GAME_TITLE, GAME_TITLE_NORM, STATUS)
       VALUES (:promptId, :userId, :gameTitle, :gameTitleNorm, 'PENDING')`,
    postgres: `INSERT INTO rpg_club_presence_prompt_history
        (prompt_id, user_id, game_title, game_title_norm, status)
       VALUES (:promptId, :userId, :gameTitle, :gameTitleNorm, 'PENDING')`,
  } satisfies ISqlEntry,

  markResolved: {
    oracle: `UPDATE RPG_CLUB_PRESENCE_PROMPT_HISTORY
          SET STATUS = :status,
              RESOLVED_AT = SYSTIMESTAMP
        WHERE PROMPT_ID = :promptId`,
    postgres: `UPDATE rpg_club_presence_prompt_history
          SET status = :status,
              resolved_at = NOW()
        WHERE prompt_id = :promptId`,
  } satisfies ISqlEntry,

  getLastPromptDate: {
    oracle: `SELECT CREATED_AT
         FROM RPG_CLUB_PRESENCE_PROMPT_HISTORY
        WHERE USER_ID = :userId
          AND GAME_TITLE_NORM = :gameTitleNorm
        ORDER BY CREATED_AT DESC
        FETCH NEXT 1 ROWS ONLY`,
    postgres: `SELECT created_at
         FROM rpg_club_presence_prompt_history
        WHERE user_id = :userId
          AND game_title_norm = :gameTitleNorm
        ORDER BY created_at DESC
        LIMIT 1`,
  } satisfies ISqlEntry,

  countPendingForGame: {
    oracle: `SELECT COUNT(*) AS CNT
         FROM RPG_CLUB_PRESENCE_PROMPT_HISTORY
        WHERE USER_ID = :userId
          AND GAME_TITLE_NORM = :gameTitleNorm
          AND STATUS = 'PENDING'`,
    postgres: `SELECT COUNT(*) AS cnt
         FROM rpg_club_presence_prompt_history
        WHERE user_id = :userId
          AND game_title_norm = :gameTitleNorm
          AND status = 'PENDING'`,
  } satisfies ISqlEntry,

  countPendingForUser: {
    oracle: `SELECT COUNT(*) AS CNT
         FROM RPG_CLUB_PRESENCE_PROMPT_HISTORY
        WHERE USER_ID = :userId
          AND STATUS = 'PENDING'`,
    postgres: `SELECT COUNT(*) AS cnt
         FROM rpg_club_presence_prompt_history
        WHERE user_id = :userId
          AND status = 'PENDING'`,
  } satisfies ISqlEntry,
};

export const PresencePromptOptOutSql = {
  isOptedOutAll: {
    oracle: `SELECT COUNT(*) AS CNT
         FROM RPG_CLUB_PRESENCE_PROMPT_OPTS
        WHERE USER_ID = :userId
          AND SCOPE = 'ALL'
          AND GAME_TITLE_NORM = :token`,
    postgres: `SELECT COUNT(*) AS cnt
         FROM rpg_club_presence_prompt_opts
        WHERE user_id = :userId
          AND scope = 'ALL'
          AND game_title_norm = :token`,
  } satisfies ISqlEntry,

  isOptedOutGame: {
    oracle: `SELECT COUNT(*) AS CNT
         FROM RPG_CLUB_PRESENCE_PROMPT_OPTS
        WHERE USER_ID = :userId
          AND SCOPE = 'GAME'
          AND GAME_TITLE_NORM = :gameTitleNorm`,
    postgres: `SELECT COUNT(*) AS cnt
         FROM rpg_club_presence_prompt_opts
        WHERE user_id = :userId
          AND scope = 'GAME'
          AND game_title_norm = :gameTitleNorm`,
  } satisfies ISqlEntry,

  insertOptOut: {
    oracle: `INSERT INTO RPG_CLUB_PRESENCE_PROMPT_OPTS
          (USER_ID, SCOPE, GAME_TITLE, GAME_TITLE_NORM)
         VALUES (:userId, :scope, :gameTitle, :gameTitleNorm)`,
    postgres: `INSERT INTO rpg_club_presence_prompt_opts
          (user_id, scope, game_title, game_title_norm)
         VALUES (:userId, :scope, :gameTitle, :gameTitleNorm)`,
  } satisfies ISqlEntry,
};
