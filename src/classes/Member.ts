import {
  dbQuery,
  dbMutate,
  dbWithConnection,
  dbQueryConn,
} from "../db/SqlManager.js";
import { MemberSql } from "../db/sql/index.js";
import { isPositiveInt, requirePositiveInt } from "../utilities/ValidationUtils.js";
import { logError } from "../utilities/LogUtils.js";
import { apiGet, apiPost, apiPatch, apiDelete } from "../services/RpgClubApiClient.js";

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

// --- Journal API types (data: as_json from JournalEntry*/JournaledGame) ---

type JournalEntryApiData = {
  entry_id: number;
  user_id: string;
  gamedb_game_id: number;
  entry_title: string | null;
  entry_body: string;
  created_at: string;
  updated_at: string;
};

type JournalEntryListResponse = {
  data: JournalEntryApiData[];
  meta: { count: number };
};

type JournalEntryShowResponse = {
  data: JournalEntryApiData;
};

type JournaledGameApiData = {
  game: { game_id: number; title: string };
  entry_count: number;
  last_entry_at: string | null;
};

type JournaledGameListResponse = {
  data: JournaledGameApiData[];
  meta: { count: number; pages: number };
};

type JournalStatusApiData = {
  gamedb_game_id: number;
  entry_count: number;
  last_entry_at: string | null;
};

type JournalStatusListResponse = {
  data: JournalStatusApiData[];
};

type JournalContributorApiData = {
  user_id: string;
  username: string | null;
  global_name: string | null;
  game_count: number;
  entry_count: number;
};

type JournalContributorListResponse = {
  data: JournalContributorApiData[];
  meta: { pages: number };
};

type JournalEntryGameUserApiData = JournalEntryApiData & {
  game: { game_id: number; title: string };
  user: { user_id: string; username: string | null; global_name: string | null };
};

type JournalEntrySearchResponse = {
  data: JournalEntryGameUserApiData[];
  meta: { count: number; pages: number };
};

// --- Now Playing API types ---

type NowPlayingGameApiData = {
  game_id: number;
  title: string;
  linked_thread_id: string | null;
};

type NowPlayingPlatformApiData = {
  platform_id: number;
  platform_name: string;
  platform_abbreviation: string | null;
};

type NowPlayingEntryApiData = {
  entry_id: number;
  user_id: string;
  gamedb_game_id: number | null;
  platform_id: number | null;
  note: string | null;
  sort_order: number | null;
  added_at: string;
  note_updated_at: string | null;
  has_journal_entry: boolean;
  journal_count: number;
  last_journal_at: string | null;
  game: NowPlayingGameApiData | null;
  platform: NowPlayingPlatformApiData | null;
};

type NowPlayingEntryListResponse = {
  data: NowPlayingEntryApiData[];
  meta: { count: number; pages: number };
};

type NowPlayingMemberEntryApiData = NowPlayingEntryApiData & {
  user: {
    user_id: string;
    username: string | null;
    global_name: string | null;
  };
};

type NowPlayingMemberListResponse = {
  data: NowPlayingMemberEntryApiData[];
  meta: { count: number; pages: number; next: string | null };
};

function mapNowPlayingEntry(raw: NowPlayingEntryApiData): IMemberNowPlayingEntry {
  return {
    gameId: Number(raw.gamedb_game_id),
    title: raw.game?.title ?? "",
    platformId: raw.platform_id == null ? null : Number(raw.platform_id),
    platformName: raw.platform?.platform_name ?? null,
    platformAbbreviation: raw.platform?.platform_abbreviation ?? null,
    threadId: raw.game?.linked_thread_id ?? null,
    note: raw.note ?? null,
    addedAt: new Date(raw.added_at),
    noteUpdatedAt: raw.note_updated_at ? new Date(raw.note_updated_at) : null,
    sortOrder: raw.sort_order == null ? null : Number(raw.sort_order),
    journalEnabled: true,
    hasJournalEntry: raw.has_journal_entry,
    journalCount: Number(raw.journal_count),
    lastJournalAt: raw.last_journal_at ? new Date(raw.last_journal_at) : null,
  };
}

function mapJournalEntry(
  raw: JournalEntryApiData,
  entryNumber: number,
): IGameJournalEntry {
  return {
    entryId: Number(raw.entry_id),
    entryNumber,
    userId: raw.user_id,
    gameId: Number(raw.gamedb_game_id),
    title: raw.entry_title ?? null,
    body: raw.entry_body,
    createdAt: new Date(raw.created_at),
    updatedAt: new Date(raw.updated_at),
  };
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

const MAX_NOW_PLAYING = 10;

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

type MemberRow = {
  USER_ID: string; IS_BOT: number; USERNAME: string | null; GLOBAL_NAME: string | null;
  AVATAR_BLOB: Buffer | null; SERVER_JOINED_AT: Date | null; SERVER_LEFT_AT: Date | null;
  LAST_SEEN_AT: Date | null; ROLE_ADMIN: number; ROLE_MODERATOR: number;
  ROLE_REGULAR: number; ROLE_MEMBER: number; ROLE_NEWCOMER: number;
  MESSAGE_COUNT: number | null; COMPLETIONATOR_URL: string | null;
  PSN_USERNAME: string | null; XBL_USERNAME: string | null; NSW_FRIEND_CODE: string | null;
  STEAM_URL: string | null; PROFILE_IMAGE: Buffer | null; PROFILE_IMAGE_AT: Date | null;
};

function mapMemberRow(row: MemberRow): IMemberRecord {
  return {
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
  };
}

type AvatarHistoryRow = {
  EVENT_ID: number; USER_ID: string; AVATAR_HASH: string | null;
  AVATAR_URL: string | null; AVATAR_BLOB: Buffer | null; CHANGED_AT: Date | string;
};

function mapAvatarHistoryRow(row: AvatarHistoryRow): IAvatarHistoryRecord {
  return {
    eventId: Number(row.EVENT_ID),
    userId: String(row.USER_ID),
    avatarHash: row.AVATAR_HASH ?? null,
    avatarUrl: row.AVATAR_URL ?? null,
    avatarBlob: row.AVATAR_BLOB ?? null,
    changedAt: row.CHANGED_AT instanceof Date ? row.CHANGED_AT : new Date(row.CHANGED_AT as string),
  };
}

// --- API types for completion endpoints ---

type CompletionApiData = {
  completion_id: number;
  user_id: string;
  gamedb_game_id: number;
  platform_id: number | null;
  note: string | null;
  completion_type: string;
  completed_at: string | null;
  final_playtime_hrs: number | null;
  created_at: string;
  game: { game_id: number; title: string } | null;
  platform: { platform_id: number; platform_name: string } | null;
};

type CompletionResponse = { data: CompletionApiData };

type CompletionListResponse = {
  data: CompletionApiData[];
  meta: { count: number };
};

type CompletionLeaderboardApiData = {
  user_id: string;
  username: string | null;
  global_name: string | null;
  completion_count: number;
};

type CompletionLeaderboardResponse = { data: CompletionLeaderboardApiData[] };

function mapCompletionApiData(d: CompletionApiData): ICompletionRecord {
  return {
    completionId: Number(d.completion_id),
    gameId: Number(d.gamedb_game_id),
    title: d.game?.title ?? `Game #${d.gamedb_game_id}`,
    completionType: String(d.completion_type),
    platformId: d.platform_id != null ? Number(d.platform_id) : null,
    completedAt: d.completed_at ? new Date(d.completed_at) : null,
    finalPlaytimeHours: d.final_playtime_hrs != null ? Number(d.final_playtime_hrs) : null,
    createdAt: d.created_at ? new Date(d.created_at) : new Date(0),
    // thread_id is not part of the API serializer; no completion caller reads it
    threadId: null,
    note: d.note ?? null,
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
      logError("Member.updateLastSeen", msg);
    }
  }

  private static async fetchNowPlayingRaw(
    userId: string,
  ): Promise<NowPlayingEntryApiData[]> {
    const response = await apiGet<NowPlayingEntryListResponse>(
      `/api/v1/users/${userId}/now_playing`,
      { params: { per: 50 } },
    );
    return response?.data ?? [];
  }

  static async getNowPlaying(
    userId: string,
  ): Promise<IMemberNowPlayingEntry[]> {
    const entries = await Member.fetchNowPlayingRaw(userId);
    return entries
      .filter((e) => e.gamedb_game_id != null)
      .map(mapNowPlayingEntry);
  }

  static async getAllNowPlaying(): Promise<IMemberNowPlayingList[]> {
    const grouped = new Map<string, IMemberNowPlayingList>();
    let page = 1;
    const per = 100;

    while (true) {
      const response = await apiGet<NowPlayingMemberListResponse>(
        "/api/v1/now_playing",
        { params: { page, per } },
      );
      if (!response) break;

      for (const raw of response.data) {
        if (raw.gamedb_game_id == null) continue;
        let record = grouped.get(raw.user_id);
        if (!record) {
          record = {
            userId: raw.user_id,
            username: raw.user?.username ?? null,
            globalName: raw.user?.global_name ?? null,
            entries: [],
          };
          grouped.set(raw.user_id, record);
        }
        record.entries.push(mapNowPlayingEntry(raw));
      }

      if (page >= response.meta.pages) break;
      page += 1;
    }

    return Array.from(grouped.values()).sort((a, b) => {
      const aName = (a.globalName ?? a.username ?? a.userId).toLowerCase();
      const bName = (b.globalName ?? b.username ?? b.userId).toLowerCase();
      return aName.localeCompare(bName);
    });
  }

  static async getNowPlayingByTitleSearch(
    query: string,
  ): Promise<{ gameId: number; title: string; userId: string; username: string | null;
    globalName: string | null }[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const response = await apiGet<NowPlayingMemberListResponse>(
      "/api/v1/now_playing",
      { params: { q: trimmed, per: 50 } },
    );
    return (response?.data ?? [])
      .filter((e) => e.gamedb_game_id != null)
      .map((e) => ({
        gameId: Number(e.gamedb_game_id),
        title: e.game?.title ?? "",
        userId: e.user_id,
        username: e.user?.username ?? null,
        globalName: e.user?.global_name ?? null,
      }));
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
    const entries = await Member.fetchNowPlayingRaw(userId);
    return entries
      .filter((e) => e.gamedb_game_id != null)
      .map((e) => ({
        gameId: Number(e.gamedb_game_id),
        title: e.game?.title ?? "",
        platformId: e.platform_id == null ? null : Number(e.platform_id),
        platformName: e.platform?.platform_name ?? null,
        platformAbbreviation: e.platform?.platform_abbreviation ?? null,
        note: e.note ?? null,
        addedAt: new Date(e.added_at),
        noteUpdatedAt: e.note_updated_at ? new Date(e.note_updated_at) : null,
        sortOrder: e.sort_order == null ? null : Number(e.sort_order),
        journalEnabled: true,
        hasJournalEntry: e.has_journal_entry,
      }));
  }

  static async getNowPlayingEntryMeta(
    userId: string,
    gameId: number,
  ): Promise<{ addedAt: Date | null } | null> {
    requirePositiveInt(gameId, "GameDB id");
    const entries = await Member.fetchNowPlayingRaw(userId);
    const entry = entries.find((e) => Number(e.gamedb_game_id) === gameId);
    if (!entry) return null;
    return { addedAt: new Date(entry.added_at) };
  }

  static async updateNowPlayingNote(
    userId: string,
    gameId: number,
    note: string | null,
  ): Promise<boolean> {
    requirePositiveInt(gameId, "GameDB id");
    const entries = await Member.fetchNowPlayingRaw(userId);
    const entry = entries.find((e) => Number(e.gamedb_game_id) === gameId);
    if (!entry) return false;
    const noteValue = note?.trim() || null;
    const result = await apiPatch<{ data: NowPlayingEntryApiData }>(
      `/api/v1/now_playing/${entry.entry_id}`,
      { data: { note: noteValue } },
    );
    return result != null;
  }

  static async addNowPlaying(
    userId: string,
    gameId: number,
    platformId: number,
    note: string | null = null,
  ): Promise<void> {
    requirePositiveInt(gameId, "GameDB id");
    requirePositiveInt(platformId, "platform selection");
    const noteValue = note?.trim() || null;

    const existing = await Member.fetchNowPlayingRaw(userId);
    if (existing.length >= MAX_NOW_PLAYING) {
      throw new Error(`You can only track up to ${MAX_NOW_PLAYING} Now Playing titles.`);
    }
    if (existing.some((e) => Number(e.gamedb_game_id) === gameId)) {
      throw new Error("That title is already in your Now Playing list.");
    }

    await apiPost<{ data: NowPlayingEntryApiData }>(
      `/api/v1/users/${userId}/now_playing`,
      { data: { gamedb_game_id: gameId, platform_id: platformId, note: noteValue } },
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
    const uniqueIds = [...new Set(gameIds.filter(isPositiveInt))];
    if (!uniqueIds.length) return [];
    const response = await apiGet<JournalStatusListResponse>(
      `/api/v1/users/${userId}/journal/status`,
      { params: { "game_ids[]": uniqueIds } },
    );
    const byGameId = new Map(
      (response?.data ?? []).map((row) => [Number(row.gamedb_game_id), row]),
    );
    return uniqueIds.map((gameId) => {
      const row = byGameId.get(gameId);
      return {
        gameId,
        journalCount: row ? Number(row.entry_count) : 0,
        lastJournalAt: row?.last_entry_at ? new Date(row.last_entry_at) : null,
      };
    });
  }

  static async getGameJournalEntries(
    userId: string,
    gameId: number,
    params?: { limit?: number; offset?: number; viewerUserId?: string | null },
  ): Promise<IGameJournalEntry[]> {
    const safeLimit = Math.min(Math.max(params?.limit ?? 5, 1), 25);
    const safeOffset = Math.max(params?.offset ?? 0, 0);
    // Callers always pass an offset that is a multiple of limit (page-aligned),
    // so per/page slicing returns the same window as the old LIMIT/OFFSET query.
    const page = Math.floor(safeOffset / safeLimit) + 1;
    const response = await apiGet<JournalEntryListResponse>(
      `/api/v1/games/${gameId}/journal`,
      { params: { user_id: userId, page, per: safeLimit } },
    );
    if (!response) return [];
    const total = Number(response.meta?.count ?? 0);
    // API list is created_at DESC; entry_number is the ascending (oldest = 1)
    // rank, so the newest entry carries the highest number.
    return response.data.map((raw, idx) =>
      mapJournalEntry(raw, total - safeOffset - idx),
    );
  }

  static async countGameJournalEntries(
    userId: string,
    gameId: number,
    viewerUserId?: string | null,
  ): Promise<number> {
    // viewerUserId is reserved for viewer-scoped filtering; not yet used here
    void viewerUserId;
    const response = await apiGet<JournalEntryListResponse>(
      `/api/v1/games/${gameId}/journal`,
      { params: { user_id: userId, per: 1 } },
    );
    return Number(response?.meta?.count ?? 0);
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
    await apiPost<JournalEntryShowResponse>(
      `/api/v1/users/${params.userId}/journal`,
      {
        data: {
          gamedb_game_id: params.gameId,
          entry_title: titleValue,
          entry_body: bodyValue,
        },
      },
    );
  }

  static async getGameJournalEntryForUser(
    userId: string,
    entryId: number,
  ): Promise<IGameJournalEntry | null> {
    const response = await apiGet<JournalEntryShowResponse>(
      `/api/v1/journal_entries/${entryId}`,
    );
    if (!response || response.data.user_id !== userId) return null;
    const raw = response.data;
    const entryNumber = await this.resolveJournalEntryNumber(
      userId,
      Number(raw.gamedb_game_id),
      Number(raw.entry_id),
    );
    return mapJournalEntry(raw, entryNumber);
  }

  // entry_number is the ascending (oldest = 1) rank within the user's entries
  // for a game; the API does not return it, so derive it from the DESC-ordered
  // list. Approximate above 500 entries -- it only feeds an `Entry #N` label.
  private static async resolveJournalEntryNumber(
    userId: string,
    gameId: number,
    entryId: number,
  ): Promise<number> {
    const response = await apiGet<JournalEntryListResponse>(
      `/api/v1/games/${gameId}/journal`,
      { params: { user_id: userId, per: 500 } },
    );
    if (!response) return 1;
    const total = Number(response.meta?.count ?? response.data.length);
    const descIndex = response.data.findIndex(
      (item) => Number(item.entry_id) === entryId,
    );
    if (descIndex < 0) return 1;
    return total - descIndex;
  }

  static async updateGameJournalEntry(params: {
    userId: string;
    entryId: number;
    title?: string | null;
    body?: string;
  }): Promise<boolean> {
    const data: Record<string, string | null> = {};

    if (params.title !== undefined) {
      data.entry_title = params.title?.trim() ? params.title.trim() : null;
    }
    if (params.body !== undefined) {
      const bodyValue = params.body.trim();
      if (!bodyValue) {
        throw new Error("Journal body cannot be empty.");
      }
      data.entry_body = bodyValue;
    }
    if (!Object.keys(data).length) return false;

    // Verify ownership before mutating -- the API keys edits off the entry id.
    const existing = await apiGet<JournalEntryShowResponse>(
      `/api/v1/journal_entries/${params.entryId}`,
    );
    if (!existing || existing.data.user_id !== params.userId) return false;

    const response = await apiPatch<JournalEntryShowResponse>(
      `/api/v1/journal_entries/${params.entryId}`,
      { data },
    );
    return response != null;
  }

  static async deleteGameJournalEntry(userId: string, entryId: number): Promise<boolean> {
    // Verify ownership before deleting -- the API keys deletes off the entry id.
    const existing = await apiGet<JournalEntryShowResponse>(
      `/api/v1/journal_entries/${entryId}`,
    );
    if (!existing || existing.data.user_id !== userId) return false;
    const result = await apiDelete<{ deleted: boolean }>(
      `/api/v1/journal_entries/${entryId}`,
    );
    return result?.deleted === true;
  }

  static async updateNowPlayingSort(
    userId: string,
    orderedGameIds: number[],
  ): Promise<boolean> {
    if (!orderedGameIds.length) return false;
    const entries = await Member.fetchNowPlayingRaw(userId);
    const entryIdByGameId = new Map(
      entries
        .filter((e) => e.gamedb_game_id != null)
        .map((e) => [Number(e.gamedb_game_id), e.entry_id]),
    );
    let patched = 0;
    for (let idx = 0; idx < orderedGameIds.length; idx += 1) {
      const entryId = entryIdByGameId.get(orderedGameIds[idx]);
      if (!entryId) continue;
      const result = await apiPatch<{ data: NowPlayingEntryApiData }>(
        `/api/v1/now_playing/${entryId}`,
        { data: { sort_order: idx + 1 } },
      );
      if (result != null) patched += 1;
    }
    return patched > 0;
  }

  static async removeNowPlaying(userId: string, gameId: number): Promise<boolean> {
    requirePositiveInt(gameId, "GameDB id");
    const entries = await Member.fetchNowPlayingRaw(userId);
    const entry = entries.find((e) => Number(e.gamedb_game_id) === gameId);
    if (!entry) return false;
    const result = await apiDelete<{ deleted: boolean }>(
      `/api/v1/now_playing/${entry.entry_id}`,
    );
    return result?.deleted === true;
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
    requirePositiveInt(gameId, "GameDB id");
    if (platformId != null && !isPositiveInt(platformId)) {
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

    const response = await apiPost<CompletionResponse>(
      `/api/v1/users/${userId}/completions`,
      {
        data: {
          gamedb_game_id: gameId,
          completion_type: completionType,
          platform_id: platformId,
          completed_at: completedAt ?? null,
          final_playtime_hrs: finalPlaytimeHours ?? null,
          note: noteValue,
        },
      },
    );

    if (!response) throw new Error("Failed to save completion (no response from API).");
    return Number(response.data.completion_id);
  }

  static async getCompletion(completionId: number): Promise<ICompletionRecord | null> {
    requirePositiveInt(completionId, "completion id");
    const response = await apiGet<CompletionResponse>(`/api/v1/completions/${completionId}`);
    if (!response) return null;
    return mapCompletionApiData(response.data);
  }

  static async getCompletionForUser(
    userId: string,
    completionId: number,
  ): Promise<ICompletionRecord | null> {
    requirePositiveInt(completionId, "completion id");
    const response = await apiGet<CompletionResponse>(`/api/v1/completions/${completionId}`);
    if (!response) return null;
    if (response.data.user_id !== userId) return null;
    return mapCompletionApiData(response.data);
  }

  // Fetch a user's completions from the API, paging in blocks of `per` (max 500).
  // `maxRecords` undefined means fetch every page; `skip` drops leading records.
  private static async fetchUserCompletions(
    userId: string,
    params: Record<string, string | number>,
    opts: { maxRecords?: number; skip?: number } = {},
  ): Promise<ICompletionRecord[]> {
    const { maxRecords, skip = 0 } = opts;
    const PER = 500;
    const need = maxRecords == null ? Infinity : skip + maxRecords;
    const per = Number.isFinite(need) ? Math.min(need, PER) : PER;
    const out: ICompletionRecord[] = [];
    let page = 1;
    while (out.length < need) {
      const response = await apiGet<CompletionListResponse>(
        `/api/v1/users/${userId}/completions`,
        { params: { ...params, page, per } },
      );
      if (!response || response.data.length === 0) break;
      for (const d of response.data) out.push(mapCompletionApiData(d));
      if (response.data.length < per) break;
      page += 1;
    }
    return Number.isFinite(need) ? out.slice(skip, need) : out.slice(skip);
  }

  // Translate the year filter into the API `year` query param: a numeric year as a
  // string, or the literal "unknown" for completions with no `completed_at`.
  private static completionYearParam(
    year?: number | "unknown" | null,
  ): string | undefined {
    if (year === "unknown") return "unknown";
    if (typeof year === "number") return String(year);
    return undefined;
  }

  static async getCompletionByGameId(
    userId: string,
    gameId: number,
  ): Promise<ICompletionRecord | null> {
    requirePositiveInt(gameId, "GameDB id");
    const rows = await Member.fetchUserCompletions(
      userId,
      { game_id: gameId },
      { maxRecords: 1 },
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

    const query: Record<string, string | number> = {};
    const yearParam = Member.completionYearParam(year);
    if (yearParam !== undefined) query.year = yearParam;
    if (title) query.q = title;

    return Member.fetchUserCompletions(userId, query, {
      maxRecords: safeLimit,
      skip: safeOffset,
    });
  }

  static async getAllCompletions(userId: string): Promise<ICompletionRecord[]> {
    return Member.fetchUserCompletions(userId, {});
  }

  static async countCompletions(
    userId: string,
    year?: number | "unknown" | null,
    title?: string,
  ): Promise<number> {
    const query: Record<string, string | number> = { per: 1 };
    const yearParam = Member.completionYearParam(year);
    if (yearParam !== undefined) query.year = yearParam;
    if (title) query.q = title;

    const response = await apiGet<CompletionListResponse>(
      `/api/v1/users/${userId}/completions`,
      { params: query },
    );
    return Number(response?.meta?.count ?? 0);
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
    requirePositiveInt(completionId, "completion id");

    if (updates.platformId !== undefined) {
      if (updates.platformId != null && !isPositiveInt(updates.platformId)) {
        throw new Error("Invalid platform selection.");
      }
    }

    const body: Record<string, string | number | Date | null | undefined> = {};
    if (updates.completionType !== undefined) body.completion_type = updates.completionType;
    if (updates.completedAt !== undefined) body.completed_at = updates.completedAt;
    if (updates.platformId !== undefined) body.platform_id = updates.platformId;
    if (updates.finalPlaytimeHours !== undefined) {
      body.final_playtime_hrs = updates.finalPlaytimeHours;
    }
    if (updates.note !== undefined) {
      const normalizedNote = updates.note?.trim();
      body.note = normalizedNote ? normalizedNote : null;
    }

    if (!Object.keys(body).length) return false;

    // Verify ownership before mutating (service token bypasses Rails require_owner! guard)
    const existing = await apiGet<CompletionResponse>(`/api/v1/completions/${completionId}`);
    if (!existing || existing.data.user_id !== userId) return false;

    const response = await apiPatch<CompletionResponse>(
      `/api/v1/completions/${completionId}`,
      { data: body },
    );
    return response != null;
  }

  static async deleteCompletion(userId: string, completionId: number): Promise<boolean> {
    requirePositiveInt(completionId, "completion id");
    // Verify ownership before deleting (service token bypasses Rails require_owner! guard)
    const existing = await apiGet<CompletionResponse>(`/api/v1/completions/${completionId}`);
    if (!existing || existing.data.user_id !== userId) return false;
    const result = await apiDelete<{ deleted: boolean }>(`/api/v1/completions/${completionId}`);
    return result?.deleted === true;
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
    const query: Record<string, string | number> = { per: safeLimit };
    if (title) query.q = title;

    const response = await apiGet<CompletionLeaderboardResponse>(
      "/api/v1/completions/leaderboard",
      { params: query },
    );
    if (!response) return [];
    return response.data.map((row) => ({
      userId: row.user_id,
      username: row.username ?? null,
      globalName: row.global_name ?? null,
      count: Number(row.completion_count),
    }));
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
    return dbWithConnection(async (conn) => {
      const rows = await dbQueryConn<MemberRow, IMemberRecord>(
        conn, MemberSql.getByUserId, { userId }, mapMemberRow,
      );
      return rows[0] ?? null;
    });
  }

  static async updateNowPlayingPlatform(
    userId: string,
    gameId: number,
    platformId: number,
  ): Promise<boolean> {
    requirePositiveInt(gameId, "GameDB id");
    requirePositiveInt(platformId, "platform selection");
    const entries = await Member.fetchNowPlayingRaw(userId);
    const entry = entries.find((e) => Number(e.gamedb_game_id) === gameId);
    if (!entry) return false;
    const result = await apiPatch<{ data: NowPlayingEntryApiData }>(
      `/api/v1/now_playing/${entry.entry_id}`,
      { data: { platform_id: platformId } },
    );
    return result != null;
  }

  static async getAvatarHistory(
    userId: string,
    limit: number = 10,
    offset: number = 0,
  ): Promise<IAvatarHistoryRecord[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const safeOffset = Math.max(offset, 0);
    return dbWithConnection(async (conn) => {
      return dbQueryConn<AvatarHistoryRow, IAvatarHistoryRecord>(
        conn,
        MemberSql.getAvatarHistory,
        { userId, limit: safeLimit, offset: safeOffset },
        mapAvatarHistoryRow,
      );
    });
  }

  static async getCompletionsForGame(
    userId: string,
    gameId: number,
  ): Promise<ICompletionRecord[]> {
    requirePositiveInt(gameId, "GameDB id");
    return Member.fetchUserCompletions(userId, { game_id: gameId });
  }

  static async getRecentCompletionForGame(
    userId: string,
    gameId: number,
    referenceDate: Date,
    windowDays: number = 7,
  ): Promise<ICompletionRecord | null> {
    requirePositiveInt(gameId, "GameDB id");
    const ref = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
    const windowMs = windowDays * 24 * 60 * 60 * 1000;
    const startDate = new Date(ref.getTime() - windowMs);
    const endDate = new Date(ref.getTime() + windowMs);

    // The API filters on completed_at only; the prior SQL fell back to created_at
    // for entries with no completed_at, which this window cannot replicate.
    const rows = await Member.fetchUserCompletions(
      userId,
      {
        game_id: gameId,
        completed_after: startDate.toISOString(),
        completed_before: endDate.toISOString(),
      },
      { maxRecords: 1 },
    );
    return rows[0] ?? null;
  }

  static async getGiveawayDonorNotifySetting(userId: string): Promise<boolean> {
    const response = await apiGet<{ data: { notify_on_claim: boolean } }>(
      `/api/v1/users/${userId}/giveaway_settings`,
    );
    return response?.data?.notify_on_claim ?? false;
  }

  static async setGiveawayDonorNotifySetting(
    userId: string,
    enabled: boolean,
  ): Promise<void> {
    await apiPatch(`/api/v1/users/${userId}/giveaway_settings`, {
      data: { notify_on_claim: enabled },
    });
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

    const chunkSize = 999; 
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
    const perPage = 500;
    const entries: IGameJournalListEntry[] = [];
    let page = 1;
    let pages = 1;
    do {
      const response = await apiGet<JournaledGameListResponse>(
        `/api/v1/users/${userId}/journal`,
        { params: { page, per: perPage } },
      );
      if (!response) break;
      for (const row of response.data) {
        entries.push({
          gameId: Number(row.game.game_id),
          title: row.game.title,
          totalEntries: Number(row.entry_count ?? 0),
        });
      }
      pages = Number(response.meta?.pages ?? 1);
      page += 1;
    } while (page <= pages);
    return entries;
  }

  static async getAllJournalUsers(): Promise<IJournalUserSummary[]> {
    const results: IJournalUserSummary[] = [];
    let page = 1;
    let pages = 1;
    do {
      const response = await apiGet<JournalContributorListResponse>(
        `/api/v1/journal_entries/contributors`,
        { params: { page, per: 500 } },
      );
      if (!response) break;
      for (const row of response.data) {
        results.push({
          userId: row.user_id,
          username: row.username ?? null,
          globalName: row.global_name ?? null,
          gameCount: Number(row.game_count ?? 0),
          entryCount: Number(row.entry_count ?? 0),
        });
      }
      pages = Number(response.meta?.pages ?? 1);
      page += 1;
    } while (page <= pages);
    return results;
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
    const page = Math.floor(safeOffset / safeLimit) + 1;
    const queryParams: Record<string, string | number | undefined> = {
      q: params.query.trim(),
      page,
      per: safeLimit,
    };
    if (params.userId) queryParams.user_id = params.userId;
    if (params.gameId) queryParams.game_id = params.gameId;
    const response = await apiGet<JournalEntrySearchResponse>(
      `/api/v1/journal_entries`,
      { params: queryParams },
    );
    if (!response) return { rows: [], total: 0 };
    const total = Number(response.meta?.count ?? 0);
    const rows = response.data.map((raw): IJournalSearchResult => ({
      entryId: Number(raw.entry_id),
      userId: raw.user_id,
      globalName: raw.user?.global_name ?? null,
      username: raw.user?.username ?? null,
      gameId: Number(raw.gamedb_game_id),
      gameTitle: raw.game?.title ?? "",
      entryTitle: raw.entry_title ?? null,
      body: raw.entry_body,
      createdAt: new Date(raw.created_at),
    }));
    return { rows, total };
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
