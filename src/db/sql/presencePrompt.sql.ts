import type { SqlEntry } from "./types.js";

export const PresencePromptHistorySql = {
  createPrompt: {
    oracle: `INSERT INTO RPG_CLUB_PRESENCE_PROMPT_HISTORY
        (PROMPT_ID, USER_ID, GAME_TITLE, GAME_TITLE_NORM, STATUS)
       VALUES (:promptId, :userId, :gameTitle, :gameTitleNorm, 'PENDING')`,
    postgres: ``,
  } satisfies SqlEntry,

  markResolved: {
    oracle: `UPDATE RPG_CLUB_PRESENCE_PROMPT_HISTORY
          SET STATUS = :status,
              RESOLVED_AT = SYSTIMESTAMP
        WHERE PROMPT_ID = :promptId`,
    postgres: ``,
  } satisfies SqlEntry,

  getLastPromptDate: {
    oracle: `SELECT CREATED_AT
         FROM RPG_CLUB_PRESENCE_PROMPT_HISTORY
        WHERE USER_ID = :userId
          AND GAME_TITLE_NORM = :gameTitleNorm
        ORDER BY CREATED_AT DESC
        FETCH NEXT 1 ROWS ONLY`,
    postgres: ``,
  } satisfies SqlEntry,

  countPendingForGame: {
    oracle: `SELECT COUNT(*) AS CNT
         FROM RPG_CLUB_PRESENCE_PROMPT_HISTORY
        WHERE USER_ID = :userId
          AND GAME_TITLE_NORM = :gameTitleNorm
          AND STATUS = 'PENDING'`,
    postgres: ``,
  } satisfies SqlEntry,

  countPendingForUser: {
    oracle: `SELECT COUNT(*) AS CNT
         FROM RPG_CLUB_PRESENCE_PROMPT_HISTORY
        WHERE USER_ID = :userId
          AND STATUS = 'PENDING'`,
    postgres: ``,
  } satisfies SqlEntry,
};

export const PresencePromptOptOutSql = {
  isOptedOutAll: {
    oracle: `SELECT COUNT(*) AS CNT
         FROM RPG_CLUB_PRESENCE_PROMPT_OPTS
        WHERE USER_ID = :userId
          AND SCOPE = 'ALL'
          AND GAME_TITLE_NORM = :token`,
    postgres: ``,
  } satisfies SqlEntry,

  isOptedOutGame: {
    oracle: `SELECT COUNT(*) AS CNT
         FROM RPG_CLUB_PRESENCE_PROMPT_OPTS
        WHERE USER_ID = :userId
          AND SCOPE = 'GAME'
          AND GAME_TITLE_NORM = :gameTitleNorm`,
    postgres: ``,
  } satisfies SqlEntry,

  insertOptOut: {
    oracle: `INSERT INTO RPG_CLUB_PRESENCE_PROMPT_OPTS
          (USER_ID, SCOPE, GAME_TITLE, GAME_TITLE_NORM)
         VALUES (:userId, :scope, :gameTitle, :gameTitleNorm)`,
    postgres: ``,
  } satisfies SqlEntry,
};
