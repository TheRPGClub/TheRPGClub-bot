import type { SqlEntry } from "./types.js";

export const ThreadSql = {
  upsertThread: {
    oracle: `MERGE INTO THREADS t
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
    postgres: `INSERT INTO threads
       (thread_id, forum_channel_id, thread_name, is_archived, created_at, last_seen_at, skip_linking)
       VALUES (:threadId, :forumChannelId, :threadName, :isArchived, :createdAt, :lastSeenAt, :skipLinking)
       ON CONFLICT (thread_id) DO UPDATE SET
         thread_name = EXCLUDED.thread_name,
         forum_channel_id = EXCLUDED.forum_channel_id,
         is_archived = EXCLUDED.is_archived,
         last_seen_at = EXCLUDED.last_seen_at`,
  } satisfies SqlEntry,

  deleteThreadGameLink: {
    oracle: `DELETE FROM THREAD_GAME_LINKS WHERE THREAD_ID = :threadId`,
    postgres: `DELETE FROM thread_game_links WHERE thread_id = :threadId`,
  } satisfies SqlEntry,

  mergeThreadGameLink: {
    oracle: `MERGE INTO THREAD_GAME_LINKS tgt
         USING (
           SELECT :threadId AS THREAD_ID, :gameId AS GAMEDB_GAME_ID FROM DUAL
         ) src
         ON (tgt.THREAD_ID = src.THREAD_ID AND tgt.GAMEDB_GAME_ID = src.GAMEDB_GAME_ID)
         WHEN NOT MATCHED THEN
           INSERT (THREAD_ID, GAMEDB_GAME_ID, LINKED_AT)
           VALUES (src.THREAD_ID, src.GAMEDB_GAME_ID, SYSTIMESTAMP)`,
    postgres: `INSERT INTO thread_game_links (thread_id, gamedb_game_id, linked_at)
         VALUES (:threadId, :gameId, NOW())
         ON CONFLICT (thread_id, gamedb_game_id) DO NOTHING`,
  } satisfies SqlEntry,

  updateThreadsGameId: {
    oracle: `UPDATE THREADS t
       SET GAMEDB_GAME_ID = (
         SELECT MIN(g.GAMEDB_GAME_ID)
           FROM THREAD_GAME_LINKS g
          WHERE g.THREAD_ID = t.THREAD_ID
       )
       WHERE t.THREAD_ID = :threadId`,
    postgres: `UPDATE threads
       SET gamedb_game_id = (
         SELECT MIN(g.gamedb_game_id)
           FROM thread_game_links g
          WHERE g.thread_id = threads.thread_id
       )
       WHERE thread_id = :threadId`,
  } satisfies SqlEntry,

  removeThreadGameLinks: (withGameId: boolean) =>
    ({
      oracle: `DELETE FROM THREAD_GAME_LINKS
       WHERE THREAD_ID = :threadId
       ${withGameId ? "AND GAMEDB_GAME_ID = :gameId" : ""}`,
      postgres: `DELETE FROM thread_game_links
       WHERE thread_id = :threadId
       ${withGameId ? "AND gamedb_game_id = :gameId" : ""}`,
    }) satisfies SqlEntry,

  setSkipLinking: {
    oracle: `UPDATE THREADS
        SET SKIP_LINKING = :skip
      WHERE THREAD_ID = :threadId`,
    postgres: `UPDATE threads
        SET skip_linking = :skip
      WHERE thread_id = :threadId`,
  } satisfies SqlEntry,

  getSkipLinking: {
    oracle: `SELECT SKIP_LINKING FROM THREADS WHERE THREAD_ID = :threadId`,
    postgres: `SELECT skip_linking FROM threads WHERE thread_id = :threadId`,
  } satisfies SqlEntry,

  getThreadLinksForGame: {
    oracle: `SELECT THREAD_ID FROM THREAD_GAME_LINKS WHERE GAMEDB_GAME_ID = :gameId`,
    postgres: `SELECT thread_id FROM thread_game_links WHERE gamedb_game_id = :gameId`,
  } satisfies SqlEntry,

  getLegacyGameId: {
    oracle: `SELECT GAMEDB_GAME_ID FROM THREADS WHERE THREAD_ID = :threadId`,
    postgres: `SELECT gamedb_game_id FROM threads WHERE thread_id = :threadId`,
  } satisfies SqlEntry,

  getThreadGameLinks: {
    oracle: `SELECT GAMEDB_GAME_ID FROM THREAD_GAME_LINKS WHERE THREAD_ID = :threadId`,
    postgres: `SELECT gamedb_game_id FROM thread_game_links WHERE thread_id = :threadId`,
  } satisfies SqlEntry,

  getLegacyThreadIdForGame: {
    oracle: `SELECT THREAD_ID FROM THREADS WHERE GAMEDB_GAME_ID = :gameId`,
    postgres: `SELECT thread_id FROM threads WHERE gamedb_game_id = :gameId`,
  } satisfies SqlEntry,
};
