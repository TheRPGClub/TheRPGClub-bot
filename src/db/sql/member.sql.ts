import type { ISqlEntry } from "./types.js";

export const MemberSql = {
  // Caller must pass dialect-appropriate where clause
  searchMembers: (where: string) =>
    ({
      postgres: `SELECT user_id,
              username,
              global_name,
              is_bot,
              role_admin,
              role_moderator,
              role_regular,
              role_member,
              role_newcomer,
              server_left_at,
              server_joined_at,
              last_seen_at
         FROM rpg_club_users
        WHERE ${where}
        ORDER BY COALESCE(UPPER(global_name), UPPER(username), user_id)
        LIMIT :limit`,
    }) satisfies ISqlEntry,

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

  // No API aggregate endpoint available yet -- see issue #849
  getAllMembersAvatarHistoryCounts: {
    postgres: `SELECT h.user_id,
              u.username,
              u.global_name,
              COUNT(*) AS total
         FROM rpg_club_user_avatar_history h
         JOIN rpg_club_users u ON u.user_id = h.user_id
        WHERE COALESCE(u.is_bot, false) = false
          AND u.server_left_at IS NULL
        GROUP BY h.user_id, u.username, u.global_name
        ORDER BY COALESCE(u.global_name, u.username, h.user_id)`,
  } satisfies ISqlEntry,

};
