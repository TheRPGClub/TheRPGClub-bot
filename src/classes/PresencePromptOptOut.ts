import { apiGet, apiPatch } from "../services/RpgClubApiClient.js";

export function normalizePresenceGameTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "");
}

type PresencePromptOptGame = {
  game_title: string;
  game_title_norm: string;
  created_at: string;
};

type PresencePromptOptsData = {
  user_id: string;
  all: boolean;
  games: PresencePromptOptGame[];
};

type PresencePromptOptsResponse = { data: PresencePromptOptsData };

async function fetchOpts(userId: string): Promise<PresencePromptOptsData | null> {
  const response = await apiGet<PresencePromptOptsResponse>(
    `/api/v1/users/${userId}/presence_prompt_opts`,
  );
  return response?.data ?? null;
}

export default class PresencePromptOptOut {
  static async isOptedOutAll(userId: string): Promise<boolean> {
    const opts = await fetchOpts(userId);
    return opts?.all === true;
  }

  static async isOptedOutGame(userId: string, gameTitle: string): Promise<boolean> {
    const normalized = normalizePresenceGameTitle(gameTitle);
    if (!normalized) return false;
    const opts = await fetchOpts(userId);
    if (!opts) return false;
    return opts.games.some((g) => g.game_title_norm === normalized);
  }

  static async addOptOutAll(userId: string): Promise<void> {
    const opts = await fetchOpts(userId);
    const existingGames = (opts?.games ?? []).map((g) => g.game_title_norm);
    await apiPatch(`/api/v1/users/${userId}/presence_prompt_opts`, {
      data: { all: true, games: existingGames },
    });
  }

  static async addOptOutGame(userId: string, gameTitle: string): Promise<void> {
    const normalized = normalizePresenceGameTitle(gameTitle);
    if (!normalized) return;
    const opts = await fetchOpts(userId);
    const existingGames = (opts?.games ?? []).map((g) => g.game_title_norm);
    if (existingGames.includes(normalized)) return;
    await apiPatch(`/api/v1/users/${userId}/presence_prompt_opts`, {
      data: { all: opts?.all ?? false, games: [...existingGames, normalized] },
    });
  }
}
