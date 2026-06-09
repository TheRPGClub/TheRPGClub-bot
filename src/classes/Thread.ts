import {
  dbQuery,
  dbMutate,
  dbTransaction,
  dbWithConnection,
  dbQueryConn,
  dbMutateConn,
} from "../db/SqlManager.js";
import { ThreadSql } from "../db/sql/index.js";

type NullableDate = Date | null;

function toYN(flag: boolean): string {
  return flag ? "Y" : "N";
}

export async function upsertThreadRecord(params: {
  threadId: string;
  forumChannelId: string;
  threadName: string;
  isArchived: boolean;
  createdAt: Date;
  lastSeenAt: NullableDate;
  skipLinking?: "Y" | "N";
}): Promise<void> {
  await dbMutate(ThreadSql.upsertThread, {
    threadId: params.threadId,
    forumChannelId: params.forumChannelId,
    threadName: params.threadName,
    isArchived: toYN(params.isArchived),
    createdAt: params.createdAt,
    lastSeenAt: params.lastSeenAt,
    skipLinking: params.skipLinking ?? "N",
  });
}

export async function setThreadGameLink(
  threadId: string,
  gameId: number | null,
): Promise<void> {
  if (gameId !== null && (!Number.isInteger(gameId) || gameId <= 0)) {
    throw new Error("Invalid GameDB game id.");
  }

  await dbTransaction(async (conn) => {
    if (gameId === null) {
      await dbMutateConn(conn, ThreadSql.deleteThreadGameLink, { threadId });
    } else {
      await dbMutateConn(conn, ThreadSql.mergeThreadGameLink, { threadId, gameId });
    }

    await dbMutateConn(conn, ThreadSql.updateThreadsGameId, { threadId });
  });
}

export async function removeThreadGameLink(
  threadId: string,
  gameId?: number,
): Promise<number> {
  if (
    gameId !== undefined &&
    (gameId === null || !Number.isInteger(gameId) || gameId <= 0)
  ) {
    throw new Error("Invalid GameDB game id.");
  }

  return dbTransaction(async (conn) => {
    const rowsAffected = await dbMutateConn(
      conn,
      ThreadSql.removeThreadGameLinks(!!gameId),
      gameId ? { threadId, gameId } : { threadId },
    );

    await dbMutateConn(conn, ThreadSql.updateThreadsGameId, { threadId });

    return rowsAffected;
  });
}

export async function setThreadSkipLinking(
  threadId: string,
  skip: boolean,
): Promise<void> {
  await dbMutate(ThreadSql.setSkipLinking, { skip: toYN(skip), threadId });
}

export async function getThreadSkipLinking(threadId: string): Promise<boolean> {
  const rows = await dbQuery(
    ThreadSql.getSkipLinking,
    { threadId },
    (row: { SKIP_LINKING: string }) => String(row.SKIP_LINKING ?? "N").toUpperCase() === "Y",
  );
  return rows[0] ?? false;
}

export async function getThreadLinkInfo(
  threadId: string,
): Promise<{ skipLinking: boolean; gamedbGameIds: number[] }> {
  return dbWithConnection(async (conn) => {
    const [skipFlag] = await dbQueryConn(
      conn,
      ThreadSql.getSkipLinking,
      { threadId },
      (row: { SKIP_LINKING: string }) =>
        String(row.SKIP_LINKING ?? "N").toUpperCase() === "Y",
    );

    const gameIds = await dbQueryConn(
      conn,
      ThreadSql.getThreadGameLinks,
      { threadId },
      (row: { GAMEDB_GAME_ID: number }) => Number(row.GAMEDB_GAME_ID),
    );

    if (!gameIds.length) {
      const legacyIds = await dbQueryConn(
        conn,
        ThreadSql.getLegacyGameId,
        { threadId },
        (row: { GAMEDB_GAME_ID: number | null }) =>
          row.GAMEDB_GAME_ID != null ? Number(row.GAMEDB_GAME_ID) : null,
      );
      for (const id of legacyIds) {
        if (id != null) gameIds.push(id);
      }
    }

    return {
      skipLinking: skipFlag ?? false,
      gamedbGameIds: Array.from(new Set(gameIds)),
    };
  });
}

export async function getThreadGameIds(threadId: string): Promise<number[]> {
  const info = await getThreadLinkInfo(threadId);
  return info.gamedbGameIds;
}

export async function getThreadsByGameId(gameId: number): Promise<string[]> {
  return dbWithConnection(async (conn) => {
    const threadIds = await dbQueryConn(
      conn,
      ThreadSql.getThreadLinksForGame,
      { gameId },
      (row: { THREAD_ID: string }) => String(row.THREAD_ID),
    );

    const legacyIds = await dbQueryConn(
      conn,
      ThreadSql.getLegacyThreadIdForGame,
      { gameId },
      (row: { THREAD_ID: string }) => String(row.THREAD_ID),
    );

    return Array.from(new Set([...threadIds, ...legacyIds]));
  });
}
