import { apiGet, apiPost, apiPatch, apiDelete } from "../services/RpgClubApiClient.js";
import { isPositiveInt } from "../utilities/ValidationUtils.js";

type NullableDate = Date | null;

type ThreadLinkApiData = {
  gamedb_game_id: number;
};

type ThreadApiData = {
  thread_id: string;
  thread_name: string;
  forum_channel_id: string;
  is_archived: boolean;
  skip_linking: boolean;
  last_seen_at: string | null;
  gamedb_game_id: number | null;
  created_at: string;
  updated_at: string;
  links: ThreadLinkApiData[];
};

type ThreadResponse = { data: ThreadApiData };
type ThreadListApiData = { thread_id: string };
type ThreadListResponse = { data: ThreadListApiData[]; meta: { count: number } };
type ThreadLinkDeleteResponse = { deleted: boolean; count: number };

export async function upsertThreadRecord(params: {
  threadId: string;
  forumChannelId: string;
  threadName: string;
  isArchived: boolean;
  createdAt: Date;
  lastSeenAt: NullableDate;
  skipLinking?: "Y" | "N";
}): Promise<void> {
  await apiPost("/api/v1/threads", {
    data: {
      thread_id: params.threadId,
      forum_channel_id: params.forumChannelId,
      thread_name: params.threadName,
      is_archived: params.isArchived,
      last_seen_at: params.lastSeenAt?.toISOString() ?? null,
      skip_linking: (params.skipLinking ?? "N") === "Y",
    },
  });
}

export async function setThreadGameLink(
  threadId: string,
  gameId: number | null,
): Promise<void> {
  if (gameId !== null && !isPositiveInt(gameId)) {
    throw new Error("Invalid GameDB game id.");
  }

  if (gameId === null) {
    await apiDelete(`/api/v1/threads/${threadId}/links`);
  } else {
    await apiPost(`/api/v1/threads/${threadId}/links`, {
      data: { gamedb_game_id: gameId },
    });
  }
}

export async function removeThreadGameLink(
  threadId: string,
  gameId?: number,
): Promise<number> {
  if (gameId !== undefined && (gameId === null || !isPositiveInt(gameId))) {
    throw new Error("Invalid GameDB game id.");
  }

  const path = gameId != null
    ? `/api/v1/threads/${threadId}/links/${gameId}`
    : `/api/v1/threads/${threadId}/links`;

  const response = await apiDelete<ThreadLinkDeleteResponse>(path);
  return response?.count ?? 0;
}

export async function setThreadSkipLinking(
  threadId: string,
  skip: boolean,
): Promise<void> {
  await apiPatch(`/api/v1/threads/${threadId}`, {
    data: { skip_linking: skip },
  });
}

export async function getThreadSkipLinking(threadId: string): Promise<boolean> {
  const response = await apiGet<ThreadResponse>(`/api/v1/threads/${threadId}`);
  return response?.data.skip_linking ?? false;
}

export async function getThreadLinkInfo(
  threadId: string,
): Promise<{ skipLinking: boolean; gamedbGameIds: number[] }> {
  const response = await apiGet<ThreadResponse>(`/api/v1/threads/${threadId}`);
  if (!response) {
    return { skipLinking: false, gamedbGameIds: [] };
  }
  const gameIds = response.data.links.map((l) => Number(l.gamedb_game_id));
  return {
    skipLinking: response.data.skip_linking ?? false,
    gamedbGameIds: Array.from(new Set(gameIds)),
  };
}

export async function getThreadGameIds(threadId: string): Promise<number[]> {
  const info = await getThreadLinkInfo(threadId);
  return info.gamedbGameIds;
}

export async function getThreadsByGameId(gameId: number): Promise<string[]> {
  const response = await apiGet<ThreadListResponse>(
    `/api/v1/games/${gameId}/threads`,
  );
  if (!response) return [];
  return response.data.map((t) => String(t.thread_id));
}

export default class Thread {
  static getThreadsByGameId = getThreadsByGameId;
}
