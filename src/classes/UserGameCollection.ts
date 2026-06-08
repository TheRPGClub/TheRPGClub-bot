import oracledb from "oracledb";
import { oraQuery, oraMutate, oraWithConnection } from "../db/SqlManager.js";

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

const ENTRY_SELECT_SQL = `SELECT c.ENTRY_ID,
       c.USER_ID,
       c.GAMEDB_GAME_ID,
       g.TITLE,
       c.PLATFORM_ID,
       p.PLATFORM_NAME,
       p.PLATFORM_ABBREVIATION,
       c.OWNERSHIP_TYPE,
       c.NOTE,
       c.IS_SHARED,
       c.CREATED_AT,
       c.UPDATED_AT
  FROM USER_GAME_COLLECTIONS c
  JOIN GAMEDB_GAMES g ON g.GAME_ID = c.GAMEDB_GAME_ID
  LEFT JOIN GAMEDB_PLATFORMS p ON p.PLATFORM_ID = c.PLATFORM_ID`;

async function getEntryById(
  entryId: number,
  userId: string,
  conn: oracledb.Connection,
): Promise<IUserGameCollectionEntry | null> {
  const rows = await oraQuery(
    `${ENTRY_SELECT_SQL}
     WHERE c.ENTRY_ID = :entryId
       AND c.USER_ID = :userId`,
    { entryId, userId },
    mapEntry,
    conn,
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

    return oraWithConnection(async (conn) => {
      let insert: oracledb.Result<unknown>;
      try {
        insert = await oraMutate(
          `INSERT INTO USER_GAME_COLLECTIONS (
             USER_ID,
             GAMEDB_GAME_ID,
             PLATFORM_ID,
             OWNERSHIP_TYPE,
             NOTE,
             IS_SHARED
           ) VALUES (
             :userId,
             :gameId,
             :platformId,
             :ownershipType,
             :note,
             :isShared
           )
           RETURNING ENTRY_ID INTO :entryId`,
          {
            userId,
            gameId,
            platformId,
            ownershipType,
            note,
            isShared,
            entryId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
          },
          conn,
        );
        await conn.commit();
      } catch (err: any) {
        const msg = String(err?.message ?? "");
        if (/ORA-00001/i.test(msg) || /unique constraint/i.test(msg)) {
          throw new Error(
            "That game/platform/ownership entry already exists in your collection.",
          );
        }
        throw err;
      }

      const entryId = Number(
        (insert.outBinds as { entryId?: number[] })?.entryId?.[0] ?? 0,
      );
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
    const rows = await oraQuery(
      `${ENTRY_SELECT_SQL}
       WHERE c.ENTRY_ID = :entryId
         AND c.USER_ID = :userId`,
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

    return oraWithConnection(async (conn) => {
      let result: oracledb.Result<unknown>;
      try {
        result = await oraMutate(
          `UPDATE USER_GAME_COLLECTIONS
              SET ${updateParts.join(", ")}
            WHERE ENTRY_ID = :entryId
              AND USER_ID = :userId`,
          binds,
          conn,
        );
        await conn.commit();
      } catch (err: any) {
        const msg = String(err?.message ?? "");
        if (/ORA-00001/i.test(msg) || /unique constraint/i.test(msg)) {
          throw new Error(
            "That game/platform/ownership entry already exists in your collection.",
          );
        }
        throw err;
      }

      if ((result.rowsAffected ?? 0) <= 0) return null;
      return getEntryById(entryId, userId, conn);
    });
  }

  static async removeEntryForUser(entryId: number, userId: string): Promise<boolean> {
    if (!Number.isInteger(entryId) || entryId <= 0) {
      throw new Error("Invalid entry id.");
    }
    const result = await oraMutate(
      `DELETE FROM USER_GAME_COLLECTIONS
        WHERE ENTRY_ID = :entryId
          AND USER_ID = :userId`,
      { entryId, userId },
    );
    return (result.rowsAffected ?? 0) > 0;
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

    return oraQuery(
      `SELECT c.ENTRY_ID,
              c.USER_ID,
              c.GAMEDB_GAME_ID,
              g.TITLE,
              c.PLATFORM_ID,
              p.PLATFORM_NAME,
              p.PLATFORM_ABBREVIATION,
              c.OWNERSHIP_TYPE,
              c.NOTE,
              c.IS_SHARED,
              c.CREATED_AT,
              c.UPDATED_AT
         FROM USER_GAME_COLLECTIONS c
         JOIN GAMEDB_GAMES g ON g.GAME_ID = c.GAMEDB_GAME_ID
        LEFT JOIN GAMEDB_PLATFORMS p ON p.PLATFORM_ID = c.PLATFORM_ID
        WHERE ${where.join(" AND ")}
        ORDER BY LOWER(g.TITLE), LOWER(NVL(p.PLATFORM_NAME, '')), c.ENTRY_ID
        ${fetchClause}`,
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
      oraQuery(
        `SELECT COUNT(*) AS TOTAL_COUNT
           FROM USER_GAME_COLLECTIONS
          WHERE USER_ID = :userId`,
        { userId },
        (row: { TOTAL_COUNT: number }) => row,
      ),
      oraQuery(
        `SELECT c.PLATFORM_ID,
                p.PLATFORM_NAME,
                p.PLATFORM_ABBREVIATION,
                COUNT(*) AS TOTAL_COUNT
           FROM USER_GAME_COLLECTIONS c
           LEFT JOIN GAMEDB_PLATFORMS p ON p.PLATFORM_ID = c.PLATFORM_ID
          WHERE c.USER_ID = :userId
          GROUP BY c.PLATFORM_ID, p.PLATFORM_NAME, p.PLATFORM_ABBREVIATION
          ORDER BY COUNT(*) DESC,
                   LOWER(NVL(p.PLATFORM_NAME, 'Unknown')),
                   c.PLATFORM_ID`,
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
      oraQuery(
        `SELECT COUNT(*) AS TOTAL_COUNT FROM USER_GAME_COLLECTIONS`,
        {},
        (row: { TOTAL_COUNT: number }) => row,
      ),
      oraQuery(
        `SELECT c.PLATFORM_ID,
                p.PLATFORM_NAME,
                p.PLATFORM_ABBREVIATION,
                COUNT(*) AS TOTAL_COUNT
           FROM USER_GAME_COLLECTIONS c
           LEFT JOIN GAMEDB_PLATFORMS p ON p.PLATFORM_ID = c.PLATFORM_ID
          GROUP BY c.PLATFORM_ID, p.PLATFORM_NAME, p.PLATFORM_ABBREVIATION
          ORDER BY COUNT(*) DESC,
                   LOWER(NVL(p.PLATFORM_NAME, 'Unknown')),
                   c.PLATFORM_ID`,
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
      oraQuery(
        `SELECT c.USER_ID,
                u.USERNAME,
                u.GLOBAL_NAME,
                c.PLATFORM_ID,
                p.PLATFORM_NAME,
                p.PLATFORM_ABBREVIATION,
                COUNT(*) AS TOTAL_COUNT
           FROM USER_GAME_COLLECTIONS c
           LEFT JOIN RPG_CLUB_USERS u ON u.USER_ID = c.USER_ID
           LEFT JOIN GAMEDB_PLATFORMS p ON p.PLATFORM_ID = c.PLATFORM_ID
          WHERE NVL(u.IS_BOT, 0) = 0
          GROUP BY c.USER_ID,
                   u.USERNAME,
                   u.GLOBAL_NAME,
                   c.PLATFORM_ID,
                   p.PLATFORM_NAME,
                   p.PLATFORM_ABBREVIATION
          ORDER BY LOWER(COALESCE(u.GLOBAL_NAME, u.USERNAME, c.USER_ID)),
                   c.USER_ID,
                   COUNT(*) DESC,
                   LOWER(NVL(p.PLATFORM_NAME, 'Unknown')),
                   c.PLATFORM_ID`,
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

    const rows = await oraQuery(
      `SELECT c.ENTRY_ID,
              c.USER_ID,
              c.GAMEDB_GAME_ID,
              g.TITLE,
              c.PLATFORM_ID,
              p.PLATFORM_NAME,
              p.PLATFORM_ABBREVIATION,
              c.OWNERSHIP_TYPE,
              c.NOTE,
              c.IS_SHARED,
              c.CREATED_AT,
              c.UPDATED_AT
         FROM USER_GAME_COLLECTIONS c
         JOIN GAMEDB_GAMES g ON g.GAME_ID = c.GAMEDB_GAME_ID
         LEFT JOIN GAMEDB_PLATFORMS p ON p.PLATFORM_ID = c.PLATFORM_ID
        WHERE c.USER_ID = :userId
          ${titleWhere}
        ORDER BY LOWER(g.TITLE), LOWER(NVL(p.PLATFORM_NAME, '')), c.ENTRY_ID
        FETCH FIRST :limit ROWS ONLY`,
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
