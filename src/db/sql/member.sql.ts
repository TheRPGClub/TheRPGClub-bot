import type { ISqlEntry } from "./types.js";

const COMPLETION_SELECT_SQL_PG = `SELECT c.completion_id,
             g.game_id,
             g.title,
             c.completion_type,
             c.platform_id,
             c.completed_at,
             c.final_playtime_hrs,
             c.created_at,
             c.note,
             COALESCE(
                (
                  SELECT MIN(tgl.thread_id)
                  FROM thread_game_links tgl
                  WHERE tgl.gamedb_game_id = c.gamedb_game_id
                ),
                (
                  SELECT MIN(th.thread_id)
                  FROM threads th
                  WHERE th.gamedb_game_id = c.gamedb_game_id
                )
              ) AS thread_id
        FROM user_game_completions c
        JOIN gamedb_games g ON g.game_id = c.gamedb_game_id`;

export const MemberSql = {
  touchLastSeen: {
    postgres: `UPDATE rpg_club_users
            SET last_seen_at = :lastSeen,
                updated_at = NOW()
          WHERE user_id = :userId`,
  } satisfies ISqlEntry,

  // threadIdSql is a dialect-specific SQL fragment; caller must supply appropriate version
  getNowPlaying: (threadIdSql: string) =>
    ({
      postgres: `SELECT g.game_id,
                g.title,
                u.platform_id,
                p.platform_name,
                p.platform_abbreviation,
                ${threadIdSql} AS thread_id,
                u.note,
                u.added_at,
                u.note_updated_at,
                u.sort_order,
                true AS journal_enabled,
                CASE
                  WHEN EXISTS (
                    SELECT 1
                    FROM user_game_journal_entries je
                    WHERE je.user_id = u.user_id
                      AND je.gamedb_game_id = u.gamedb_game_id
                  ) THEN 1
                  ELSE 0
                END AS has_journal_entry,
                (SELECT COUNT(*)
                   FROM user_game_journal_entries je2
                  WHERE je2.user_id = u.user_id
                    AND je2.gamedb_game_id = u.gamedb_game_id) AS journal_count,
                (SELECT MAX(je3.created_at)
                   FROM user_game_journal_entries je3
                  WHERE je3.user_id = u.user_id
                    AND je3.gamedb_game_id = u.gamedb_game_id) AS last_journal_at
           FROM user_now_playing u
           JOIN gamedb_games g ON g.game_id = u.gamedb_game_id
           LEFT JOIN gamedb_platforms p ON p.platform_id = u.platform_id
          WHERE u.user_id = :userId
            AND u.gamedb_game_id IS NOT NULL
          ORDER BY u.sort_order NULLS LAST, u.added_at DESC, u.entry_id DESC`,
    }) satisfies ISqlEntry,

  // threadIdSql is a dialect-specific SQL fragment; caller must supply appropriate version
  getAllNowPlaying: (threadIdSql: string) =>
    ({
      postgres: `SELECT u.user_id,
                ru.username,
                ru.global_name,
                g.game_id,
                g.title,
                u.platform_id,
                p.platform_name,
                p.platform_abbreviation,
                ${threadIdSql} AS thread_id,
                u.note,
                u.added_at,
                u.note_updated_at,
                u.entry_id
           FROM user_now_playing u
           JOIN rpg_club_users ru ON ru.user_id = u.user_id
           JOIN gamedb_games g ON g.game_id = u.gamedb_game_id
           LEFT JOIN gamedb_platforms p ON p.platform_id = u.platform_id
          WHERE COALESCE(ru.is_bot, false) = false
            AND ru.server_left_at IS NULL
          ORDER BY COALESCE(ru.global_name, ru.username, ru.user_id),
                   u.added_at DESC,
                   u.entry_id DESC`,
    }) satisfies ISqlEntry,

  getNowPlayingByGameIds: (placeholders: string) =>
    ({
      postgres: `SELECT u.gamedb_game_id AS game_id,
              g.title,
              u.user_id
         FROM user_now_playing u
         JOIN rpg_club_users ru ON ru.user_id = u.user_id
         JOIN gamedb_games g ON g.game_id = u.gamedb_game_id
        WHERE u.gamedb_game_id IN (${placeholders})
          AND COALESCE(ru.is_bot, false) = false
          AND ru.server_left_at IS NULL
        ORDER BY g.title, u.user_id`,
    }) satisfies ISqlEntry,

  getNowPlayingByTitleSearch: {
    postgres: `SELECT u.gamedb_game_id AS game_id,
              g.title,
              u.user_id,
              ru.username,
              ru.global_name
         FROM user_now_playing u
         JOIN rpg_club_users ru ON ru.user_id = u.user_id
         JOIN gamedb_games g ON g.game_id = u.gamedb_game_id
        WHERE (LOWER(g.title) LIKE :searchQuery
            OR REGEXP_REPLACE(LOWER(g.title), '[^a-z0-9]', '', 'g') LIKE :normalizedQuery)
          AND COALESCE(ru.is_bot, false) = false
          AND ru.server_left_at IS NULL
        ORDER BY g.title, u.user_id`,
  } satisfies ISqlEntry,

  getNowPlayingEntries: {
    postgres: `SELECT u.gamedb_game_id AS game_id,
              g.title,
              u.platform_id,
              p.platform_name,
              p.platform_abbreviation,
              u.note,
              u.added_at,
              u.note_updated_at,
              u.sort_order,
              true AS journal_enabled
         FROM user_now_playing u
         JOIN gamedb_games g ON g.game_id = u.gamedb_game_id
         LEFT JOIN gamedb_platforms p ON p.platform_id = u.platform_id
        WHERE u.user_id = :userId
          AND u.gamedb_game_id IS NOT NULL
        ORDER BY u.sort_order NULLS LAST, u.added_at DESC, u.entry_id DESC`,
  } satisfies ISqlEntry,

  getNowPlayingEntryMeta: {
    postgres: `SELECT added_at
         FROM user_now_playing
        WHERE user_id = :userId
          AND gamedb_game_id = :gameId`,
  } satisfies ISqlEntry,

  updateNowPlayingNote: {
    postgres: `UPDATE user_now_playing
          SET note = :note,
              note_updated_at = :noteUpdatedAt
        WHERE user_id = :userId
          AND gamedb_game_id = :gameId`,
  } satisfies ISqlEntry,

  countNowPlaying: {
    postgres: `SELECT COUNT(*) AS cnt FROM user_now_playing WHERE user_id = :userId`,
  } satisfies ISqlEntry,

  getNowPlayingMaxSort: {
    postgres: `SELECT MAX(sort_order) AS max_sort
             FROM user_now_playing
            WHERE user_id = :userId`,
  } satisfies ISqlEntry,

  insertNowPlaying: {
    postgres: `INSERT INTO user_now_playing
            (user_id, gamedb_game_id, platform_id, note, note_updated_at, sort_order)
           VALUES (:userId, :gameId, :platformId, :note, :noteUpdatedAt, :sortOrder)`,
  } satisfies ISqlEntry,

  getJournalStatusForGames: (inlineTable: string) =>
    ({
      postgres: `SELECT gids.game_id,
              COUNT(*) AS journal_count,
              MAX(je.created_at) AS last_journal_at
         FROM (${inlineTable}) gids
         LEFT JOIN user_game_journal_entries je
           ON je.user_id = :userId
          AND je.gamedb_game_id = gids.game_id
        GROUP BY gids.game_id`,
    }) satisfies ISqlEntry,

  getGameJournalEntries: {
    postgres: `WITH all_entries AS (
         SELECT entry_id,
                user_id,
                gamedb_game_id,
                entry_title,
                entry_body,
                created_at,
                updated_at,
                ROW_NUMBER() OVER (ORDER BY created_at ASC, entry_id ASC) AS entry_number
           FROM user_game_journal_entries
          WHERE user_id = :userId
            AND gamedb_game_id = :gameId
       )
       SELECT entry_id,
              user_id,
              gamedb_game_id,
              entry_title,
              entry_body,
              created_at,
              updated_at,
              entry_number
         FROM all_entries
        ORDER BY created_at DESC, entry_id DESC
        LIMIT :limit OFFSET :offset`,
  } satisfies ISqlEntry,

  countGameJournalEntries: {
    postgres: `SELECT COUNT(*) AS cnt
         FROM user_game_journal_entries
        WHERE user_id = :userId
          AND gamedb_game_id = :gameId`,
  } satisfies ISqlEntry,

  addGameJournalEntry: {
    postgres: `INSERT INTO user_game_journal_entries
        (user_id, gamedb_game_id, entry_title, entry_body, is_public)
       VALUES
        (:userId, :gameId, :title, :body, true)`,
  } satisfies ISqlEntry,

  getGameJournalEntryForUser: {
    postgres: `SELECT e.entry_id,
              e.user_id,
              e.gamedb_game_id,
              e.entry_title,
              e.entry_body,
              e.created_at,
              e.updated_at,
              (SELECT COUNT(*) + 1
                 FROM user_game_journal_entries e2
                WHERE e2.user_id = e.user_id
                  AND e2.gamedb_game_id = e.gamedb_game_id
                  AND (e2.created_at < e.created_at
                       OR (e2.created_at = e.created_at AND e2.entry_id < e.entry_id))
              ) AS entry_number
         FROM user_game_journal_entries e
        WHERE e.user_id = :userId
          AND e.entry_id = :entryId
        LIMIT 1`,
  } satisfies ISqlEntry,

  // Caller must pass lowercase column=value expressions for Postgres
  updateGameJournalEntry: (fields: string[]) =>
    ({
      postgres: `UPDATE user_game_journal_entries
          SET ${fields.join(", ")}
        WHERE user_id = :userId
          AND entry_id = :entryId`,
    }) satisfies ISqlEntry,

  deleteGameJournalEntry: {
    postgres: `DELETE FROM user_game_journal_entries
        WHERE user_id = :userId
          AND entry_id = :entryId`,
  } satisfies ISqlEntry,

  updateNowPlayingSort: {
    postgres: `UPDATE user_now_playing
            SET sort_order = :sortOrder
          WHERE user_id = :userId
            AND gamedb_game_id = :gameId`,
  } satisfies ISqlEntry,

  removeNowPlaying: {
    postgres: `DELETE FROM user_now_playing WHERE user_id = :userId AND gamedb_game_id = :gameId`,
  } satisfies ISqlEntry,

  getCompletionByGameId: {
    postgres: `${COMPLETION_SELECT_SQL_PG}
       WHERE c.user_id = :userId
         AND c.gamedb_game_id = :gameId
       LIMIT 1`,
  } satisfies ISqlEntry,

  // Caller must pass dialect-appropriate whereClause
  getCompletions: (whereClause: string) =>
    ({
      postgres: `${COMPLETION_SELECT_SQL_PG}
       WHERE ${whereClause}
       ORDER BY c.completed_at DESC NULLS LAST, c.completion_id DESC
       LIMIT :limit OFFSET :offset`,
    }) satisfies ISqlEntry,

  getAllCompletions: {
    postgres: `${COMPLETION_SELECT_SQL_PG}
       WHERE c.user_id = :userId
       ORDER BY c.completed_at DESC NULLS LAST, c.created_at DESC, c.completion_id DESC`,
  } satisfies ISqlEntry,

  // Caller must pass dialect-appropriate whereClause
  countCompletions: (whereClause: string) =>
    ({
      postgres: `SELECT COUNT(*) AS cnt
        FROM user_game_completions c
        JOIN gamedb_games g ON g.game_id = c.gamedb_game_id
       WHERE ${whereClause}`,
    }) satisfies ISqlEntry,

  getCompletionsForGame: {
    postgres: `${COMPLETION_SELECT_SQL_PG}
       WHERE c.user_id = :userId
         AND c.gamedb_game_id = :gameId
       ORDER BY c.completed_at DESC NULLS LAST, c.completion_id DESC`,
  } satisfies ISqlEntry,

  getRecentCompletionForGame: {
    postgres: `${COMPLETION_SELECT_SQL_PG}
       WHERE c.user_id = :userId
         AND c.gamedb_game_id = :gameId
         AND COALESCE(c.completed_at, c.created_at) BETWEEN :startDate AND :endDate
       ORDER BY COALESCE(c.completed_at, c.created_at) DESC
       LIMIT 1`,
  } satisfies ISqlEntry,

  getRecentNickHistory: {
    postgres: `SELECT old_nick, new_nick, changed_at
           FROM rpg_club_user_nick_history
          WHERE user_id = :userId
          ORDER BY changed_at DESC
          LIMIT :limit`,
  } satisfies ISqlEntry,

  // Caller must pass dialect-appropriate whereClause
  getCompletionLeaderboard: (whereClause: string) =>
    ({
      postgres: `SELECT c.user_id, u.username, u.global_name, COUNT(*) AS cnt
        FROM user_game_completions c
        JOIN rpg_club_users u ON u.user_id = c.user_id
        JOIN gamedb_games g ON g.game_id = c.gamedb_game_id
       WHERE ${whereClause}
       GROUP BY c.user_id, u.username, u.global_name
       ORDER BY cnt DESC
       LIMIT :limit`,
    }) satisfies ISqlEntry,

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

  updateNowPlayingPlatform: {
    postgres: `UPDATE user_now_playing
          SET platform_id = :platformId
        WHERE user_id = :userId
          AND gamedb_game_id = :gameId`,
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

  getGameJournalList: {
    postgres: `SELECT g.game_id,
              g.title,
              COUNT(e.entry_id) AS total_entries
         FROM user_game_journal_entries e
         JOIN gamedb_games g ON g.game_id = e.gamedb_game_id
        WHERE e.user_id = :userId
        GROUP BY g.game_id, g.title
        ORDER BY g.title`,
  } satisfies ISqlEntry,

  getAllJournalUsers: {
    postgres: `SELECT u.user_id,
              u.username,
              u.global_name,
              COUNT(DISTINCT je.gamedb_game_id) AS game_count,
              COUNT(je.entry_id) AS entry_count
         FROM user_game_journal_entries je
         JOIN rpg_club_users u ON u.user_id = je.user_id
        WHERE COALESCE(u.is_bot, false) = false
          AND u.server_left_at IS NULL
        GROUP BY u.user_id, u.username, u.global_name
        ORDER BY COUNT(DISTINCT je.gamedb_game_id) DESC,
                 u.global_name NULLS LAST,
                 u.username NULLS LAST`,
  } satisfies ISqlEntry,

  searchJournalEntries: {
    postgres: `SELECT COUNT(*) OVER () AS total_count,
              je.entry_id,
              je.user_id,
              u.global_name,
              u.username,
              je.gamedb_game_id,
              g.title         AS game_title,
              je.entry_title,
              je.entry_body,
              je.created_at
         FROM user_game_journal_entries je
         JOIN gamedb_games g ON g.game_id = je.gamedb_game_id
         JOIN rpg_club_users u ON u.user_id = je.user_id
        WHERE (
                je.entry_title ILIKE '%' || :searchTerm || '%'
             OR je.entry_body  ILIKE '%' || :searchTerm || '%'
              )
          AND (:userId IS NULL OR je.user_id = :userId)
          AND (:gameId IS NULL OR je.gamedb_game_id = :gameId)
        ORDER BY je.created_at DESC, je.entry_id DESC
        LIMIT :limit OFFSET :offset`,
  } satisfies ISqlEntry,

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

  getGiveawayDonorNotifySetting: {
    postgres: `SELECT donor_notify_on_claim
         FROM rpg_club_users
        WHERE user_id = :userId`,
  } satisfies ISqlEntry,

  updateGiveawayDonorNotifySetting: {
    postgres: `UPDATE rpg_club_users
            SET donor_notify_on_claim = :enabled
          WHERE user_id = :userId`,
  } satisfies ISqlEntry,

  insertGiveawayDonorNotifySetting: {
    postgres: `INSERT INTO rpg_club_users (user_id, donor_notify_on_claim)
           VALUES (:userId, :enabled)`,
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

  checkLinkedThreadColumn: {
    postgres: `SELECT COUNT(*) AS cnt
           FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'gamedb_games'
            AND column_name = 'linked_thread_id'`,
  } satisfies ISqlEntry,
};
