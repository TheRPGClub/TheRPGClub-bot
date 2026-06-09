import type { ISqlEntry } from "./types.js";

export const BotPresenceHistorySql = {
  savePresence: {
    oracle: `INSERT INTO BOT_PRESENCE_HISTORY
        (ACTIVITY_NAME, SET_AT, SET_BY_USER_ID, SET_BY_USERNAME)
       VALUES (:activityName, SYSTIMESTAMP, :userId, :username)`,
    postgres: `INSERT INTO bot_presence_history
        (activity_name, set_at, set_by_user_id, set_by_username)
       VALUES (:activityName, NOW(), :userId, :username)`,
  } satisfies ISqlEntry,

  getLatest: {
    oracle: `SELECT ACTIVITY_NAME
         FROM BOT_PRESENCE_HISTORY
        ORDER BY SET_AT DESC
        FETCH FIRST 1 ROWS ONLY`,
    postgres: `SELECT activity_name
         FROM bot_presence_history
        ORDER BY set_at DESC
        LIMIT 1`,
  } satisfies ISqlEntry,

  getHistory: {
    oracle: `SELECT ACTIVITY_NAME,
              SET_AT,
              SET_BY_USER_ID,
              SET_BY_USERNAME
         FROM BOT_PRESENCE_HISTORY
        ORDER BY SET_AT DESC
        FETCH FIRST :limit ROWS ONLY`,
    postgres: `SELECT activity_name,
              set_at,
              set_by_user_id,
              set_by_username
         FROM bot_presence_history
        ORDER BY set_at DESC
        LIMIT :limit`,
  } satisfies ISqlEntry,
};
