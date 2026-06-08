import { oraQuery, oraMutate, oraTransaction, oraWithConnection } from "../db/SqlManager.js";
import { getDialect } from "../db/dialect.js";
import { getSql } from "../db/SqlManager.js";
import { ThreadSql } from "../db/sql/index.js";

const dialect = getDialect();

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
  await oraMutate(
    getSql(ThreadSql.upsertThread, dialect),
    {
      threadId: params.threadId,
      forumChannelId: params.forumChannelId,
      threadName: params.threadName,
      isArchived: toYN(params.isArchived),
      createdAt: params.createdAt,
      lastSeenAt: params.lastSeenAt,
      skipLinking: params.skipLinking ?? "N",
    },
  );
}

export async function setThreadGameLink(
  threadId: string,
  gameId: number | null,
): Promise<void> {
  if (gameId !== null && (!Number.isInteger(gameId) || gameId <= 0)) {
    throw new Error("Invalid GameDB game id.");
  }

  await oraTransaction(async (conn) => {
    if (gameId === null) {
      await oraMutate(
        getSql(ThreadSql.deleteThreadGameLink, dialect),
        { threadId },
        conn,
      );
    } else {
      await oraMutate(
        getSql(ThreadSql.mergeThreadGameLink, dialect),
        { threadId, gameId },
        conn,
      );
    }

    await oraMutate(
      getSql(ThreadSql.updateThreadsGameId, dialect),
      { threadId },
      conn,
    );
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

  return oraTransaction(async (conn) => {
    const res = await oraMutate(
      ThreadSql.removeThreadGameLinks(!!gameId)[dialect],
      gameId ? { threadId, gameId } : { threadId },
      conn,
    );

    await oraMutate(
      getSql(ThreadSql.updateThreadsGameId, dialect),
      { threadId },
      conn,
    );

    return res.rowsAffected ?? 0;
  });
}

export async function setThreadSkipLinking(
  threadId: string,
  skip: boolean,
): Promise<void> {
  await oraMutate(
    getSql(ThreadSql.setSkipLinking, dialect),
    { skip: toYN(skip), threadId },
  );
}

export async function getThreadSkipLinking(threadId: string): Promise<boolean> {
  const rows = await oraQuery(
    getSql(ThreadSql.getSkipLinking, dialect),
    { threadId },
    (row: { SKIP_LINKING: string }) => String(row.SKIP_LINKING ?? "N").toUpperCase() === "Y",
  );
  return rows[0] ?? false;
}

export async function getThreadLinkInfo(
  threadId: string,
): Promise<{ skipLinking: boolean; gamedbGameIds: number[] }> {
  return oraWithConnection(async (conn) => {
    const [skipFlag] = await oraQuery(
      getSql(ThreadSql.getSkipLinking, dialect),
      { threadId },
      (row: { SKIP_LINKING: string }) =>
        String(row.SKIP_LINKING ?? "N").toUpperCase() === "Y",
      conn,
    );

    const gameIds = await oraQuery(
      getSql(ThreadSql.getThreadGameLinks, dialect),
      { threadId },
      (row: { GAMEDB_GAME_ID: number }) => Number(row.GAMEDB_GAME_ID),
      conn,
    );

    if (!gameIds.length) {
      const legacyIds = await oraQuery(
        getSql(ThreadSql.getLegacyGameId, dialect),
        { threadId },
        (row: { GAMEDB_GAME_ID: number | null }) =>
          row.GAMEDB_GAME_ID != null ? Number(row.GAMEDB_GAME_ID) : null,
        conn,
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
  return oraWithConnection(async (conn) => {
    const threadIds = await oraQuery(
      getSql(ThreadSql.getThreadLinksForGame, dialect),
      { gameId },
      (row: { THREAD_ID: string }) => String(row.THREAD_ID),
      conn,
    );

    const legacyIds = await oraQuery(
      getSql(ThreadSql.getLegacyThreadIdForGame, dialect),
      { gameId },
      (row: { THREAD_ID: string }) => String(row.THREAD_ID),
      conn,
    );

    return Array.from(new Set([...threadIds, ...legacyIds]));
  });
}
