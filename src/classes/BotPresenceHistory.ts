import { dbQuery, dbMutate } from "../db/SqlManager.js";
import { BotPresenceHistorySql } from "../db/sql/index.js";
import { isPositiveInt } from "../utilities/ValidationUtils.js";

export interface IPresenceHistoryEntry {
  activityName: string;
  setAt: Date | null;
  setByUserId: string | null;
  setByUsername: string | null;
}

export default class BotPresenceHistory {
  static async savePresence(
    activityName: string,
    userId: string | null,
    username: string | null,
  ): Promise<void> {
    await dbMutate(BotPresenceHistorySql.savePresence, { activityName, userId, username });
  }

  static async getLatestPresenceActivity(): Promise<string | null> {
    const rows = await dbQuery(
      BotPresenceHistorySql.getLatest,
      {},
      (row: { ACTIVITY_NAME: string }) => row.ACTIVITY_NAME,
    );
    const activityName = rows[0] ?? null;
    if (typeof activityName === "string" && activityName.trim().length > 0) {
      return activityName;
    }
    return null;
  }

  static async getPresenceHistory(limit: number): Promise<IPresenceHistoryEntry[]> {
    const safeLimit: number = isPositiveInt(limit) ? Math.min(limit, 50) : 5;
    return dbQuery(
      BotPresenceHistorySql.getHistory,
      { limit: safeLimit },
      (row: {
        ACTIVITY_NAME: string;
        SET_AT: Date;
        SET_BY_USER_ID: string | null;
        SET_BY_USERNAME: string | null;
      }) => ({
        activityName: row.ACTIVITY_NAME,
        setAt: row.SET_AT ?? null,
        setByUserId: row.SET_BY_USER_ID ?? null,
        setByUsername: row.SET_BY_USERNAME ?? null,
      }),
    );
  }
}
