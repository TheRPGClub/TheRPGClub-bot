import type { ISqlEntry } from "./types.js";

export const MemberSql = {
  touchLastSeen: {
    postgres: `UPDATE rpg_club_users
            SET last_seen_at = :lastSeen,
                updated_at = NOW()
          WHERE user_id = :userId`,
  } satisfies ISqlEntry,

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

  getByUserId: {
    postgres: `SELECT user_id,
                is_bot,
                username,
                global_name,
               avatar_blob,
               server_joined_at,
                server_left_at,
                last_seen_at,
                role_admin,
                role_moderator,
                role_regular,
                role_member,
                role_newcomer,
                message_count,
                profile_image,
                profile_image_at
           FROM rpg_club_users
          WHERE user_id = :userId`,
  } satisfies ISqlEntry,

  getAvatarHistory: {
    postgres: `SELECT event_id,
                user_id,
                avatar_hash,
                avatar_url,
                avatar_blob,
                changed_at
           FROM rpg_club_user_avatar_history
          WHERE user_id = :userId
          ORDER BY changed_at DESC, event_id DESC
          LIMIT :limit OFFSET :offset`,
  } satisfies ISqlEntry,

  updateMember: {
    postgres: `UPDATE rpg_club_users
            SET is_bot = :isBot,
                username = :username,
                global_name = :globalName,
                avatar_blob = :avatarBlob,
                server_joined_at = :joinedAt,
                server_left_at = :leftAt,
                last_seen_at = :lastSeenAt,
                last_fetched_at = NOW(),
                role_admin = :roleAdmin,
                role_moderator = :roleModerator,
                role_regular = :roleRegular,
                role_member = :roleMember,
                role_newcomer = :roleNewcomer,
                updated_at = NOW()
          WHERE user_id = :userId`,
  } satisfies ISqlEntry,

  insertMember: {
    postgres: `INSERT INTO rpg_club_users (
             user_id, is_bot, username, global_name, avatar_blob,
             server_joined_at, server_left_at, last_seen_at, last_fetched_at,
             role_admin, role_moderator, role_regular, role_member, role_newcomer,
             created_at, updated_at
           ) VALUES (
             :userId, :isBot, :username, :globalName, :avatarBlob,
             :joinedAt, :leftAt, :lastSeenAt, NOW(),
             :roleAdmin, :roleModerator, :roleRegular, :roleMember, :roleNewcomer,
             NOW(), NOW()
           )`,
  } satisfies ISqlEntry,

  markDepartedNotIn: (placeholders: string) =>
    ({
      postgres: `UPDATE rpg_club_users
             SET server_left_at = NOW(),
                 updated_at = NOW()
           WHERE server_left_at IS NULL
             AND user_id NOT IN (${placeholders})`,
    }) satisfies ISqlEntry,

  updateEmojiName: {
    postgres: `UPDATE rpg_club_users
          SET emoji_name = :emojiName,
              updated_at = NOW()
        WHERE user_id = :userId`,
  } satisfies ISqlEntry,

  getAllWithEmojiName: {
    postgres: `SELECT user_id, emoji_name
         FROM rpg_club_users
        WHERE emoji_name IS NOT NULL`,
  } satisfies ISqlEntry,

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

  countAvatarHistory: {
    postgres: `SELECT COUNT(*) AS total
         FROM rpg_club_user_avatar_history
        WHERE user_id = :userId`,
  } satisfies ISqlEntry,

  insertAvatarHistoryRecord: {
    postgres: `INSERT INTO rpg_club_user_avatar_history
       (user_id, avatar_hash, avatar_url, avatar_blob)
       VALUES (:userId, :avatarHash, :avatarUrl, :avatarBlob)`,
  } satisfies ISqlEntry,

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

  getMembersWithPlatforms: {
    postgres: `SELECT u.user_id AS "USER_ID",
              u.username AS "USERNAME",
              u.global_name AS "GLOBAL_NAME",
              MAX(CASE WHEN LOWER(sp.label) LIKE '%steam%'
                       THEN us.display_text END) AS "STEAM_URL",
              MAX(CASE WHEN LOWER(sp.label) LIKE '%psn%'
                        OR LOWER(sp.label) LIKE '%playstation%'
                       THEN us.display_text END) AS "PSN_USERNAME",
              MAX(CASE WHEN LOWER(sp.label) LIKE '%xbox%'
                       THEN us.display_text END) AS "XBL_USERNAME",
              MAX(CASE WHEN LOWER(sp.label) LIKE '%nintendo%'
                        OR LOWER(sp.label) LIKE '%switch%'
                       THEN us.display_text END) AS "NSW_FRIEND_CODE"
         FROM rpg_club_users u
         JOIN user_socials us ON us.user_id = u.user_id
         JOIN social_platforms sp ON sp.id = us.platform_id
        WHERE COALESCE(u.is_bot, false) = false
          AND u.server_left_at IS NULL
          AND (LOWER(sp.label) LIKE '%steam%'
            OR LOWER(sp.label) LIKE '%psn%'
            OR LOWER(sp.label) LIKE '%playstation%'
            OR LOWER(sp.label) LIKE '%xbox%'
            OR LOWER(sp.label) LIKE '%nintendo%'
            OR LOWER(sp.label) LIKE '%switch%')
        GROUP BY u.user_id, u.username, u.global_name`,
  } satisfies ISqlEntry,

};
