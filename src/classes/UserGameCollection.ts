import { dbQuery } from "../db/SqlManager.js";
import { UserGameCollectionSql } from "../db/sql/index.js";
import { isPositiveInt, requirePositiveInt } from "../utilities/ValidationUtils.js";
import { apiGet, apiPost, apiPatch, apiDelete } from "../services/RpgClubApiClient.js";
import Game from "./Game.js";
import GamePlatformRegionService from "./GamePlatformRegionService.js";

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

export interface IUserGameCollectionUserOverview {
  userId: string;
  username: string | null;
  globalName: string | null;
  totalCount: number;
  platformCounts: IUserGameCollectionOverviewEntry[];
}

type CollectionRow = {
  ENTRY_ID: number;
  USER_ID: string;
  GAMEDB_GAME_ID: number;
  TITLE: string;
  PLATFORM_ID: number | null;
  PLATFORM_NAME: string | null;
  PLATFORM_ABBREVIATION: string | null;
  OWNERSHIP_TYPE: CollectionOwnershipType;
  NOTE: string | null;
  IS_SHARED: number;
  CREATED_AT: Date | string;
  UPDATED_AT: Date | string;
};

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
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

function mapEntry(row: CollectionRow): IUserGameCollectionEntry {
  return {
    entryId: Number(row.ENTRY_ID),
    userId: row.USER_ID,
    gameId: Number(row.GAMEDB_GAME_ID),
    title: row.TITLE,
    platformId: row.PLATFORM_ID == null ? null : Number(row.PLATFORM_ID),
    platformName: row.PLATFORM_NAME ?? null,
    platformAbbreviation: row.PLATFORM_ABBREVIATION ?? null,
    ownershipType: row.OWNERSHIP_TYPE,
    note: row.NOTE ?? null,
    isShared: Number(row.IS_SHARED ?? 0) === 1,
    createdAt: toDate(row.CREATED_AT),
    updatedAt: toDate(row.UPDATED_AT),
  };
}

// --- API types (GET /api/v1/collections/:id, POST/PATCH responses use as_json) ---

type CollectionApiData = {
  entry_id: number;
  user_id: string;
  gamedb_game_id: number;
  platform_id: number | null;
  ownership_type: string;
  note: string | null;
  is_shared: boolean | number;
  created_at: string;
  updated_at: string;
};

type CollectionResponse = { data: CollectionApiData };

async function enrichEntry(raw: CollectionApiData): Promise<IUserGameCollectionEntry> {
  const [game, platform] = await Promise.all([
    Game.getGameById(raw.gamedb_game_id),
    raw.platform_id != null
      ? GamePlatformRegionService.getPlatformById(raw.platform_id)
      : Promise.resolve(null),
  ]);
  return {
    entryId: Number(raw.entry_id),
    userId: raw.user_id,
    gameId: Number(raw.gamedb_game_id),
    title: game?.title ?? `Game #${raw.gamedb_game_id}`,
    platformId: raw.platform_id != null ? Number(raw.platform_id) : null,
    platformName: platform?.name ?? null,
    platformAbbreviation: platform?.abbreviation ?? null,
    ownershipType: normalizeOwnershipType(raw.ownership_type),
    note: raw.note ?? null,
    isShared: Boolean(raw.is_shared),
    createdAt: new Date(raw.created_at),
    updatedAt: new Date(raw.updated_at),
  };
}

export default class UserGameCollection {
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
    const targetUserId = filters.targetUserId;
    const where: string[] = ["c.USER_ID = :targetUserId"];
    const binds: Record<string, string | number | null> = { targetUserId };

    if (filters.title?.trim()) {
      where.push("LOWER(g.TITLE) LIKE :title");
      binds.title = `%${filters.title.trim().toLowerCase()}%`;
    }

    if (filters.platform?.trim()) {
      where.push(
        "(LOWER(NVL(p.PLATFORM_NAME, '')) LIKE :platform " +
        "OR LOWER(NVL(p.PLATFORM_CODE, '')) LIKE :platform " +
        "OR LOWER(NVL(p.PLATFORM_ABBREVIATION, '')) LIKE :platform)",
      );
      binds.platform = `%${filters.platform.trim().toLowerCase()}%`;
    }

    if (filters.platformId !== undefined) {
      if (filters.platformId == null) {
        where.push("c.PLATFORM_ID IS NULL");
      } else if (isPositiveInt(filters.platformId)) {
        where.push("c.PLATFORM_ID = :platformId");
        binds.platformId = Math.trunc(filters.platformId);
      } else {
        throw new Error("Invalid platform id.");
      }
    }

    if (filters.ownershipType?.trim()) {
      where.push("c.OWNERSHIP_TYPE = :ownershipType");
      binds.ownershipType = normalizeOwnershipType(filters.ownershipType);
    }

    const requestedLimit = Number(filters.limit ?? 0);
    const hasLimit = isPositiveInt(requestedLimit);
    if (hasLimit) {
      binds.limit = Math.trunc(requestedLimit);
    }
    const fetchClause = hasLimit ? "FETCH FIRST :limit ROWS ONLY" : "";

    return dbQuery(
      UserGameCollectionSql.searchEntries(where.join(" AND "), fetchClause),
      binds,
      mapEntry,
    );
  }

  static async getOverviewForUser(userId: string): Promise<{
    totalCount: number;
    platformCounts: IUserGameCollectionOverviewEntry[];
  }> {
    if (!userId.trim()) {
      throw new Error("Invalid user id.");
    }

    const [totalRows, platformRows] = await Promise.all([
      dbQuery(
        UserGameCollectionSql.getTotalCount,
        { userId },
        (row: { TOTAL_COUNT: number }) => row,
      ),
      dbQuery(
        UserGameCollectionSql.getPlatformCounts,
        { userId },
        (row: {
          PLATFORM_ID: number | null;
          PLATFORM_NAME: string | null;
          PLATFORM_ABBREVIATION: string | null;
          TOTAL_COUNT: number;
        }) => ({
          platformId: row.PLATFORM_ID == null ? null : Number(row.PLATFORM_ID),
          platformName: row.PLATFORM_NAME ?? null,
          platformAbbreviation: row.PLATFORM_ABBREVIATION ?? null,
          total: Number(row.TOTAL_COUNT ?? 0),
        }),
      ),
    ]);

    return {
      totalCount: Number(totalRows[0]?.TOTAL_COUNT ?? 0),
      platformCounts: platformRows,
    };
  }

  static async getOverviewForAllUsers(): Promise<{
    totalCount: number;
    platformCounts: IUserGameCollectionOverviewEntry[];
    users: IUserGameCollectionUserOverview[];
  }> {
    const [totalRows, platformRows, userRows] = await Promise.all([
      dbQuery(
        UserGameCollectionSql.getTotalAllCount,
        {},
        (row: { TOTAL_COUNT: number }) => row,
      ),
      dbQuery(
        UserGameCollectionSql.getAllPlatformCounts,
        {},
        (row: {
          PLATFORM_ID: number | null;
          PLATFORM_NAME: string | null;
          PLATFORM_ABBREVIATION: string | null;
          TOTAL_COUNT: number;
        }) => ({
          platformId: row.PLATFORM_ID == null ? null : Number(row.PLATFORM_ID),
          platformName: row.PLATFORM_NAME ?? null,
          platformAbbreviation: row.PLATFORM_ABBREVIATION ?? null,
          total: Number(row.TOTAL_COUNT ?? 0),
        }),
      ),
      dbQuery(
        UserGameCollectionSql.getAllUserRows,
        {},
        (row: {
          USER_ID: string;
          USERNAME: string | null;
          GLOBAL_NAME: string | null;
          PLATFORM_ID: number | null;
          PLATFORM_NAME: string | null;
          PLATFORM_ABBREVIATION: string | null;
          TOTAL_COUNT: number;
        }) => row,
      ),
    ]);

    const usersById = new Map<string, IUserGameCollectionUserOverview>();
    for (const row of userRows) {
      const userId = row.USER_ID;
      const existing = usersById.get(userId);
      const platformEntry: IUserGameCollectionOverviewEntry = {
        platformId: row.PLATFORM_ID == null ? null : Number(row.PLATFORM_ID),
        platformName: row.PLATFORM_NAME ?? null,
        platformAbbreviation: row.PLATFORM_ABBREVIATION ?? null,
        total: Number(row.TOTAL_COUNT ?? 0),
      };

      if (existing) {
        existing.platformCounts.push(platformEntry);
        existing.totalCount += platformEntry.total;
      } else {
        usersById.set(userId, {
          userId,
          username: row.USERNAME ?? null,
          globalName: row.GLOBAL_NAME ?? null,
          totalCount: platformEntry.total,
          platformCounts: [platformEntry],
        });
      }
    }

    const users = Array.from(usersById.values()).sort((a, b) => {
      const aName = (a.globalName ?? a.username ?? a.userId).toLowerCase();
      const bName = (b.globalName ?? b.username ?? b.userId).toLowerCase();
      return aName.localeCompare(bName);
    });

    return {
      totalCount: Number(totalRows[0]?.TOTAL_COUNT ?? 0),
      platformCounts: platformRows,
      users,
    };
  }

  static async autocompleteEntries(
    userId: string,
    query: string,
    limit: number = 25,
  ): Promise<IUserGameCollectionAutocompleteEntry[]> {
    const trimmed = query.trim().toLowerCase();
    const binds: Record<string, string | number> = {
      userId,
      limit: Math.max(1, Math.min(limit, 25)),
    };

    const titleWhere = trimmed
      ? "AND (LOWER(g.TITLE) LIKE :query " +
        "OR LOWER(NVL(p.PLATFORM_NAME, '')) LIKE :query " +
        "OR LOWER(c.OWNERSHIP_TYPE) LIKE :query)"
      : "";

    if (trimmed) {
      binds.query = `%${trimmed}%`;
    }

    const rows = await dbQuery(
      UserGameCollectionSql.autocompleteEntries(titleWhere),
      binds,
      mapEntry,
    );

    return rows.map((row) => ({
      entryId: row.entryId,
      gameId: row.gameId,
      title: row.title,
      platformName: row.platformName,
      ownershipType: row.ownershipType,
    }));
  }
}
