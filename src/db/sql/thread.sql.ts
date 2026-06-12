import type { ISqlEntry } from "./types.js";

export const ThreadSql = {
  upsertThread: {
    postgres: `INSERT INTO threads
       (thread_id, forum_channel_id, thread_name, is_archived, created_at, last_seen_at, skip_linking)
       VALUES (:threadId, :forumChannelId, :threadName, :isArchived, :createdAt, :lastSeenAt, :skipLinking)
       ON CONFLICT (thread_id) DO UPDATE SET
         thread_name = EXCLUDED.thread_name,
         forum_channel_id = EXCLUDED.forum_channel_id,
         is_archived = EXCLUDED.is_archived,
         last_seen_at = EXCLUDED.last_seen_at`,
  } satisfies ISqlEntry,

  deleteThreadGameLink: {
    postgres: `DELETE FROM thread_game_links WHERE thread_id = :threadId`,
  } satisfies ISqlEntry,

  mergeThreadGameLink: {
    postgres: `INSERT INTO thread_game_links (thread_id, gamedb_game_id, linked_at)
         VALUES (:threadId, :gameId, NOW())
         ON CONFLICT (thread_id, gamedb_game_id) DO NOTHING`,
  } satisfies ISqlEntry,

  updateThreadsGameId: {
    postgres: `UPDATE threads
       SET gamedb_game_id = (
         SELECT MIN(g.gamedb_game_id)
           FROM thread_game_links g
          WHERE g.thread_id = threads.thread_id
       )
       WHERE thread_id = :threadId`,
  } satisfies ISqlEntry,

  removeThreadGameLinks: (withGameId: boolean) =>
    ({
      postgres: `DELETE FROM thread_game_links
       WHERE thread_id = :threadId
       ${withGameId ? "AND gamedb_game_id = :gameId" : ""}`,
    }) satisfies ISqlEntry,

  setSkipLinking: {
    postgres: `UPDATE threads
        SET skip_linking = :skip
      WHERE thread_id = :threadId`,
  } satisfies ISqlEntry,

  getSkipLinking: {
    postgres: `SELECT skip_linking FROM threads WHERE thread_id = :threadId`,
  } satisfies ISqlEntry,

  getThreadLinksForGame: {
    postgres: `SELECT thread_id FROM thread_game_links WHERE gamedb_game_id = :gameId`,
  } satisfies ISqlEntry,

  getLegacyGameId: {
    postgres: `SELECT gamedb_game_id FROM threads WHERE thread_id = :threadId`,
  } satisfies ISqlEntry,

  getThreadGameLinks: {
    postgres: `SELECT gamedb_game_id FROM thread_game_links WHERE thread_id = :threadId`,
  } satisfies ISqlEntry,

  getLegacyThreadIdForGame: {
    postgres: `SELECT thread_id FROM threads WHERE gamedb_game_id = :gameId`,
  } satisfies ISqlEntry,
};
