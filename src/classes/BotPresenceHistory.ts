import { apiGet, apiPost } from "../services/RpgClubApiClient.js";
import { isPositiveInt } from "../utilities/ValidationUtils.js";

export interface IPresenceHistoryEntry {
  activityName: string;
  setAt: Date | null;
  setByUserId: string | null;
  setByUsername: string | null;
}

type BotPresenceApiData = {
  activity_name: string;
  set_at: string;
  set_by_user_id: string | null;
  set_by_username: string | null;
};

type BotPresenceLatestResponse = { data: BotPresenceApiData | null };
type BotPresenceListResponse = {
  data: BotPresenceApiData[];
  meta: { page: number; pages: number; count: number; per: number };
};

export default class BotPresenceHistory {
  static async savePresence(
    activityName: string,
    userId: string | null,
    username: string | null,
  ): Promise<void> {
    await apiPost("/api/v1/bot_presence", {
      data: {
        activity_name: activityName,
        set_by_user_id: userId,
        set_by_username: username,
      },
    });
  }

  static async getLatestPresenceActivity(): Promise<string | null> {
    const response = await apiGet<BotPresenceLatestResponse>("/api/v1/bot_presence/latest");
    const activityName = response?.data?.activity_name ?? null;
    if (typeof activityName === "string" && activityName.trim().length > 0) {
      return activityName;
    }
    return null;
  }

  static async getPresenceHistory(limit: number): Promise<IPresenceHistoryEntry[]> {
    const safeLimit: number = isPositiveInt(limit) ? Math.min(limit, 50) : 5;
    const response = await apiGet<BotPresenceListResponse>(
      "/api/v1/bot_presence",
      { params: { limit: safeLimit } },
    );
    return (response?.data ?? []).map((row) => ({
      activityName: row.activity_name,
      setAt: row.set_at ? new Date(row.set_at) : null,
      setByUserId: row.set_by_user_id ?? null,
      setByUsername: row.set_by_username ?? null,
    }));
  }
}
