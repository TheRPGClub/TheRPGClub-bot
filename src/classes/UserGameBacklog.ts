import { apiGet, apiPost, apiPatch, apiDelete } from "../services/RpgClubApiClient.js";
import Game from "./Game.js";
import { isPositiveInt, requirePositiveInt } from "../utilities/ValidationUtils.js";

export interface IUserGameBacklogEntry {
  entryId: number;
  userId: string;
  gameId: number;
  title: string;
  platformId: number | null;
  platformName: string | null;
  platformAbbreviation: string | null;
  sortOrder: number | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type BacklogApiData = {
  entry_id: number;
  user_id: string;
  gamedb_game_id: number;
  platform_id: number | null;
  sort_order: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

type BacklogSingleResponse = { data: BacklogApiData };
type BacklogListResponse = {
  data: BacklogApiData[];
  meta: { page: number; pages: number; count: number; per: number };
};

async function mapEntries(rawEntries: BacklogApiData[]): Promise<IUserGameBacklogEntry[]> {
  if (!rawEntries.length) return [];

  const gameIds = Array.from(new Set(rawEntries.map((e) => Number(e.gamedb_game_id))));
  const games = await Game.getGamesByIds(gameIds);
  const gameMap = new Map(games.map((g) => [g.id, g]));

  const uniquePlatformIds = Array.from(
    new Set(
      rawEntries
        .filter((e) => e.platform_id != null)
        .map((e) => Number(e.platform_id)),
    ),
  );
  const platformResults = await Promise.all(
    uniquePlatformIds.map((id) => Game.getPlatformById(id)),
  );
  const platformMap = new Map(
    uniquePlatformIds.map((id, idx) => [id, platformResults[idx]]),
  );

  return rawEntries.map((raw) => {
    const game = gameMap.get(Number(raw.gamedb_game_id));
    const platform = raw.platform_id != null
      ? platformMap.get(Number(raw.platform_id))
      : null;
    return {
      entryId: Number(raw.entry_id),
      userId: raw.user_id,
      gameId: Number(raw.gamedb_game_id),
      title: game?.title ?? `Game #${raw.gamedb_game_id}`,
      platformId: raw.platform_id != null ? Number(raw.platform_id) : null,
      platformName: platform?.name ?? null,
      platformAbbreviation: platform?.abbreviation ?? null,
      sortOrder: raw.sort_order != null ? Number(raw.sort_order) : null,
      note: raw.note ?? null,
      createdAt: new Date(raw.created_at),
      updatedAt: new Date(raw.updated_at),
    };
  });
}

export default class UserGameBacklog {
  static async addEntry(params: {
    userId: string;
    gameId: number;
    platformId?: number | null;
    note?: string | null;
    sortOrder?: number | null;
  }): Promise<IUserGameBacklogEntry> {
    const { userId, gameId, platformId } = params;
    requirePositiveInt(gameId, "GameDB id");
    if (platformId != null && !isPositiveInt(platformId)) {
      throw new Error("Invalid platform id.");
    }
    const note = params.note?.trim() ? params.note.trim() : null;
    if (note && note.length > 500) {
      throw new Error("note must be 500 characters or fewer.");
    }

    let response: BacklogSingleResponse | null;
    try {
      response = await apiPost<BacklogSingleResponse>(
        `/api/v1/users/${userId}/backlog`,
        {
          data: {
            gamedb_game_id: gameId,
            platform_id: platformId ?? null,
            note,
            sort_order: params.sortOrder ?? null,
          },
        },
      );
    } catch (err: any) {
      const msg = String(err?.response?.data?.error ?? err?.message ?? "");
      if (/unique|duplicate|already been taken/i.test(msg)) {
        throw new Error("That game is already in your backlog.");
      }
      throw err;
    }

    if (!response) throw new Error("Failed to create backlog entry.");
    const entries = await mapEntries([response.data]);
    return entries[0]!;
  }

  static async getEntryForUser(
    entryId: number,
    userId: string,
  ): Promise<IUserGameBacklogEntry | null> {
    requirePositiveInt(entryId, "entry id");
    const response = await apiGet<BacklogSingleResponse>(`/api/v1/backlog/${entryId}`);
    if (!response) return null;
    if (response.data.user_id !== userId) return null;
    const entries = await mapEntries([response.data]);
    return entries[0] ?? null;
  }

  static async listForUser(
    userId: string,
    limit = 200,
  ): Promise<IUserGameBacklogEntry[]> {
    const response = await apiGet<BacklogListResponse>(
      `/api/v1/users/${userId}/backlog`,
      { params: { limit } },
    );
    return mapEntries(response?.data ?? []);
  }

  static async updateEntryForUser(
    entryId: number,
    userId: string,
    updates: {
      platformId?: number | null;
      note?: string | null;
      sortOrder?: number | null;
    },
  ): Promise<IUserGameBacklogEntry | null> {
    requirePositiveInt(entryId, "entry id");

    const body: Record<string, string | number | null | undefined> = {};

    if (updates.platformId !== undefined) {
      if (updates.platformId != null && !isPositiveInt(updates.platformId)) {
        throw new Error("Invalid platform id.");
      }
      body.platform_id = updates.platformId;
    }

    if (updates.note !== undefined) {
      const note = updates.note?.trim() ? updates.note.trim() : null;
      if (note && note.length > 500) {
        throw new Error("note must be 500 characters or fewer.");
      }
      body.note = note;
    }

    if (updates.sortOrder !== undefined) {
      body.sort_order = updates.sortOrder;
    }

    if (!Object.keys(body).length) {
      throw new Error("No backlog fields were provided to update.");
    }

    const existing = await apiGet<BacklogSingleResponse>(`/api/v1/backlog/${entryId}`);
    if (!existing || existing.data.user_id !== userId) return null;

    let response: BacklogSingleResponse | null;
    try {
      response = await apiPatch<BacklogSingleResponse>(`/api/v1/backlog/${entryId}`, {
        data: body,
      });
    } catch (err: any) {
      const msg = String(err?.response?.data?.error ?? err?.message ?? "");
      if (/unique|duplicate|already been taken/i.test(msg)) {
        throw new Error("That game/platform entry already exists in your backlog.");
      }
      throw err;
    }

    if (!response) return null;
    const entries = await mapEntries([response.data]);
    return entries[0] ?? null;
  }

  static async removeEntryForUser(entryId: number, userId: string): Promise<boolean> {
    requirePositiveInt(entryId, "entry id");
    const existing = await apiGet<BacklogSingleResponse>(`/api/v1/backlog/${entryId}`);
    if (!existing || existing.data.user_id !== userId) return false;
    const result = await apiDelete<{ deleted: boolean }>(`/api/v1/backlog/${entryId}`);
    return result?.deleted === true;
  }
}
