import type { ISqlEntry } from "./types.js";

export const MemberSql = {
  upsertJournalMessageContext: {
    postgres: `INSERT INTO journal_message_contexts (channel_id, message_id, created_at_ms, owner_user_id, game_id)
          VALUES (:channelId, :messageId, :createdAtMs, :ownerUserId, :gameId)
          ON CONFLICT (channel_id, message_id) DO UPDATE SET
            created_at_ms = EXCLUDED.created_at_ms,
            owner_user_id = EXCLUDED.owner_user_id,
            game_id = EXCLUDED.game_id`,
  } satisfies ISqlEntry,

  deleteJournalMessageContext: {
    postgres: `DELETE FROM journal_message_contexts
        WHERE channel_id = :channelId
          AND message_id = :messageId`,
  } satisfies ISqlEntry,

  loadActiveJournalMessageContexts: {
    postgres: `SELECT channel_id, message_id, created_at_ms, owner_user_id, game_id
         FROM journal_message_contexts
        WHERE created_at_ms >= :cutoffMs`,
  } satisfies ISqlEntry,

  pruneExpiredJournalMessageContexts: {
    postgres: `DELETE FROM journal_message_contexts WHERE created_at_ms < :cutoffMs`,
  } satisfies ISqlEntry,

};
