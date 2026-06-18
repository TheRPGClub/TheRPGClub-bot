import { apiPost, apiPatch, apiGet } from "../services/RpgClubApiClient.js";
import { normalizePresenceGameTitle } from "./PresencePromptOptOut.js";

export type PresencePromptStatus =
  | "PENDING"
  | "ACCEPTED"
  | "DECLINED"
  | "OPT_OUT_GAME"
  | "OPT_OUT_ALL";

type PresencePromptRecord = {
  id: number;
  prompt_id: string;
  game_title: string;
  game_title_norm: string;
  status: PresencePromptStatus;
  created_at: string;
  resolved_at: string | null;
};

type PresencePromptListResponse = {
  data: PresencePromptRecord[];
  meta: { count: number; page: number; pages: number; per: number };
};

export default class PresencePromptHistory {
  static async createPrompt(
    promptId: string,
    userId: string,
    gameTitle: string,
  ): Promise<void> {
    const normalized = normalizePresenceGameTitle(gameTitle);
    await apiPost(`/api/v1/users/${userId}/presence_prompts`, {
      data: { prompt_id: promptId, game_title: gameTitle, game_title_norm: normalized },
    });
  }

  static async markResolved(promptId: string, status: PresencePromptStatus): Promise<void> {
    await apiPatch(`/api/v1/presence_prompts/${promptId}`, {
      data: { status, resolved_at: new Date().toISOString() },
    });
  }

  static async getLastPromptDateForGame(
    userId: string,
    gameTitle: string,
  ): Promise<Date | null> {
    const normalized = normalizePresenceGameTitle(gameTitle);
    const response = await apiGet<PresencePromptListResponse>(
      `/api/v1/users/${userId}/presence_prompts`,
      { params: { game_title_norm: normalized, per: 1 } },
    );
    const first = response?.data?.[0];
    return first ? new Date(first.created_at) : null;
  }

  static async countPendingForGame(userId: string, gameTitle: string): Promise<number> {
    const normalized = normalizePresenceGameTitle(gameTitle);
    const response = await apiGet<PresencePromptListResponse>(
      `/api/v1/users/${userId}/presence_prompts`,
      { params: { game_title_norm: normalized, status: "PENDING", per: 1 } },
    );
    return response?.meta?.count ?? 0;
  }

  static async countPendingForUser(userId: string): Promise<number> {
    const response = await apiGet<PresencePromptListResponse>(
      `/api/v1/users/${userId}/presence_prompts`,
      { params: { status: "PENDING", per: 1 } },
    );
    return response?.meta?.count ?? 0;
  }
}
