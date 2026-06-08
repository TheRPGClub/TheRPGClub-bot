import { oraQuery, oraMutate, oraTransaction, oraWithConnection } from "../db/SqlManager.js";

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
    `MERGE INTO THREADS t
     USING (
       SELECT
         :threadId       AS THREAD_ID,
         :forumChannelId AS FORUM_CHANNEL_ID,
         :threadName     AS THREAD_NAME,
         :isArchived     AS IS_ARCHIVED,
         :createdAt      AS CREATED_AT,
         :lastSeenAt     AS LAST_SEEN_AT,
         :skipLinking    AS SKIP_LINKING
       FROM DUAL
     ) s
     ON (t.THREAD_ID = s.THREAD_ID)
     WHEN MATCHED THEN UPDATE SET
       t.THREAD_NAME      = s.THREAD_NAME,
       t.FORUM_CHANNEL_ID = s.FORUM_CHANNEL_ID,
       t.IS_ARCHIVED      = s.IS_ARCHIVED,
       t.LAST_SEEN_AT     = s.LAST_SEEN_AT
     WHEN NOT MATCHED THEN INSERT (
       THREAD_ID, FORUM_CHANNEL_ID, THREAD_NAME, IS_ARCHIVED,
       CREATED_AT, LAST_SEEN_AT, SKIP_LINKING
     ) VALUES (
       s.THREAD_ID, s.FORUM_CHANNEL_ID, s.THREAD_NAME, s.IS_ARCHIVED,
       s.CREATED_AT, s.LAST_SEEN_AT, s.SKIP_LINKING
     )`,
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
        `DELETE FROM THREAD_GAME_LINKS WHERE THREAD_ID = :threadId`,
        { threadId },
        conn,
      );
    } else {
      await oraMutate(
        `MERGE INTO THREAD_GAME_LINKS tgt
         USING (
           SELECT :threadId AS THREAD_ID, :gameId AS GAMEDB_GAME_ID FROM DUAL
         ) src
         ON (tgt.THREAD_ID = src.THREAD_ID AND tgt.GAMEDB_GAME_ID = src.GAMEDB_GAME_ID)
         WHEN NOT MATCHED THEN
           INSERT (THREAD_ID, GAMEDB_GAME_ID, LINKED_AT)
           VALUES (src.THREAD_ID, src.GAMEDB_GAME_ID, SYSTIMESTAMP)`,
        { threadId, gameId },
        conn,
      );
    }

    await oraMutate(
      `UPDATE THREADS t
       SET GAMEDB_GAME_ID = (
         SELECT MIN(g.GAMEDB_GAME_ID)
           FROM THREAD_GAME_LINKS g
          WHERE g.THREAD_ID = t.THREAD_ID
       )
       WHERE t.THREAD_ID = :threadId`,
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
      `DELETE FROM THREAD_GAME_LINKS
       WHERE THREAD_ID = :threadId
       ${gameId ? "AND GAMEDB_GAME_ID = :gameId" : ""}`,
      gameId ? { threadId, gameId } : { threadId },
      conn,
    );

    await oraMutate(
      `UPDATE THREADS t
       SET GAMEDB_GAME_ID = (
         SELECT MIN(g.GAMEDB_GAME_ID)
           FROM THREAD_GAME_LINKS g
          WHERE g.THREAD_ID = t.THREAD_ID
       )
       WHERE t.THREAD_ID = :threadId`,
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
    `UPDATE THREADS
        SET SKIP_LINKING = :skip
      WHERE THREAD_ID = :threadId`,
    { skip: toYN(skip), threadId },
  );
}

export async function getThreadSkipLinking(threadId: string): Promise<boolean> {
  const rows = await oraQuery(
    `SELECT SKIP_LINKING FROM THREADS WHERE THREAD_ID = :threadId`,
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
      `SELECT SKIP_LINKING FROM THREADS WHERE THREAD_ID = :threadId`,
      { threadId },
      (row: { SKIP_LINKING: string }) =>
        String(row.SKIP_LINKING ?? "N").toUpperCase() === "Y",
      conn,
    );

    const gameIds = await oraQuery(
      `SELECT GAMEDB_GAME_ID FROM THREAD_GAME_LINKS WHERE THREAD_ID = :threadId`,
      { threadId },
      (row: { GAMEDB_GAME_ID: number }) => Number(row.GAMEDB_GAME_ID),
      conn,
    );

    if (!gameIds.length) {
      const legacyIds = await oraQuery(
        `SELECT GAMEDB_GAME_ID FROM THREADS WHERE THREAD_ID = :threadId`,
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
      `SELECT THREAD_ID FROM THREAD_GAME_LINKS WHERE GAMEDB_GAME_ID = :gameId`,
      { gameId },
      (row: { THREAD_ID: string }) => String(row.THREAD_ID),
      conn,
    );

    const legacyIds = await oraQuery(
      `SELECT THREAD_ID FROM THREADS WHERE GAMEDB_GAME_ID = :gameId`,
      { gameId },
      (row: { THREAD_ID: string }) => String(row.THREAD_ID),
      conn,
    );

    return Array.from(new Set([...threadIds, ...legacyIds]));
  });
}
