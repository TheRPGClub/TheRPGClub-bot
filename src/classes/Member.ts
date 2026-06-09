import oracledb from "oracledb";
import type pg from "pg";
import {
  dbQuery,
  dbMutate,
  dbWithConnection,
  dbTransaction,
  dbQueryConn,
  dbMutateConn,
  dbInsertConn,
} from "../db/SqlManager.js";
import { getDialect } from "../db/dialect.js";
import { MemberSql } from "../db/sql/index.js";

const dialect = getDialect();

export interface IMemberRecord {
  userId: string;
  isBot: number;
  username: string | null;
  globalName: string | null;
  avatarBlob: Buffer | null;
  serverJoinedAt: Date | null;
  serverLeftAt: Date | null;
  lastSeenAt: Date | null;
  roleAdmin: number;
  roleModerator: number;
  roleRegular: number;
  roleMember: number;
  roleNewcomer: number;
  messageCount: number | null;
  completionatorUrl: string | null;
  psnUsername: string | null;
  xblUsername: string | null;
  nswFriendCode: string | null;
  steamUrl: string | null;
  profileImage: Buffer | null;
  profileImageAt: Date | null;
}

export interface IMemberPlatformRecord {
  userId: string;
  username: string | null;
  globalName: string | null;
  steamUrl: string | null;
  psnUsername: string | null;
  xblUsername: string | null;
  nswFriendCode: string | null;
}

export interface IMemberSearchFilters {
  userId?: string;
  username?: string;
  globalName?: string;
  completionatorUrl?: string;
  steamUrl?: string;
  psnUsername?: string;
  xblUsername?: string;
  nswFriendCode?: string;
  roleAdmin?: boolean;
  roleModerator?: boolean;
  roleRegular?: boolean;
  roleMember?: boolean;
  roleNewcomer?: boolean;
  isBot?: boolean;
  includeDeparted?: boolean;
  joinedAfter?: Date;
  joinedBefore?: Date;
  lastSeenAfter?: Date;
  lastSeenBefore?: Date;
  limit?: number;
}

export interface IMemberSearchResult {
  userId: string;
  username: string | null;
  globalName: string | null;
  isBot: number;
  completionatorUrl: string | null;
  steamUrl: string | null;
  psnUsername: string | null;
  xblUsername: string | null;
  nswFriendCode: string | null;
  roleAdmin: number;
  roleModerator: number;
  roleRegular: number;
  roleMember: number;
  roleNewcomer: number;
  serverJoinedAt: Date | null;
  serverLeftAt: Date | null;
  lastSeenAt: Date | null;
}

export interface IMemberNickHistory {
  oldNick: string | null;
  newNick: string | null;
  changedAt: Date;
}

export interface IMemberNowPlayingEntry {
  gameId: number;
  title: string;
  platformId: number | null;
  platformName: string | null;
  platformAbbreviation: string | null;
  threadId: string | null;
  note: string | null;
  addedAt: Date | null;
  noteUpdatedAt: Date | null;
  sortOrder: number | null;
  journalEnabled: boolean;
  hasJournalEntry: boolean;
  journalCount: number;
  lastJournalAt: Date | null;
}

export interface IMemberNowPlayingList {
  userId: string;
  username: string | null;
  globalName: string | null;
  entries: IMemberNowPlayingEntry[];
}

export interface IGameJournalEntry {
  entryId: number;
  entryNumber: number;
  userId: string;
  gameId: number;
  title: string | null;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IGameJournalPreference {
  userId: string;
  gameId: number;
  isEnabled: boolean;
}

export interface IGameJournalListEntry {
  gameId: number;
  title: string;
  totalEntries: number;
}

export interface IJournalUserSummary {
  userId: string;
  username: string | null;
  globalName: string | null;
  gameCount: number;
  entryCount: number;
}

export interface IJournalSearchResult {
  entryId: number;
  userId: string;
  globalName: string | null;
  username: string | null;
  gameId: number;
  gameTitle: string;
  entryTitle: string | null;
  body: string;
  createdAt: Date;
}

export interface IAvatarHistoryRecord {
  eventId: number;
  userId: string;
  avatarHash: string | null;
  avatarUrl: string | null;
  avatarBlob: Buffer | null;
  changedAt: Date;
}

export interface IMemberAvatarHistoryCount {
  userId: string;
  username: string | null;
  globalName: string | null;
  count: number;
}

export interface ICompletionRecord {
  completionId: number;
  gameId: number;
  title: string;
  completionType: string;
  platformId: number | null;
  completedAt: Date | null;
  finalPlaytimeHours: number | null;
  createdAt: Date;
  threadId: string | null;
  note: string | null;
}

type AnyConn = oracledb.Connection | pg.PoolClient;
const MAX_NOW_PLAYING = 10;
const LEGACY_THREAD_ID_SQL = `COALESCE(
                  (
                    SELECT MIN(tgl.THREAD_ID)
                    FROM THREAD_GAME_LINKS tgl
                    WHERE tgl.GAMEDB_GAME_ID = u.GAMEDB_GAME_ID
                  ),
                  (
                    SELECT MIN(th.THREAD_ID)
                    FROM THREADS th
                    WHERE th.GAMEDB_GAME_ID = u.GAMEDB_GAME_ID
                  )
                )`;
let nowPlayingLinkedThreadColumnAvailable: boolean | null = null;

async function getNowPlayingThreadIdSql(connection: AnyConn): Promise<string> {
  if (nowPlayingLinkedThreadColumnAvailable === null) {
    try {
      const res = await dbQueryConn(
        connection,
        MemberSql.checkLinkedThreadColumn,
        {},
        (row: { CNT: number }) => Number(row.CNT),
      );
      nowPlayingLinkedThreadColumnAvailable = (res[0] ?? 0) > 0;
    } catch (err) {
      nowPlayingLinkedThreadColumnAvailable = false;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[Member] Failed to detect LINKED_THREAD_ID column; using legacy links: ${msg}`,
      );
    }
  }

  return nowPlayingLinkedThreadColumnAvailable
    ? "g.LINKED_THREAD_ID"
    : LEGACY_THREAD_ID_SQL;
}

function buildParams(record: IMemberRecord) {
  return {
    userId: record.userId,
    isBot: record.isBot ? 1 : 0,
    username: record.username,
    globalName: record.globalName,
    avatarBlob: record.avatarBlob,
    joinedAt: record.serverJoinedAt,
    leftAt: record.serverLeftAt,
    lastSeenAt: record.lastSeenAt,
    roleAdmin: record.roleAdmin ? 1 : 0,
    roleModerator: record.roleModerator ? 1 : 0,
    roleRegular: record.roleRegular ? 1 : 0,
    roleMember: record.roleMember ? 1 : 0,
    roleNewcomer: record.roleNewcomer ? 1 : 0,
    completionatorUrl: record.completionatorUrl,
    psnUsername: record.psnUsername,
    xblUsername: record.xblUsername,
    nswFriendCode: record.nswFriendCode,
    steamUrl: record.steamUrl,
  };
}

export default class Member {
  static async touchLastSeen(userId: string, when: Date = new Date()): Promise<void> {
    try {
      await dbMutate(
        MemberSql.touchLastSeen,
        { userId, lastSeen: when },
      );
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.error(`[Member] Failed to update last seen for ${userId}: ${msg}`);
    }
  }

  static async getNowPlaying(
    userId: string,
  ): Promise<IMemberNowPlayingEntry[]> {
    return dbWithConnection(async (conn) => {
      const threadIdSql = await getNowPlayingThreadIdSql(conn);
      type NowPlayingRow = {
        GAME_ID: number; TITLE: string; PLATFORM_ID: number | null;
        PLATFORM_NAME: string | null; PLATFORM_ABBREVIATION: string | null;
        THREAD_ID: string | null; NOTE: string | null;
        ADDED_AT: Date | string | null; NOTE_UPDATED_AT: Date | string | null;
        SORT_ORDER: number | null; JOURNAL_ENABLED: number | null;
        HAS_JOURNAL_ENTRY: number | null; JOURNAL_COUNT: number | null;
        LAST_JOURNAL_AT: Date | string | null;
      };
      return dbQueryConn<NowPlayingRow, IMemberNowPlayingEntry>(
        conn,
        MemberSql.getNowPlaying(threadIdSql),
        { userId },
        (r) => ({
          gameId: Number(r.GAME_ID),
          title: r.TITLE,
          platformId: r.PLATFORM_ID == null ? null : Number(r.PLATFORM_ID),
          platformName: r.PLATFORM_NAME ?? null,
          platformAbbreviation: r.PLATFORM_ABBREVIATION ?? null,
          threadId: r.THREAD_ID ?? null,
          note: r.NOTE ?? null,
          addedAt: r.ADDED_AT instanceof Date
            ? r.ADDED_AT
            : r.ADDED_AT ? new Date(r.ADDED_AT as any) : null,
          noteUpdatedAt: r.NOTE_UPDATED_AT instanceof Date
            ? r.NOTE_UPDATED_AT
            : r.NOTE_UPDATED_AT ? new Date(r.NOTE_UPDATED_AT as any) : null,
          sortOrder: r.SORT_ORDER == null ? null : Number(r.SORT_ORDER),
          journalEnabled: Number(r.JOURNAL_ENABLED ?? 0) === 1,
          hasJournalEntry: Number(r.HAS_JOURNAL_ENTRY ?? 0) === 1,
          journalCount: Number(r.JOURNAL_COUNT ?? 0),
          lastJournalAt: r.LAST_JOURNAL_AT instanceof Date
            ? r.LAST_JOURNAL_AT
            : r.LAST_JOURNAL_AT ? new Date(r.LAST_JOURNAL_AT as any) : null,
        }),
      ).then((rows) => rows.slice(0, MAX_NOW_PLAYING));
    });
  }

  static async getAllNowPlaying(): Promise<IMemberNowPlayingList[]> {
    return dbWithConnection(async (conn) => {
      const threadIdSql = await getNowPlayingThreadIdSql(conn);
      type AllNowPlayingRow = {
        USER_ID: string; USERNAME: string | null; GLOBAL_NAME: string | null;
        GAME_ID: number; TITLE: string; PLATFORM_ID: number | null;
        PLATFORM_NAME: string | null; PLATFORM_ABBREVIATION: string | null;
        THREAD_ID: string | null; NOTE: string | null;
        ADDED_AT: Date | string | null; NOTE_UPDATED_AT: Date | string | null;
      };
      const rows = await dbQueryConn<AllNowPlayingRow, AllNowPlayingRow>(
        conn,
        MemberSql.getAllNowPlaying(threadIdSql),
        {},
        (r) => r,
      );

      const grouped = new Map<string, IMemberNowPlayingList>();
      for (const row of rows) {
        let record = grouped.get(row.USER_ID);
        if (!record) {
          record = {
            userId: row.USER_ID,
            username: row.USERNAME ?? null,
            globalName: row.GLOBAL_NAME ?? null,
            entries: [],
          };
          grouped.set(row.USER_ID, record);
        }

        if (record.entries.length < MAX_NOW_PLAYING) {
          record.entries.push({
            gameId: Number(row.GAME_ID),
            title: row.TITLE,
            platformId: row.PLATFORM_ID == null ? null : Number(row.PLATFORM_ID),
            platformName: row.PLATFORM_NAME ?? null,
            platformAbbreviation: row.PLATFORM_ABBREVIATION ?? null,
            threadId: row.THREAD_ID ?? null,
            note: row.NOTE ?? null,
            addedAt: row.ADDED_AT instanceof Date
              ? row.ADDED_AT
              : row.ADDED_AT ? new Date(row.ADDED_AT as any) : null,
            noteUpdatedAt: row.NOTE_UPDATED_AT instanceof Date
              ? row.NOTE_UPDATED_AT
              : row.NOTE_UPDATED_AT ? new Date(row.NOTE_UPDATED_AT as any) : null,
            sortOrder: null,
            journalEnabled: false,
            hasJournalEntry: false,
            journalCount: 0,
            lastJournalAt: null,
          });
        }
      }

      return Array.from(grouped.values()).sort((a, b) => {
        const aName = (a.globalName ?? a.username ?? a.userId).toLowerCase();
        const bName = (b.globalName ?? b.username ?? b.userId).toLowerCase();
        return aName.localeCompare(bName);
      });
    });
  }

  static async getNowPlayingByGameIds(
    gameIds: number[],
  ): Promise<{ gameId: number; title: string; userId: string }[]> {
    if (!gameIds.length) return [];
    const placeholders = gameIds.map((_, idx) => `:id${idx}`);
    const binds: Record<string, number> = {};
    gameIds.forEach((id, idx) => {
      binds[`id${idx}`] = id;
    });

    return dbQuery<{ GAME_ID: number; TITLE: string; USER_ID: string },
      { gameId: number; title: string; userId: string }>(
      MemberSql.getNowPlayingByGameIds(placeholders.join(", ")),
      binds,
      (row) => ({
        gameId: Number(row.GAME_ID),
        title: row.TITLE,
        userId: row.USER_ID,
      }),
    );
  }

  static async getNowPlayingByTitleSearch(
    query: string,
  ): Promise<{ gameId: number; title: string; userId: string }[]> {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return [];
    const searchQuery = `%${trimmed}%`;
    const normalizedQuery = `%${trimmed.replace(/[^a-z0-9]/g, "")}%`;
    return dbQuery<{ GAME_ID: number; TITLE: string; USER_ID: string },
      { gameId: number; title: string; userId: string }>(
      MemberSql.getNowPlayingByTitleSearch,
      { searchQuery, normalizedQuery },
      (row) => ({
        gameId: Number(row.GAME_ID),
        title: row.TITLE,
        userId: row.USER_ID,
      }),
    );
  }

  static async getNowPlayingEntries(
    userId: string,
  ): Promise<{
    gameId: number;
    title: string;
    platformId: number | null;
    platformName: string | null;
    platformAbbreviation: string | null;
    note: string | null;
    addedAt: Date | null;
    noteUpdatedAt: Date | null;
    sortOrder: number | null;
    journalEnabled: boolean;
    hasJournalEntry: boolean;
  }[]> {
    return dbQuery<{
      GAME_ID: number;
      TITLE: string;
      PLATFORM_ID: number | null;
      PLATFORM_NAME: string | null;
      PLATFORM_ABBREVIATION: string | null;
      NOTE: string | null;
      ADDED_AT: Date | string | null;
      NOTE_UPDATED_AT: Date | string | null;
      SORT_ORDER: number | null;
      JOURNAL_ENABLED: number | null;
    }, {
      gameId: number;
      title: string;
      platformId: number | null;
      platformName: string | null;
      platformAbbreviation: string | null;
      note: string | null;
      addedAt: Date | null;
      noteUpdatedAt: Date | null;
      sortOrder: number | null;
      journalEnabled: boolean;
      hasJournalEntry: boolean;
    }>(
      MemberSql.getNowPlayingEntries,
      { userId },
      (r) => ({
        gameId: Number(r.GAME_ID),
        title: r.TITLE,
        platformId: r.PLATFORM_ID == null ? null : Number(r.PLATFORM_ID),
        platformName: r.PLATFORM_NAME ?? null,
        platformAbbreviation: r.PLATFORM_ABBREVIATION ?? null,
        note: r.NOTE ?? null,
        addedAt: r.ADDED_AT instanceof Date
          ? r.ADDED_AT
          : r.ADDED_AT
            ? new Date(r.ADDED_AT as any)
            : null,
        noteUpdatedAt: r.NOTE_UPDATED_AT instanceof Date
          ? r.NOTE_UPDATED_AT
          : r.NOTE_UPDATED_AT
            ? new Date(r.NOTE_UPDATED_AT as any)
            : null,
        sortOrder: r.SORT_ORDER == null ? null : Number(r.SORT_ORDER),
        journalEnabled: Number(r.JOURNAL_ENABLED ?? 0) === 1,
        hasJournalEntry: false,
      }),
    );
  }

  static async getNowPlayingEntryMeta(
    userId: string,
    gameId: number,
  ): Promise<{ addedAt: Date | null } | null> {
    if (!Number.isInteger(gameId) || gameId <= 0) {
      throw new Error("Invalid GameDB id.");
    }
    const rows = await dbQuery<{ ADDED_AT: Date | string | null }, { addedAt: Date | null }>(
      MemberSql.getNowPlayingEntryMeta,
      { userId, gameId },
      (row) => ({
        addedAt: row.ADDED_AT instanceof Date
          ? row.ADDED_AT
          : row.ADDED_AT
            ? new Date(row.ADDED_AT as any)
            : null,
      }),
    );
    const row = rows[0];
    if (!row) {
      return null;
    }
    return row;
  }

  static async updateNowPlayingNote(
    userId: string,
    gameId: number,
    note: string | null,
  ): Promise<boolean> {
    if (!Number.isInteger(gameId) || gameId <= 0) {
      throw new Error("Invalid GameDB id.");
    }
    const normalizedNote = note?.trim();
    const noteValue = normalizedNote ? normalizedNote : null;
    const noteUpdatedAt = noteValue ? new Date() : null;

    const count = await dbMutate(
      MemberSql.updateNowPlayingNote,
      { userId, gameId, note: noteValue, noteUpdatedAt },
    );
    return count > 0;
  }

  static async addNowPlaying(
    userId: string,
    gameId: number,
    platformId: number,
    note: string | null = null,
  ): Promise<void> {
    if (!Number.isInteger(gameId) || gameId <= 0) {
      throw new Error("Invalid GameDB id.");
    }
    if (!Number.isInteger(platformId) || platformId <= 0) {
      throw new Error("Invalid platform selection.");
    }
    const normalizedNote = note?.trim();
    const noteValue = normalizedNote ? normalizedNote : null;
    const noteUpdatedAt = noteValue ? new Date() : null;

    try {
      await dbTransaction(async (conn) => {
        const countRows = await dbQueryConn(
          conn,
          MemberSql.countNowPlaying,
          { userId },
          (row: { CNT: number }) => Number(row.CNT),
        );
        const count = countRows[0] ?? 0;
        if (count >= MAX_NOW_PLAYING) {
          throw new Error(`You can only track up to ${MAX_NOW_PLAYING} Now Playing titles.`);
        }

        const sortRows = await dbQueryConn(
          conn,
          MemberSql.getNowPlayingMaxSort,
          { userId },
          (row: { MAX_SORT: number | null }) => Number(row.MAX_SORT ?? 0),
        );
        const nextSort = (sortRows[0] ?? 0) + 1;

        await dbMutateConn(
          conn,
          MemberSql.insertNowPlaying,
          { userId, gameId, platformId, note: noteValue, noteUpdatedAt, sortOrder: nextSort },
        );
        await dbMutateConn(conn, MemberSql.mergeJournalPrefs, { userId, gameId });
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (/unique/i.test(msg) || /UQ_USER_NOW_PLAYING/i.test(msg)) {
        throw new Error("That title is already in your Now Playing list.");
      }
      throw err;
    }
  }

  static async getGameJournalPreference(
    userId: string,
    gameId: number,
  ): Promise<IGameJournalPreference | null> {
    const rows = await dbQuery<{
      USER_ID: string;
      GAMEDB_GAME_ID: number;
      IS_ENABLED: number;
    }, IGameJournalPreference>(
      MemberSql.getGameJournalPreference,
      { userId, gameId },
      (row) => ({
        userId: row.USER_ID,
        gameId: Number(row.GAMEDB_GAME_ID),
        isEnabled: Number(row.IS_ENABLED) === 1,
      }),
    );
    const row = rows[0];
    if (!row) return null;
    return row;
  }

  static async upsertGameJournalPreference(
    userId: string,
    gameId: number,
    isEnabled: boolean,
  ): Promise<void> {
    await dbMutate(
      MemberSql.upsertGameJournalPreference,
      {
        userId,
        gameId,
        isEnabled: isEnabled ? 1 : 0,
      },
    );
  }

  static async getJournalStatusForGames(
    userId: string,
    gameIds: number[],
  ): Promise<
    Array<{
      gameId: number;
      journalCount: number;
      lastJournalAt: Date | null;
    }>
  > {
    if (!gameIds.length) return [];
    const uniqueIds = [...new Set(gameIds.filter((id) => Number.isInteger(id) && id > 0))];
    if (!uniqueIds.length) return [];
    const inlineTable = uniqueIds
      .map((_, idx) => `SELECT :id${idx} AS GAME_ID FROM DUAL`)
      .join(" UNION ALL ");
    const binds: Record<string, string | number> = { userId };
    uniqueIds.forEach((id, idx) => {
      binds[`id${idx}`] = id;
    });
    return dbQuery<{
      GAME_ID: number;
      JOURNAL_COUNT: number;
      LAST_JOURNAL_AT: Date | string | null;
    }, { gameId: number; journalCount: number; lastJournalAt: Date | null }>(
      MemberSql.getJournalStatusForGames(inlineTable),
      binds,
      (row) => ({
        gameId: Number(row.GAME_ID),
        journalCount: Number(row.JOURNAL_COUNT),
        lastJournalAt:
          row.LAST_JOURNAL_AT instanceof Date
            ? row.LAST_JOURNAL_AT
            : row.LAST_JOURNAL_AT
              ? new Date(row.LAST_JOURNAL_AT as any)
              : null,
      }),
    );
  }

  static async getGameJournalEntries(
    userId: string,
    gameId: number,
    params?: { limit?: number; offset?: number },
  ): Promise<IGameJournalEntry[]> {
    const safeLimit = Math.min(Math.max(params?.limit ?? 5, 1), 25);
    const safeOffset = Math.max(params?.offset ?? 0, 0);
    return dbQuery<{
      ENTRY_ID: number;
      USER_ID: string;
      GAMEDB_GAME_ID: number;
      ENTRY_TITLE: string | null;
      ENTRY_BODY: string;
      CREATED_AT: Date | string;
      UPDATED_AT: Date | string;
      ENTRY_NUMBER: number;
    }, IGameJournalEntry>(
      MemberSql.getGameJournalEntries,
      { userId, gameId, offset: safeOffset, limit: safeLimit },
      (row) => ({
        entryId: Number(row.ENTRY_ID),
        entryNumber: Number(row.ENTRY_NUMBER),
        userId: row.USER_ID,
        gameId: Number(row.GAMEDB_GAME_ID),
        title: row.ENTRY_TITLE ?? null,
        body: row.ENTRY_BODY,
        createdAt: row.CREATED_AT instanceof Date ? row.CREATED_AT : new Date(row.CREATED_AT),
        updatedAt: row.UPDATED_AT instanceof Date ? row.UPDATED_AT : new Date(row.UPDATED_AT),
      }),
    );
  }

  static async countGameJournalEntries(userId: string, gameId: number): Promise<number> {
    const rows = await dbQuery<{ CNT: number }, number>(
      MemberSql.countGameJournalEntries,
      { userId, gameId },
      (row) => Number(row.CNT),
    );
    return rows[0] ?? 0;
  }

  static async addGameJournalEntry(params: {
    userId: string;
    gameId: number;
    title?: string | null;
    body: string;
  }): Promise<void> {
    const titleValue = params.title?.trim() ? params.title.trim() : null;
    const bodyValue = params.body.trim();
    if (!bodyValue) {
      throw new Error("Journal body cannot be empty.");
    }
    await dbMutate(
      MemberSql.addGameJournalEntry,
      {
        userId: params.userId,
        gameId: params.gameId,
        title: titleValue,
        body: bodyValue,
      },
    );
  }

  static async getGameJournalEntryForUser(
    userId: string,
    entryId: number,
  ): Promise<IGameJournalEntry | null> {
    const rows = await dbQuery<{
      ENTRY_ID: number;
      USER_ID: string;
      GAMEDB_GAME_ID: number;
      ENTRY_TITLE: string | null;
      ENTRY_BODY: string;
      CREATED_AT: Date | string;
      UPDATED_AT: Date | string;
      ENTRY_NUMBER: number;
    }, IGameJournalEntry>(
      MemberSql.getGameJournalEntryForUser,
      { userId, entryId },
      (row) => ({
        entryId: Number(row.ENTRY_ID),
        entryNumber: Number(row.ENTRY_NUMBER),
        userId: row.USER_ID,
        gameId: Number(row.GAMEDB_GAME_ID),
        title: row.ENTRY_TITLE ?? null,
        body: row.ENTRY_BODY,
        createdAt: row.CREATED_AT instanceof Date ? row.CREATED_AT : new Date(row.CREATED_AT),
        updatedAt: row.UPDATED_AT instanceof Date ? row.UPDATED_AT : new Date(row.UPDATED_AT),
      }),
    );
    const row = rows[0];
    if (!row) return null;
    return row;
  }

  static async updateGameJournalEntry(params: {
    userId: string;
    entryId: number;
    title?: string | null;
    body?: string;
  }): Promise<boolean> {
    const fields: string[] = [];
    const binds: Record<string, unknown> = {
      userId: params.userId,
      entryId: params.entryId,
    };

    if (params.title !== undefined) {
      fields.push("ENTRY_TITLE = :title");
      binds.title = params.title?.trim() ? params.title.trim() : null;
    }
    if (params.body !== undefined) {
      const bodyValue = params.body.trim();
      if (!bodyValue) {
        throw new Error("Journal body cannot be empty.");
      }
      fields.push("ENTRY_BODY = :body");
      binds.body = bodyValue;
    }
    if (!fields.length) return false;
    fields.push("UPDATED_AT = SYSTIMESTAMP");

    const count = await dbMutate(
      MemberSql.updateGameJournalEntry(fields),
      binds as Record<string, any>,
    );
    return count > 0;
  }

  static async deleteGameJournalEntry(userId: string, entryId: number): Promise<boolean> {
    const count = await dbMutate(
      MemberSql.deleteGameJournalEntry,
      { userId, entryId },
    );
    return count > 0;
  }

  static async updateNowPlayingSort(
    userId: string,
    orderedGameIds: number[],
  ): Promise<boolean> {
    if (!orderedGameIds.length) return false;
    let totalAffected = 0;
    await dbTransaction(async (conn) => {
      for (let idx = 0; idx < orderedGameIds.length; idx += 1) {
        const affected = await dbMutateConn(
          conn,
          MemberSql.updateNowPlayingSort,
          { userId, gameId: orderedGameIds[idx], sortOrder: idx + 1 },
        );
        totalAffected += affected;
      }
    });
    return totalAffected > 0;
  }

  static async removeNowPlaying(userId: string, gameId: number): Promise<boolean> {
    if (!Number.isInteger(gameId) || gameId <= 0) {
      throw new Error("Invalid GameDB id.");
    }

    const count = await dbMutate(
      MemberSql.removeNowPlaying,
      { userId, gameId },
    );
    return count > 0;
  }

  static async addCompletion(params: {
    userId: string;
    gameId: number;
    completionType: string;
    platformId: number | null;
    completedAt?: Date | null;
    finalPlaytimeHours?: number | null;
    note?: string | null;
  }): Promise<number> {
    const {
      userId,
      gameId,
      completionType,
      platformId,
      completedAt,
      finalPlaytimeHours,
      note,
    } = params;
    if (!Number.isInteger(gameId) || gameId <= 0) {
      throw new Error("Invalid GameDB id.");
    }
    if (platformId != null && (!Number.isInteger(platformId) || platformId <= 0)) {
      throw new Error("Invalid platform selection.");
    }
    if (finalPlaytimeHours != null) {
      if (!Number.isFinite(finalPlaytimeHours) || finalPlaytimeHours < 0) {
        throw new Error("Playtime must be a non-negative number.");
      }
      const maxPlaytime = 999999.99;
      if (finalPlaytimeHours > maxPlaytime) {
        throw new Error(`Playtime must be ${maxPlaytime} hours or less.`);
      }
      const rounded = Math.round(finalPlaytimeHours * 100) / 100;
      if (Math.abs(finalPlaytimeHours - rounded) > 0.000001) {
        throw new Error("Playtime must have at most 2 decimal places.");
      }
    }
    const normalizedNote = note?.trim();
    const noteValue = normalizedNote ? normalizedNote : null;

    return dbTransaction(async (conn) => {
      const id = await dbInsertConn(
        conn,
        MemberSql.addCompletion,
        {
          userId,
          gameId,
          type: completionType,
          platformId,
          completedAt: completedAt ?? null,
          playtime: finalPlaytimeHours ?? null,
          note: noteValue,
        },
        "completionId",
      );

      if (!id) throw new Error("Failed to save completion (no id returned).");

      const verify = await dbQueryConn(
        conn,
        MemberSql.verifyCompletion,
        { id, userId },
        (row: { CNT: number }) => Number(row.CNT),
      );
      const exists = (verify[0] ?? 0) > 0;
      if (!exists) {
        throw new Error("Completion insert verification failed (row not found after insert).");
      }

      return Number(id);
    });
  }

  static async getCompletion(completionId: number): Promise<ICompletionRecord | null> {
    const rows = await dbQuery<{
      COMPLETION_ID: number;
      GAME_ID: number;
      TITLE: string;
      COMPLETION_TYPE: string;
      PLATFORM_ID: number | null;
      COMPLETED_AT: Date | null;
      FINAL_PLAYTIME_HRS: number | null;
      CREATED_AT: Date;
      THREAD_ID: string | null;
      NOTE: string | null;
    }, ICompletionRecord>(
      MemberSql.getCompletion,
      { completionId },
      (row) => ({
        completionId: Number(row.COMPLETION_ID),
        gameId: Number(row.GAME_ID),
        title: String(row.TITLE),
        completionType: String(row.COMPLETION_TYPE),
        platformId: row.PLATFORM_ID ? Number(row.PLATFORM_ID) : null,
        completedAt:
          row.COMPLETED_AT instanceof Date
            ? row.COMPLETED_AT
            : row.COMPLETED_AT
              ? new Date(row.COMPLETED_AT as any)
              : null,
        finalPlaytimeHours:
          row.FINAL_PLAYTIME_HRS == null ? null : Number(row.FINAL_PLAYTIME_HRS),
        createdAt:
          row.CREATED_AT instanceof Date
            ? row.CREATED_AT
            : row.CREATED_AT
              ? new Date(row.CREATED_AT as any)
              : new Date(),
        threadId: row.THREAD_ID ?? null,
        note: row.NOTE ?? null,
      }),
    );

    return rows[0] ?? null;
  }

  static async getCompletionForUser(
    userId: string,
    completionId: number,
  ): Promise<ICompletionRecord | null> {
    const rows = await dbQuery<{
      COMPLETION_ID: number;
      GAME_ID: number;
      TITLE: string;
      COMPLETION_TYPE: string;
      PLATFORM_ID: number | null;
      COMPLETED_AT: Date | null;
      FINAL_PLAYTIME_HRS: number | null;
      CREATED_AT: Date;
      THREAD_ID: string | null;
      NOTE: string | null;
    }, ICompletionRecord>(
      MemberSql.getCompletionForUser,
      { userId, completionId },
      (row) => ({
        completionId: Number(row.COMPLETION_ID),
        gameId: Number(row.GAME_ID),
        title: String(row.TITLE),
        completionType: String(row.COMPLETION_TYPE),
        platformId: row.PLATFORM_ID ? Number(row.PLATFORM_ID) : null,
        completedAt:
          row.COMPLETED_AT instanceof Date
            ? row.COMPLETED_AT
            : row.COMPLETED_AT
              ? new Date(row.COMPLETED_AT as any)
              : null,
        finalPlaytimeHours:
          row.FINAL_PLAYTIME_HRS == null ? null : Number(row.FINAL_PLAYTIME_HRS),
        createdAt:
          row.CREATED_AT instanceof Date
            ? row.CREATED_AT
            : row.CREATED_AT
              ? new Date(row.CREATED_AT as any)
              : new Date(),
        threadId: row.THREAD_ID ?? null,
        note: row.NOTE ?? null,
      }),
    );

    return rows[0] ?? null;
  }

  static async getCompletionByGameId(
    userId: string,
    gameId: number,
  ): Promise<ICompletionRecord | null> {
    if (!Number.isInteger(gameId) || gameId <= 0) {
      throw new Error("Invalid GameDB id.");
    }
    const rows = await dbQuery<{
      COMPLETION_ID: number;
      GAME_ID: number;
      TITLE: string;
      COMPLETION_TYPE: string;
      PLATFORM_ID: number | null;
      COMPLETED_AT: Date | null;
      FINAL_PLAYTIME_HRS: number | null;
      CREATED_AT: Date;
      THREAD_ID: string | null;
      NOTE: string | null;
    }, ICompletionRecord>(
      MemberSql.getCompletionByGameId,
      { userId, gameId },
      (row) => ({
        completionId: Number(row.COMPLETION_ID),
        gameId: Number(row.GAME_ID),
        title: String(row.TITLE),
        completionType: String(row.COMPLETION_TYPE),
        platformId: row.PLATFORM_ID ? Number(row.PLATFORM_ID) : null,
        completedAt:
          row.COMPLETED_AT instanceof Date
            ? row.COMPLETED_AT
            : row.COMPLETED_AT
              ? new Date(row.COMPLETED_AT as any)
              : null,
        finalPlaytimeHours:
          row.FINAL_PLAYTIME_HRS == null ? null : Number(row.FINAL_PLAYTIME_HRS),
        createdAt:
          row.CREATED_AT instanceof Date
            ? row.CREATED_AT
            : row.CREATED_AT
              ? new Date(row.CREATED_AT as any)
              : new Date(),
        threadId: row.THREAD_ID ?? null,
        note: row.NOTE ?? null,
      }),
    );

    return rows[0] ?? null;
  }

  static async getCompletions(params: {
    userId: string;
    limit: number;
    offset?: number;
    year?: number | "unknown" | null;
    title?: string;
  }): Promise<ICompletionRecord[]> {
    const { userId, limit, offset = 0, year = null, title } = params;
    const safeLimit = Math.min(Math.max(limit, 1), 1000);
    const safeOffset = Math.max(offset, 0);

    const clauses: string[] = ["c.USER_ID = :userId"];
    const binds: Record<string, any> = { userId, limit: safeLimit, offset: safeOffset };
    if (year === "unknown") {
      clauses.push("c.COMPLETED_AT IS NULL");
    } else if (typeof year === "number") {
      clauses.push("EXTRACT(YEAR FROM c.COMPLETED_AT) = :year");
      binds.year = year;
    }
    if (title) {
      clauses.push("UPPER(g.TITLE) LIKE '%' || UPPER(:title) || '%'");
      binds.title = title;
    }

    return dbQuery<{
      COMPLETION_ID: number;
      GAME_ID: number;
      TITLE: string;
      COMPLETION_TYPE: string;
      PLATFORM_ID: number | null;
      COMPLETED_AT: Date | null;
      FINAL_PLAYTIME_HRS: number | null;
      CREATED_AT: Date;
      THREAD_ID: string | null;
      NOTE: string | null;
    }, ICompletionRecord>(
      MemberSql.getCompletions(clauses.join(" AND ")),
      binds,
      (row) => ({
        completionId: Number(row.COMPLETION_ID),
        gameId: Number(row.GAME_ID),
        title: String(row.TITLE),
        completionType: String(row.COMPLETION_TYPE),
        platformId: row.PLATFORM_ID ? Number(row.PLATFORM_ID) : null,
        completedAt:
          row.COMPLETED_AT instanceof Date
            ? row.COMPLETED_AT
            : row.COMPLETED_AT
              ? new Date(row.COMPLETED_AT as any)
              : null,
        finalPlaytimeHours:
          row.FINAL_PLAYTIME_HRS == null ? null : Number(row.FINAL_PLAYTIME_HRS),
        createdAt:
          row.CREATED_AT instanceof Date
            ? row.CREATED_AT
            : row.CREATED_AT
              ? new Date(row.CREATED_AT as any)
              : new Date(),
        threadId: row.THREAD_ID ?? null,
        note: row.NOTE ?? null,
      }),
    );
  }

  static async getAllCompletions(userId: string): Promise<ICompletionRecord[]> {
    return dbQuery<{
      COMPLETION_ID: number;
      GAME_ID: number;
      TITLE: string;
      COMPLETION_TYPE: string;
      PLATFORM_ID: number | null;
      COMPLETED_AT: Date | null;
      FINAL_PLAYTIME_HRS: number | null;
      CREATED_AT: Date;
      THREAD_ID: string | null;
      NOTE: string | null;
    }, ICompletionRecord>(
      MemberSql.getAllCompletions,
      { userId },
      (row) => ({
        completionId: Number(row.COMPLETION_ID),
        gameId: Number(row.GAME_ID),
        title: String(row.TITLE),
        completionType: String(row.COMPLETION_TYPE),
        platformId: row.PLATFORM_ID ? Number(row.PLATFORM_ID) : null,
        completedAt:
          row.COMPLETED_AT instanceof Date
            ? row.COMPLETED_AT
            : row.COMPLETED_AT
              ? new Date(row.COMPLETED_AT as any)
              : null,
        finalPlaytimeHours:
          row.FINAL_PLAYTIME_HRS == null ? null : Number(row.FINAL_PLAYTIME_HRS),
        createdAt:
          row.CREATED_AT instanceof Date
            ? row.CREATED_AT
            : row.CREATED_AT
              ? new Date(row.CREATED_AT as any)
              : new Date(),
        threadId: row.THREAD_ID ?? null,
        note: row.NOTE ?? null,
      }),
    );
  }

  static async countCompletions(
    userId: string,
    year?: number | "unknown" | null,
    title?: string,
  ): Promise<number> {
    const clauses: string[] = ["c.USER_ID = :userId"];
    const binds: Record<string, any> = { userId };
    if (year === "unknown") {
      clauses.push("c.COMPLETED_AT IS NULL");
    } else if (typeof year === "number") {
      clauses.push("EXTRACT(YEAR FROM c.COMPLETED_AT) = :year");
      binds.year = year;
    }
    if (title) {
      clauses.push("UPPER(g.TITLE) LIKE '%' || UPPER(:title) || '%'");
      binds.title = title;
    }

    const rows = await dbQuery<{ CNT: number }, number>(
      MemberSql.countCompletions(clauses.join(" AND ")),
      binds,
      (row) => Number(row.CNT),
    );
    return rows[0] ?? 0;
  }

  static async updateCompletion(
    userId: string,
    completionId: number,
    updates: Partial<{
      completionType: string;
      completedAt: Date | null;
      platformId: number | null;
      finalPlaytimeHours: number | null;
      note: string | null;
    }>,
  ): Promise<boolean> {
    if (!Number.isInteger(completionId) || completionId <= 0) {
      throw new Error("Invalid completion id.");
    }

    const fields: string[] = [];
    const binds: Record<string, any> = { userId, completionId };

    if (updates.completionType !== undefined) {
      fields.push("COMPLETION_TYPE = :type");
      binds.type = updates.completionType;
    }
    if (updates.completedAt !== undefined) {
      fields.push("COMPLETED_AT = :completedAt");
      binds.completedAt = updates.completedAt;
    }
    if (updates.platformId !== undefined) {
      if (updates.platformId != null &&
        (!Number.isInteger(updates.platformId) || updates.platformId <= 0)) {
        throw new Error("Invalid platform selection.");
      }
      fields.push("PLATFORM_ID = :platformId");
      binds.platformId = updates.platformId;
    }
    if (updates.finalPlaytimeHours !== undefined) {
      fields.push("FINAL_PLAYTIME_HRS = :playtime");
      binds.playtime = updates.finalPlaytimeHours;
    }
    if (updates.note !== undefined) {
      fields.push("NOTE = :note");
      const normalizedNote = updates.note?.trim();
      binds.note = normalizedNote ? normalizedNote : null;
    }

    if (!fields.length) return false;

    const count = await dbMutate(
      MemberSql.updateCompletion(fields),
      binds,
    );
    return count > 0;
  }

  static async deleteCompletion(userId: string, completionId: number): Promise<boolean> {
    if (!Number.isInteger(completionId) || completionId <= 0) {
      throw new Error("Invalid completion id.");
    }
    const count = await dbMutate(
      MemberSql.deleteCompletion,
      { completionId, userId },
    );
    return count > 0;
  }

  static async getRecentNickHistory(
    userId: string,
    limit: number = 5,
  ): Promise<IMemberNickHistory[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 20);
    try {
      return await dbQuery<{
        OLD_NICK: string | null;
        NEW_NICK: string | null;
        CHANGED_AT: Date;
      }, IMemberNickHistory>(
        MemberSql.getRecentNickHistory,
        { userId, limit: safeLimit },
        (row) => ({
          oldNick: row.OLD_NICK ?? null,
          newNick: row.NEW_NICK ?? null,
          changedAt: row.CHANGED_AT,
        }),
      );
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.error(`[Member] Failed to load nick history for ${userId}: ${msg}`);
      return [];
    }
  }

  static async getCompletionLeaderboard(
    limit: number = 25,
    title?: string,
  ): Promise<{
    userId: string;
    username: string | null;
    globalName: string | null;
    count: number;
  }[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const clauses: string[] = ["u.SERVER_LEFT_AT IS NULL"];
    const binds: Record<string, any> = { limit: safeLimit };
    if (title) {
      clauses.push("UPPER(g.TITLE) LIKE '%' || UPPER(:title) || '%'");
      binds.title = title;
    }

    return dbQuery<{
      USER_ID: string;
      USERNAME: string | null;
      GLOBAL_NAME: string | null;
      CNT: number;
    }, { userId: string; username: string | null; globalName: string | null; count: number }>(
      MemberSql.getCompletionLeaderboard(clauses.join(" AND ")),
      binds,
      (row) => ({
        userId: row.USER_ID,
        username: row.USERNAME ?? null,
        globalName: row.GLOBAL_NAME ?? null,
        count: Number(row.CNT),
      }),
    );
  }

  static async search(filters: IMemberSearchFilters): Promise<IMemberSearchResult[]> {
    const safeLimit = Math.min(Math.max(filters.limit ?? 50, 1), 100);
    const clauses: string[] = [];
    const params: Record<string, any> = { limit: safeLimit };

    const addLike = (column: string, param: string, value?: string): void => {
      if (!value) return;
      clauses.push(`UPPER(${column}) LIKE '%' || UPPER(:${param}) || '%'`);
      params[param] = value;
    };

    const addBool = (column: string, param: string, value?: boolean): void => {
      if (value === undefined) return;
      clauses.push(`${column} = :${param}`);
      params[param] = value ? 1 : 0;
    };

    addLike("USER_ID", "userId", filters.userId);
    addLike("USERNAME", "username", filters.username);
    addLike("GLOBAL_NAME", "globalName", filters.globalName);
    addLike("COMPLETIONATOR_URL", "completionatorUrl", filters.completionatorUrl);
    addLike("STEAM_URL", "steamUrl", filters.steamUrl);
    addLike("PSN_USERNAME", "psnUsername", filters.psnUsername);
    addLike("XBL_USERNAME", "xblUsername", filters.xblUsername);
    addLike("NSW_FRIEND_CODE", "nswFriendCode", filters.nswFriendCode);

    addBool("ROLE_ADMIN", "roleAdmin", filters.roleAdmin);
    addBool("ROLE_MODERATOR", "roleModerator", filters.roleModerator);
    addBool("ROLE_REGULAR", "roleRegular", filters.roleRegular);
    addBool("ROLE_MEMBER", "roleMember", filters.roleMember);
    addBool("ROLE_NEWCOMER", "roleNewcomer", filters.roleNewcomer);
    addBool("IS_BOT", "isBot", filters.isBot);

    if (!filters.includeDeparted) {
      clauses.push("SERVER_LEFT_AT IS NULL");
    }

    if (filters.joinedAfter) {
      clauses.push("SERVER_JOINED_AT >= :joinedAfter");
      params.joinedAfter = filters.joinedAfter;
    }

    if (filters.joinedBefore) {
      clauses.push("SERVER_JOINED_AT <= :joinedBefore");
      params.joinedBefore = filters.joinedBefore;
    }

    if (filters.lastSeenAfter) {
      clauses.push("LAST_SEEN_AT >= :lastSeenAfter");
      params.lastSeenAfter = filters.lastSeenAfter;
    }

    if (filters.lastSeenBefore) {
      clauses.push("LAST_SEEN_AT <= :lastSeenBefore");
      params.lastSeenBefore = filters.lastSeenBefore;
    }

    const where = clauses.length ? clauses.join(" AND ") : "1=1";

    return dbQuery<{
      USER_ID: string;
      USERNAME: string | null;
      GLOBAL_NAME: string | null;
      IS_BOT: number;
      COMPLETIONATOR_URL: string | null;
      STEAM_URL: string | null;
      PSN_USERNAME: string | null;
      XBL_USERNAME: string | null;
      NSW_FRIEND_CODE: string | null;
      ROLE_ADMIN: number;
      ROLE_MODERATOR: number;
      ROLE_REGULAR: number;
      ROLE_MEMBER: number;
      ROLE_NEWCOMER: number;
      SERVER_LEFT_AT: Date | null;
      SERVER_JOINED_AT: Date | null;
      LAST_SEEN_AT: Date | null;
    }, IMemberSearchResult>(
      MemberSql.searchMembers(where),
      params,
      (row) => ({
        userId: row.USER_ID,
        username: row.USERNAME ?? null,
        globalName: row.GLOBAL_NAME ?? null,
        isBot: row.IS_BOT,
        completionatorUrl: row.COMPLETIONATOR_URL ?? null,
        steamUrl: row.STEAM_URL ?? null,
        psnUsername: row.PSN_USERNAME ?? null,
        xblUsername: row.XBL_USERNAME ?? null,
        nswFriendCode: row.NSW_FRIEND_CODE ?? null,
        roleAdmin: row.ROLE_ADMIN,
        roleModerator: row.ROLE_MODERATOR,
        roleRegular: row.ROLE_REGULAR,
        roleMember: row.ROLE_MEMBER,
        roleNewcomer: row.ROLE_NEWCOMER,
        serverLeftAt: row.SERVER_LEFT_AT ?? null,
        serverJoinedAt: row.SERVER_JOINED_AT ?? null,
        lastSeenAt: row.LAST_SEEN_AT ?? null,
      }),
    );
  }

  static async setMessageCount(userId: string, count: number): Promise<void> {
    void userId;
    void count;
    return;
  }

  static async recordMessageActivity(
    userId: string,
    when: Date = new Date(),
  ): Promise<void> {
    void userId;
    void when;
    return;
  }

  static async getByUserId(userId: string): Promise<IMemberRecord | null> {
    type MemberRow = {
      USER_ID: string; IS_BOT: number; USERNAME: string | null; GLOBAL_NAME: string | null;
      AVATAR_BLOB: Buffer | null; SERVER_JOINED_AT: Date | null; SERVER_LEFT_AT: Date | null;
      LAST_SEEN_AT: Date | null; ROLE_ADMIN: number; ROLE_MODERATOR: number;
      ROLE_REGULAR: number; ROLE_MEMBER: number; ROLE_NEWCOMER: number;
      MESSAGE_COUNT: number | null; COMPLETIONATOR_URL: string | null;
      PSN_USERNAME: string | null; XBL_USERNAME: string | null; NSW_FRIEND_CODE: string | null;
      STEAM_URL: string | null; PROFILE_IMAGE: Buffer | null; PROFILE_IMAGE_AT: Date | null;
    };
    const mapRow = (row: MemberRow): IMemberRecord => ({
      userId: row.USER_ID,
      isBot: row.IS_BOT,
      username: row.USERNAME ?? null,
      globalName: row.GLOBAL_NAME ?? null,
      avatarBlob: row.AVATAR_BLOB ?? null,
      serverJoinedAt: row.SERVER_JOINED_AT ?? null,
      serverLeftAt: row.SERVER_LEFT_AT ?? null,
      lastSeenAt: row.LAST_SEEN_AT ?? null,
      roleAdmin: row.ROLE_ADMIN,
      roleModerator: row.ROLE_MODERATOR,
      roleRegular: row.ROLE_REGULAR,
      roleMember: row.ROLE_MEMBER,
      roleNewcomer: row.ROLE_NEWCOMER,
      messageCount: row.MESSAGE_COUNT ?? null,
      completionatorUrl: row.COMPLETIONATOR_URL ?? null,
      psnUsername: row.PSN_USERNAME ?? null,
      xblUsername: row.XBL_USERNAME ?? null,
      nswFriendCode: row.NSW_FRIEND_CODE ?? null,
      steamUrl: row.STEAM_URL ?? null,
      profileImage: row.PROFILE_IMAGE ?? null,
      profileImageAt: row.PROFILE_IMAGE_AT ?? null,
    });
    return dbWithConnection(async (conn) => {
      if (dialect === "oracle") {
        const result = await (conn as oracledb.Connection).execute<MemberRow>(
          MemberSql.getByUserId.oracle,
          { userId },
          {
            outFormat: oracledb.OUT_FORMAT_OBJECT,
            fetchInfo: {
              AVATAR_BLOB: { type: oracledb.BUFFER },
              PROFILE_IMAGE: { type: oracledb.BUFFER },
            },
          },
        );
        const row = (result.rows ?? [])[0];
        return row ? mapRow(row) : null;
      }
      const rows = await dbQueryConn<MemberRow, IMemberRecord>(
        conn, MemberSql.getByUserId, { userId }, mapRow,
      );
      return rows[0] ?? null;
    });
  }

  static async updateNowPlayingPlatform(
    userId: string,
    gameId: number,
    platformId: number,
  ): Promise<boolean> {
    if (!Number.isInteger(gameId) || gameId <= 0) {
      throw new Error("Invalid GameDB id.");
    }
    if (!Number.isInteger(platformId) || platformId <= 0) {
      throw new Error("Invalid platform selection.");
    }
    const count = await dbMutate(
      MemberSql.updateNowPlayingPlatform,
      { userId, gameId, platformId },
    );
    return count > 0;
  }

  static async getAvatarHistory(
    userId: string,
    limit: number = 10,
    offset: number = 0,
  ): Promise<IAvatarHistoryRecord[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const safeOffset = Math.max(offset, 0);
    type AvatarHistoryRow = {
      EVENT_ID: number; USER_ID: string; AVATAR_HASH: string | null;
      AVATAR_URL: string | null; AVATAR_BLOB: Buffer | null; CHANGED_AT: Date | string;
    };
    const mapRow = (row: AvatarHistoryRow): IAvatarHistoryRecord => ({
      eventId: Number(row.EVENT_ID),
      userId: String(row.USER_ID),
      avatarHash: row.AVATAR_HASH ?? null,
      avatarUrl: row.AVATAR_URL ?? null,
      avatarBlob: row.AVATAR_BLOB ?? null,
      changedAt: row.CHANGED_AT instanceof Date ? row.CHANGED_AT : new Date(row.CHANGED_AT as any),
    });
    return dbWithConnection(async (conn) => {
      if (dialect === "oracle") {
        const result = await (conn as oracledb.Connection).execute<AvatarHistoryRow>(
          MemberSql.getAvatarHistory.oracle,
          { userId, limit: safeLimit, offset: safeOffset },
          {
            outFormat: oracledb.OUT_FORMAT_OBJECT,
            fetchInfo: { AVATAR_BLOB: { type: oracledb.BUFFER } },
          },
        );
        return (result.rows ?? []).map(mapRow);
      }
      return dbQueryConn<AvatarHistoryRow, IAvatarHistoryRecord>(
        conn,
        MemberSql.getAvatarHistory,
        { userId, limit: safeLimit, offset: safeOffset },
        mapRow,
      );
    });
  }

  static async getCompletionsForGame(
    userId: string,
    gameId: number,
  ): Promise<ICompletionRecord[]> {
    if (!Number.isInteger(gameId) || gameId <= 0) {
      throw new Error("Invalid GameDB id.");
    }
    return dbQuery<{
      COMPLETION_ID: number;
      GAME_ID: number;
      TITLE: string;
      COMPLETION_TYPE: string;
      PLATFORM_ID: number | null;
      COMPLETED_AT: Date | null;
      FINAL_PLAYTIME_HRS: number | null;
      CREATED_AT: Date;
      THREAD_ID: string | null;
      NOTE: string | null;
    }, ICompletionRecord>(
      MemberSql.getCompletionsForGame,
      { userId, gameId },
      (row) => ({
        completionId: Number(row.COMPLETION_ID),
        gameId: Number(row.GAME_ID),
        title: String(row.TITLE),
        completionType: String(row.COMPLETION_TYPE),
        platformId: row.PLATFORM_ID ? Number(row.PLATFORM_ID) : null,
        completedAt:
          row.COMPLETED_AT instanceof Date
            ? row.COMPLETED_AT
            : row.COMPLETED_AT
              ? new Date(row.COMPLETED_AT as any)
              : null,
        finalPlaytimeHours:
          row.FINAL_PLAYTIME_HRS == null ? null : Number(row.FINAL_PLAYTIME_HRS),
        createdAt:
          row.CREATED_AT instanceof Date
            ? row.CREATED_AT
            : row.CREATED_AT
              ? new Date(row.CREATED_AT as any)
              : new Date(),
        threadId: row.THREAD_ID ?? null,
        note: row.NOTE ?? null,
      }),
    );
  }

  static async getRecentCompletionForGame(
    userId: string,
    gameId: number,
    referenceDate: Date,
    windowDays: number = 7,
  ): Promise<ICompletionRecord | null> {
    if (!Number.isInteger(gameId) || gameId <= 0) {
      throw new Error("Invalid GameDB id.");
    }
    const ref = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
    const windowMs = windowDays * 24 * 60 * 60 * 1000;
    const startDate = new Date(ref.getTime() - windowMs);
    const endDate = new Date(ref.getTime() + windowMs);

    const rows = await dbQuery<{
      COMPLETION_ID: number;
      GAME_ID: number;
      TITLE: string;
      COMPLETION_TYPE: string;
      PLATFORM_ID: number | null;
      COMPLETED_AT: Date | null;
      FINAL_PLAYTIME_HRS: number | null;
      CREATED_AT: Date;
      THREAD_ID: string | null;
      NOTE: string | null;
    }, ICompletionRecord>(
      MemberSql.getRecentCompletionForGame,
      { userId, gameId, startDate, endDate },
      (row) => ({
        completionId: Number(row.COMPLETION_ID),
        gameId: Number(row.GAME_ID),
        title: String(row.TITLE),
        completionType: String(row.COMPLETION_TYPE),
        platformId: row.PLATFORM_ID ? Number(row.PLATFORM_ID) : null,
        completedAt:
          row.COMPLETED_AT instanceof Date
            ? row.COMPLETED_AT
            : row.COMPLETED_AT
              ? new Date(row.COMPLETED_AT as any)
              : null,
        finalPlaytimeHours:
          row.FINAL_PLAYTIME_HRS == null ? null : Number(row.FINAL_PLAYTIME_HRS),
        createdAt:
          row.CREATED_AT instanceof Date
            ? row.CREATED_AT
            : row.CREATED_AT
              ? new Date(row.CREATED_AT as any)
              : new Date(),
        threadId: row.THREAD_ID ?? null,
        note: row.NOTE ?? null,
      }),
    );

    return rows[0] ?? null;
  }

  static async getGiveawayDonorNotifySetting(userId: string): Promise<boolean> {
    const rows = await dbQuery<{ DONOR_NOTIFY_ON_CLAIM: number | null }, boolean>(
      MemberSql.getGiveawayDonorNotifySetting,
      { userId },
      (row) => Boolean(row.DONOR_NOTIFY_ON_CLAIM),
    );
    return rows[0] ?? false;
  }

  static async setGiveawayDonorNotifySetting(
    userId: string,
    enabled: boolean,
  ): Promise<void> {
    const params = { userId, enabled: enabled ? 1 : 0 };
    const updated = await dbMutate(MemberSql.updateGiveawayDonorNotifySetting, params);
    if (updated > 0) return;

    try {
      await dbMutate(MemberSql.insertGiveawayDonorNotifySetting, params);
    } catch (err: any) {
      const code = err?.code ?? err?.errorNum;
      if (code === "ORA-00001") {
        await dbMutate(MemberSql.updateGiveawayDonorNotifySetting, params);
      } else {
        throw err;
      }
    }
  }

  static async countAvatarHistory(userId: string): Promise<number> {
    const rows = await dbQuery<{ TOTAL: number | null }, number>(
      MemberSql.countAvatarHistory,
      { userId },
      (row) => Number(row.TOTAL ?? 0),
    );
    return rows[0] ?? 0;
  }

  static async insertAvatarHistoryRecord(
    userId: string,
    avatarHash: string,
    avatarUrl: string,
    avatarBlob: Buffer | null,
  ): Promise<void> {
    await dbMutate(
      MemberSql.insertAvatarHistoryRecord,
      { userId, avatarHash, avatarUrl, avatarBlob },
    );
  }

  static async getAllMembersAvatarHistoryCounts(): Promise<IMemberAvatarHistoryCount[]> {
    return dbQuery<{
      USER_ID: string;
      USERNAME: string | null;
      GLOBAL_NAME: string | null;
      TOTAL: number;
    }, IMemberAvatarHistoryCount>(
      MemberSql.getAllMembersAvatarHistoryCounts,
      {},
      (row) => ({
        userId: String(row.USER_ID),
        username: row.USERNAME ?? null,
        globalName: row.GLOBAL_NAME ?? null,
        count: Number(row.TOTAL),
      }),
    );
  }

  static async getMembersWithPlatforms(): Promise<IMemberPlatformRecord[]> {
    const members = await dbQuery<{
      USER_ID: string;
      USERNAME: string | null;
      GLOBAL_NAME: string | null;
      STEAM_URL: string | null;
      PSN_USERNAME: string | null;
      XBL_USERNAME: string | null;
      NSW_FRIEND_CODE: string | null;
      SERVER_LEFT_AT: Date | null;
    }, IMemberPlatformRecord>(
      MemberSql.getMembersWithPlatforms,
      {},
      (row) => ({
        userId: row.USER_ID,
        username: row.USERNAME ?? null,
        globalName: row.GLOBAL_NAME ?? null,
        steamUrl: row.STEAM_URL ?? null,
        psnUsername: row.PSN_USERNAME ?? null,
        xblUsername: row.XBL_USERNAME ?? null,
        nswFriendCode: row.NSW_FRIEND_CODE ?? null,
      }),
    );

    return members.sort((a, b) => {
      const aName = (a.globalName ?? a.username ?? a.userId).toLowerCase();
      const bName = (b.globalName ?? b.username ?? b.userId).toLowerCase();
      return aName.localeCompare(bName);
    });
  }

  static async upsert(record: IMemberRecord): Promise<void> {
    const params = buildParams(record);

    const rowsUpdated = await dbMutate(MemberSql.updateMember, params);
    if (rowsUpdated > 0) return;

    try {
      await dbMutate(MemberSql.insertMember, params);
    } catch (insErr: any) {
      const code = insErr?.code ?? insErr?.errorNum;
      if (code === "ORA-00001") {
        await dbMutate(MemberSql.updateMember, params);
      } else {
        throw insErr;
      }
    }
  }

  static async markDepartedNotIn(userIds: string[]): Promise<number> {
    if (!userIds.length) return 0;

    const chunkSize = 999; // Oracle IN clause limit per statement (safe)
    let totalUpdated = 0;

    for (let i = 0; i < userIds.length; i += chunkSize) {
      const chunk = userIds.slice(i, i + chunkSize);
      const binds: Record<string, string> = {};
      const placeholders = chunk.map((id, idx) => {
        const key = `id${idx}`;
        binds[key] = id;
        return `:${key}`;
      });

      const affected = await dbMutate(MemberSql.markDepartedNotIn(placeholders.join(", ")), binds);
      totalUpdated += affected;
    }

    return totalUpdated;
  }

  static async getGameJournalList(userId: string): Promise<IGameJournalListEntry[]> {
    return dbQuery<{
      GAME_ID: number;
      TITLE: string;
      TOTAL_ENTRIES: number;
    }, IGameJournalListEntry>(
      MemberSql.getGameJournalList,
      { userId },
      (row) => ({
        gameId: Number(row.GAME_ID),
        title: row.TITLE,
        totalEntries: Number(row.TOTAL_ENTRIES ?? 0),
      }),
    );
  }

  static async getAllJournalUsers(): Promise<IJournalUserSummary[]> {
    return dbQuery<{
      USER_ID: string;
      USERNAME: string | null;
      GLOBAL_NAME: string | null;
      GAME_COUNT: number;
      ENTRY_COUNT: number;
    }, IJournalUserSummary>(
      MemberSql.getAllJournalUsers,
      {},
      (row) => ({
        userId: row.USER_ID,
        username: row.USERNAME ?? null,
        globalName: row.GLOBAL_NAME ?? null,
        gameCount: Number(row.GAME_COUNT ?? 0),
        entryCount: Number(row.ENTRY_COUNT ?? 0),
      }),
    );
  }

  static async searchJournalEntries(params: {
    query: string;
    userId?: string;
    gameId?: number;
    limit: number;
    offset: number;
  }): Promise<{ rows: IJournalSearchResult[]; total: number }> {
    const safeLimit = Math.min(Math.max(params.limit, 1), 25);
    const safeOffset = Math.max(params.offset, 0);
    const searchTerm = params.query.trim();
    const rows = await dbQuery<{
      TOTAL_COUNT: number;
      ENTRY_ID: number;
      USER_ID: string;
      GLOBAL_NAME: string | null;
      USERNAME: string | null;
      GAMEDB_GAME_ID: number;
      GAME_TITLE: string;
      ENTRY_TITLE: string | null;
      ENTRY_BODY: string;
      CREATED_AT: Date | string;
    }, IJournalSearchResult & { totalCount: number }>(
      MemberSql.searchJournalEntries,
      {
        searchTerm,
        userId: params.userId ?? null,
        gameId: params.gameId ?? null,
        offset: safeOffset,
        limit: safeLimit,
      },
      (row) => ({
        totalCount: Number(row.TOTAL_COUNT),
        entryId: Number(row.ENTRY_ID),
        userId: row.USER_ID,
        globalName: row.GLOBAL_NAME ?? null,
        username: row.USERNAME ?? null,
        gameId: Number(row.GAMEDB_GAME_ID),
        gameTitle: row.GAME_TITLE,
        entryTitle: row.ENTRY_TITLE ?? null,
        body: row.ENTRY_BODY,
        createdAt: row.CREATED_AT instanceof Date
          ? row.CREATED_AT
          : new Date(row.CREATED_AT),
      }),
    );
    const total = rows.length > 0 ? rows[0].totalCount : 0;
    return {
      total,
      rows: rows.map((row): IJournalSearchResult => ({
        entryId: row.entryId,
        userId: row.userId,
        globalName: row.globalName,
        username: row.username,
        gameId: row.gameId,
        gameTitle: row.gameTitle,
        entryTitle: row.entryTitle,
        body: row.body,
        createdAt: row.createdAt,
      })),
    };
  }

  static async updateEmojiName(userId: string, emojiName: string | null): Promise<void> {
    await dbMutate(
      MemberSql.updateEmojiName,
      { userId, emojiName },
    );
  }

  static async getAllWithEmojiName(): Promise<Array<{ userId: string; emojiName: string }>> {
    return dbQuery<{ USER_ID: string; EMOJI_NAME: string },
      { userId: string; emojiName: string }>(
      MemberSql.getAllWithEmojiName,
      {},
      (row) => ({
        userId: row.USER_ID,
        emojiName: row.EMOJI_NAME,
      }),
    );
  }

  static async upsertJournalMessageContext(
    channelId: string,
    messageId: string,
    createdAtMs: number,
    ownerUserId: string,
    gameId: number,
  ): Promise<void> {
    await dbMutate(
      MemberSql.upsertJournalMessageContext,
      { channelId, messageId, createdAtMs, ownerUserId, gameId },
    );
  }

  static async deleteJournalMessageContext(channelId: string, messageId: string): Promise<void> {
    await dbMutate(
      MemberSql.deleteJournalMessageContext,
      { channelId, messageId },
    );
  }

  static async loadActiveJournalMessageContexts(
    ttlMs: number,
  ): Promise<Array<{
    channelId: string;
    messageId: string;
    createdAt: number;
    ownerUserId: string;
    gameId: number;
  }>> {
    const cutoffMs = Date.now() - ttlMs;
    return dbQuery<{
      CHANNEL_ID: string;
      MESSAGE_ID: string;
      CREATED_AT_MS: number;
      OWNER_USER_ID: string;
      GAME_ID: number;
    }, { channelId: string; messageId: string; createdAt: number;
        ownerUserId: string; gameId: number }>(
      MemberSql.loadActiveJournalMessageContexts,
      { cutoffMs },
      (row) => ({
        channelId: row.CHANNEL_ID,
        messageId: row.MESSAGE_ID,
        createdAt: Number(row.CREATED_AT_MS),
        ownerUserId: row.OWNER_USER_ID,
        gameId: Number(row.GAME_ID),
      }),
    );
  }

  static async pruneExpiredJournalMessageContexts(ttlMs: number): Promise<void> {
    const cutoffMs = Date.now() - ttlMs;
    await dbMutate(
      MemberSql.pruneExpiredJournalMessageContexts,
      { cutoffMs },
    );
  }
}
