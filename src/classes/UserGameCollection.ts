import type oracledb from "oracledb";
import type pg from "pg";
import {
  dbQuery,
  dbMutate,
  dbTransaction,
  dbQueryConn,
  dbInsertConn,
  dbMutateConn,
} from "../db/SqlManager.js";
import { UserGameCollectionSql } from "../db/sql/index.js";

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

async function getEntryById(
  entryId: number,
  userId: string,
  conn: oracledb.Connection | pg.PoolClient,
): Promise<IUserGameCollectionEntry | null> {
  const rows = await dbQueryConn(
    conn,
    UserGameCollectionSql.getEntryById,
    { entryId, userId },
    mapEntry,
  );
  return rows[0] ?? null;
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
    const isShared = 1;

    if (!Number.isInteger(gameId) || gameId <= 0) {
      throw new Error("Invalid GameDB id.");
    }
    if (platformId != null && (!Number.isInteger(platformId) || platformId <= 0)) {
      throw new Error("Invalid platform id.");
    }
    if (note && note.length > 500) {
      throw new Error("Note must be 500 characters or fewer.");
    }

    return dbTransaction(async (conn) => {
      let entryId: number;
      try {
        entryId = await dbInsertConn(conn, UserGameCollectionSql.addEntry, {
          userId,
          gameId,
          platformId,
          ownershipType,
          note,
          isShared,
        }, "entryId");
      } catch (err: any) {
        const msg = String(err?.message ?? "");
        if (/ORA-00001/i.test(msg) || /unique constraint/i.test(msg)) {
          throw new Error(
            "That game/platform/ownership entry already exists in your collection.",
          );
        }
        throw err;
      }

      if (!entryId) throw new Error("Failed to create collection entry.");

      const saved = await getEntryById(entryId, userId, conn);
      if (!saved) throw new Error("Failed to load created collection entry.");
      return saved;
    });
  }

  static async getEntryForUser(
    entryId: number,
    userId: string,
  ): Promise<IUserGameCollectionEntry | null> {
    if (!Number.isInteger(entryId) || entryId <= 0) {
      throw new Error("Invalid entry id.");
    }
    const rows = await dbQuery(
      UserGameCollectionSql.getEntryForUser,
      { entryId, userId },
      mapEntry,
    );
    return rows[0] ?? null;
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
    if (!Number.isInteger(entryId) || entryId <= 0) {
      throw new Error("Invalid entry id.");
    }

    const updateParts: string[] = [];
    const binds: Record<string, string | number | null> = { entryId, userId };

    if (updates.platformId !== undefined) {
      if (updates.platformId != null &&
        (!Number.isInteger(updates.platformId) || updates.platformId <= 0)) {
        throw new Error("Invalid platform id.");
      }
      updateParts.push("PLATFORM_ID = :platformId");
      binds.platformId = updates.platformId;
    }

    if (updates.ownershipType !== undefined) {
      updateParts.push("OWNERSHIP_TYPE = :ownershipType");
      binds.ownershipType = normalizeOwnershipType(updates.ownershipType);
    }

    if (updates.note !== undefined) {
      const note = updates.note?.trim() ? updates.note.trim() : null;
      if (note && note.length > 500) {
        throw new Error("Note must be 500 characters or fewer.");
      }
      updateParts.push("NOTE = :note");
      binds.note = note;
    }

    if (!updateParts.length) {
      throw new Error("No collection fields were provided to update.");
    }

    return dbTransaction(async (conn) => {
      let rowsAffected: number;
      try {
        rowsAffected = await dbMutateConn(
          conn, UserGameCollectionSql.updateEntry(updateParts), binds,
        );
      } catch (err: any) {
        const msg = String(err?.message ?? "");
        if (/ORA-00001/i.test(msg) || /unique constraint/i.test(msg)) {
          throw new Error(
            "That game/platform/ownership entry already exists in your collection.",
          );
        }
        throw err;
      }

      if (rowsAffected <= 0) return null;
      return getEntryById(entryId, userId, conn);
    });
  }

  static async removeEntryForUser(entryId: number, userId: string): Promise<boolean> {
    if (!Number.isInteger(entryId) || entryId <= 0) {
      throw new Error("Invalid entry id.");
    }
    return (await dbMutate(
      UserGameCollectionSql.removeEntry,
      { entryId, userId },
    )) > 0;
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
      } else if (Number.isInteger(filters.platformId) && filters.platformId > 0) {
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
    const hasLimit = Number.isInteger(requestedLimit) && requestedLimit > 0;
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
