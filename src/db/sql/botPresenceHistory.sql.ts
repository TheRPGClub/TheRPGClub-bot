import type { ISqlEntry } from "./types.js";

export const BotPresenceHistorySql = {
  savePresence: {
    postgres: `INSERT INTO bot_presence_history
        (activity_name, set_at, set_by_user_id, set_by_username)
       VALUES (:activityName, NOW(), :userId, :username)`,
  } satisfies ISqlEntry,

  getLatest: {
    postgres: `SELECT activity_name
         FROM bot_presence_history
        ORDER BY set_at DESC
        LIMIT 1`,
  } satisfies ISqlEntry,

  getHistory: {
    postgres: `SELECT activity_name,
              set_at,
              set_by_user_id,
              set_by_username
         FROM bot_presence_history
        ORDER BY set_at DESC
        LIMIT :limit`,
  } satisfies ISqlEntry,
};
