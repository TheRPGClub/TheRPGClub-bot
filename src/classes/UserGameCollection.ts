import { isPositiveInt, requirePositiveInt } from "../utilities/ValidationUtils.js";
import { apiGet, apiPost, apiPatch, apiDelete } from "../services/RpgClubApiClient.js";
import Game from "./Game.js";

export const COLLECTION_OWNERSHIP_TYPES = [
  "Digital",
  "Physical",
  "Subscription",
  "Other",
] as const;

export type CollectionOwnershipType = (typeof COLLECTION_OWNERSHIP_TYPES)[number];

export interface IUserGameCollectionEntry {
  entryId: number;
  userId: string;
  gameId: number;
  title: string;
  platformId: number | null;
  platformName: string | null;
  platformAbbreviation: string | null;
  ownershipType: CollectionOwnershipType;
  note: string | null;
  isShared: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserGameCollectionAutocompleteEntry {
  entryId: number;
  gameId: number;
  title: string;
  platformName: string | null;
  ownershipType: CollectionOwnershipType;
}

export interface IUserGameCollectionOverviewEntry {
  platformId: number | null;
  platformName: string | null;
  platformAbbreviation: string | null;
  total: number;
}

function normalizeOwnershipType(value: string): CollectionOwnershipType {
  const trimmed = value.trim();
  const match = COLLECTION_OWNERSHIP_TYPES.find((item) =>
    item.toLowerCase() === trimmed.toLowerCase(),
  );
  if (!match) {
    throw new Error("Ownership type must be Digital, Physical, Subscription, or Other.");
  }
  return match;
}

// --- API types ---
// List items (CollectionEntry) omit is_shared/timestamps; detail/create/patch
// responses (CollectionEntryDetail) include them. Both carry the joined platform
// name/abbreviation.

type CollectionApiData = {
  entry_id: number;
  user_id: string;
  gamedb_game_id: number;
  platform_id: number | null;
  ownership_type: string;
  note: string | null;
  platform_name?: string | null;
  platform_abbreviation?: string | null;
  is_shared?: boolean | number;
  created_at?: string;
  updated_at?: string;
};

type CollectionResponse = { data: CollectionApiData };

type PlatformCountApiData = {
  platform_id: number | null;
  platform_name: string | null;
  platform_abbreviation: string | null;
  count: number;
};

type PlatformSummaryResponse = {
  data: { total_count: number; platform_counts: PlatformCountApiData[] };
};

function mapApiEntry(raw: CollectionApiData, title: string): IUserGameCollectionEntry {
  return {
    entryId: Number(raw.entry_id),
    userId: raw.user_id,
    gameId: Number(raw.gamedb_game_id),
    title,
    platformId: raw.platform_id != null ? Number(raw.platform_id) : null,
    platformName: raw.platform_name ?? null,
    platformAbbreviation: raw.platform_abbreviation ?? null,
    ownershipType: normalizeOwnershipType(raw.ownership_type),
    note: raw.note ?? null,
    isShared: Boolean(raw.is_shared),
    createdAt: raw.created_at ? new Date(raw.created_at) : new Date(0),
    updatedAt: raw.updated_at ? new Date(raw.updated_at) : new Date(0),
  };
}

function mapPlatformCount(raw: PlatformCountApiData): IUserGameCollectionOverviewEntry {
  return {
    platformId: raw.platform_id == null ? null : Number(raw.platform_id),
    platformName: raw.platform_name ?? null,
    platformAbbreviation: raw.platform_abbreviation ?? null,
    total: Number(raw.count ?? 0),
  };
}

async function enrichEntry(raw: CollectionApiData): Promise<IUserGameCollectionEntry> {
  const game = await Game.getGameById(raw.gamedb_game_id);
  return mapApiEntry(raw, game?.title ?? `Game #${raw.gamedb_game_id}`);
}

export default class UserGameCollection {
  private static async fetchAllPages<T>(
    path: string,
    params: Record<string, unknown> = {},
  ): Promise<T[]> {
    const results: T[] = [];
    let page = 1;
    for (;;) {
      const result = await apiGet<{ data: T[]; meta: { next: number | null } }>(
        path,
        { params: { ...params, page, per: 500 } },
      );
      if (!result?.data?.length) break;
      results.push(...result.data);
      if (!result.meta?.next) break;
      page++;
    }
    return results;
  }

  private static async fetchTitles(
    rows: Array<{ gamedb_game_id: number }>,
  ): Promise<Map<number, string>> {
    const ids = Array.from(new Set(rows.map((row) => Number(row.gamedb_game_id))));
    const games = await Game.getGamesByIds(ids);
    const titles = new Map<number, string>();
    for (const game of games) {
      titles.set(Number(game.id), game.title);
    }
    return titles;
  }

  static async addEntry(params: {
    userId: string;
    gameId: number;
    platformId: number | null;
    ownershipType: string;
    note?: string | null;
  }): Promise<IUserGameCollectionEntry> {
    const { userId, gameId, platformId } = params;
    const ownershipType = normalizeOwnershipType(params.ownershipType);
    const note = params.note?.trim() ? params.note.trim() : null;

    requirePositiveInt(gameId, "GameDB id");
    if (platformId != null && !isPositiveInt(platformId)) {
      throw new Error("Invalid platform id.");
    }
    if (note && note.length > 500) {
      throw new Error("Note must be 500 characters or fewer.");
    }

    let response: CollectionResponse | null;
    try {
      response = await apiPost<CollectionResponse>(`/api/v1/users/${userId}/collections`, {
        data: {
          gamedb_game_id: gameId,
          platform_id: platformId,
          ownership_type: ownershipType,
          note,
        },
      });
    } catch (err: any) {
      const msg = String(err?.response?.data?.error ?? err?.message ?? "");
      if (/unique|duplicate|already been taken/i.test(msg)) {
        throw new Error(
          "That game/platform/ownership entry already exists in your collection.",
        );
      }
      throw err;
    }

    if (!response) throw new Error("Failed to create collection entry.");
    return enrichEntry(response.data);
  }

  static async getEntryForUser(
    entryId: number,
    userId: string,
  ): Promise<IUserGameCollectionEntry | null> {
    requirePositiveInt(entryId, "entry id");
    const response = await apiGet<CollectionResponse>(`/api/v1/collections/${entryId}`);
    if (!response) return null;
    if (response.data.user_id !== userId) return null;
    return enrichEntry(response.data);
  }

  static async updateEntryForUser(
    entryId: number,
    userId: string,
    updates: {
      platformId?: number | null;
      ownershipType?: string;
      note?: string | null;
    },
  ): Promise<IUserGameCollectionEntry | null> {
    requirePositiveInt(entryId, "entry id");

    const body: Record<string, string | number | null | undefined> = {};

    if (updates.platformId !== undefined) {
      if (updates.platformId != null && !isPositiveInt(updates.platformId)) {
        throw new Error("Invalid platform id.");
      }
      body.platform_id = updates.platformId;
    }

    if (updates.ownershipType !== undefined) {
      body.ownership_type = normalizeOwnershipType(updates.ownershipType);
    }

    if (updates.note !== undefined) {
      const note = updates.note?.trim() ? updates.note.trim() : null;
      if (note && note.length > 500) {
        throw new Error("Note must be 500 characters or fewer.");
      }
      body.note = note;
    }

    if (!Object.keys(body).length) {
      throw new Error("No collection fields were provided to update.");
    }

    // Verify ownership before mutating
    const existing = await apiGet<CollectionResponse>(`/api/v1/collections/${entryId}`);
    if (!existing || existing.data.user_id !== userId) return null;

    let response: CollectionResponse | null;
    try {
      response = await apiPatch<CollectionResponse>(`/api/v1/collections/${entryId}`, {
        data: body,
      });
    } catch (err: any) {
      const msg = String(err?.response?.data?.error ?? err?.message ?? "");
      if (/unique|duplicate|already been taken/i.test(msg)) {
        throw new Error(
          "That game/platform/ownership entry already exists in your collection.",
        );
      }
      throw err;
    }

    if (!response) return null;
    return enrichEntry(response.data);
  }

  static async removeEntryForUser(entryId: number, userId: string): Promise<boolean> {
    requirePositiveInt(entryId, "entry id");
    // Verify ownership before deleting
    const existing = await apiGet<CollectionResponse>(`/api/v1/collections/${entryId}`);
    if (!existing || existing.data.user_id !== userId) return false;
    const result = await apiDelete<{ deleted: boolean }>(`/api/v1/collections/${entryId}`);
    return result?.deleted === true;
  }

  static async searchEntries(filters: {
    targetUserId: string;
    title?: string;
    platform?: string;
    platformId?: number | null;
    ownershipType?: string;
    limit?: number;
  }): Promise<IUserGameCollectionEntry[]> {
    const params: Record<string, string> = {};
    if (filters.title?.trim()) params.q = filters.title.trim();
    if (filters.platform?.trim()) params.platform = filters.platform.trim();
    if (filters.ownershipType?.trim()) {
      params.ownership_type = normalizeOwnershipType(filters.ownershipType);
    }

    let rows = await UserGameCollection.fetchAllPages<CollectionApiData>(
      `/api/v1/users/${filters.targetUserId}/collections`,
      params,
    );

    // The list endpoint has no platform_id filter, so apply it client-side.
    if (filters.platformId !== undefined) {
      if (filters.platformId === null) {
        rows = rows.filter((row) => row.platform_id == null);
      } else if (isPositiveInt(filters.platformId)) {
        const platformId = Math.trunc(filters.platformId);
        rows = rows.filter((row) => Number(row.platform_id) === platformId);
      } else {
        throw new Error("Invalid platform id.");
      }
    }

    const titles = await UserGameCollection.fetchTitles(rows);
    const entries = rows.map((row) =>
      mapApiEntry(
        row,
        titles.get(Number(row.gamedb_game_id)) ?? `Game #${row.gamedb_game_id}`,
      ),
    );

    entries.sort((a, b) => {
      const titleCmp = a.title.toLowerCase().localeCompare(b.title.toLowerCase());
      if (titleCmp !== 0) return titleCmp;
      const platCmp = (a.platformName ?? "").toLowerCase()
        .localeCompare((b.platformName ?? "").toLowerCase());
      if (platCmp !== 0) return platCmp;
      return a.entryId - b.entryId;
    });

    const requestedLimit = Number(filters.limit ?? 0);
    if (isPositiveInt(requestedLimit)) {
      return entries.slice(0, Math.trunc(requestedLimit));
    }
    return entries;
  }

  static async getOverviewForUser(userId: string): Promise<{
    totalCount: number;
    platformCounts: IUserGameCollectionOverviewEntry[];
  }> {
    if (!userId.trim()) {
      throw new Error("Invalid user id.");
    }

    const response = await apiGet<PlatformSummaryResponse>(
      `/api/v1/users/${userId}/collections/platform_summary`,
    );
    const summary = response?.data;

    return {
      totalCount: Number(summary?.total_count ?? 0),
      platformCounts: (summary?.platform_counts ?? []).map(mapPlatformCount),
    };
  }

  static async getOverviewForAllUsers(): Promise<{
    totalCount: number;
    platformCounts: IUserGameCollectionOverviewEntry[];
  }> {
    const users = await UserGameCollection.fetchAllPages<{
      user_id: string;
      is_bot?: boolean;
    }>("/api/v1/users");
    const userIds = users
      .filter((user) => user.is_bot !== true)
      .map((user) => user.user_id);

    let totalCount = 0;
    const platformsByKey = new Map<string, IUserGameCollectionOverviewEntry>();

    const chunkSize = 10;
    for (let i = 0; i < userIds.length; i += chunkSize) {
      const chunk = userIds.slice(i, i + chunkSize);
      const summaries = await Promise.all(
        chunk.map((userId) =>
          apiGet<PlatformSummaryResponse>(
            `/api/v1/users/${userId}/collections/platform_summary`,
          ),
        ),
      );

      for (const response of summaries) {
        const summary = response?.data;
        if (!summary) continue;
        totalCount += Number(summary.total_count ?? 0);
        for (const raw of summary.platform_counts ?? []) {
          const entry = mapPlatformCount(raw);
          const key = entry.platformId == null ? "null" : String(entry.platformId);
          const existing = platformsByKey.get(key);
          if (existing) {
            existing.total += entry.total;
          } else {
            platformsByKey.set(key, { ...entry });
          }
        }
      }
    }

    const platformCounts = Array.from(platformsByKey.values()).sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      const aName = (a.platformName ?? "Unknown").toLowerCase();
      const bName = (b.platformName ?? "Unknown").toLowerCase();
      return aName.localeCompare(bName);
    });

    return { totalCount, platformCounts };
  }

  static async autocompleteEntries(
    userId: string,
    query: string,
    limit: number = 25,
  ): Promise<IUserGameCollectionAutocompleteEntry[]> {
    const trimmed = query.trim();
    const params: Record<string, string | number> = {
      limit: Math.max(1, Math.min(limit, 25)),
    };
    if (trimmed) params.q = trimmed;

    const response = await apiGet<{ data: CollectionApiData[] }>(
      `/api/v1/users/${userId}/collections`,
      { params },
    );
    const rows = response?.data ?? [];

    const titles = await UserGameCollection.fetchTitles(rows);
    return rows.map((row) => ({
      entryId: Number(row.entry_id),
      gameId: Number(row.gamedb_game_id),
      title: titles.get(Number(row.gamedb_game_id)) ?? `Game #${row.gamedb_game_id}`,
      platformName: row.platform_name ?? null,
      ownershipType: normalizeOwnershipType(row.ownership_type),
    }));
  }
}
