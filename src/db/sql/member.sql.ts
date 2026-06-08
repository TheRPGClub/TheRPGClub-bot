import type { SqlEntry } from "./types.js";

const COMPLETION_SELECT_SQL = `SELECT c.COMPLETION_ID,
             g.GAME_ID,
             g.TITLE,
             c.COMPLETION_TYPE,
             c.PLATFORM_ID,
             c.COMPLETED_AT,
             c.FINAL_PLAYTIME_HRS,
             c.CREATED_AT,
             c.NOTE,
             COALESCE(
                (
                  SELECT MIN(tgl.THREAD_ID)
                  FROM THREAD_GAME_LINKS tgl
                  WHERE tgl.GAMEDB_GAME_ID = c.GAMEDB_GAME_ID
                ),
                (
                  SELECT MIN(th.THREAD_ID)
                  FROM THREADS th
                  WHERE th.GAMEDB_GAME_ID = c.GAMEDB_GAME_ID
                )
              ) AS THREAD_ID
        FROM USER_GAME_COMPLETIONS c
        JOIN GAMEDB_GAMES g ON g.GAME_ID = c.GAMEDB_GAME_ID`;

export const MemberSql = {
  touchLastSeen: {
    oracle: `UPDATE RPG_CLUB_USERS
            SET LAST_SEEN_AT = :lastSeen,
                UPDATED_AT = SYSTIMESTAMP
          WHERE USER_ID = :userId`,
    postgres: ``,
  } satisfies SqlEntry,

  getNowPlaying: (threadIdSql: string) =>
    ({
      oracle: `SELECT g.GAME_ID,
                g.TITLE,
                u.PLATFORM_ID,
                p.PLATFORM_NAME,
                p.PLATFORM_ABBREVIATION,
                ${threadIdSql} AS THREAD_ID,
                u.NOTE,
                u.ADDED_AT,
                u.NOTE_UPDATED_AT,
                u.SORT_ORDER,
                NVL(jp.IS_ENABLED, 1) AS JOURNAL_ENABLED,
                CASE
                  WHEN EXISTS (
                    SELECT 1
                    FROM USER_GAME_JOURNAL_ENTRIES je
                    WHERE je.USER_ID = u.USER_ID
                      AND je.GAMEDB_GAME_ID = u.GAMEDB_GAME_ID
                  ) THEN 1
                  ELSE 0
                END AS HAS_JOURNAL_ENTRY,
                (SELECT COUNT(*)
                   FROM USER_GAME_JOURNAL_ENTRIES je2
                  WHERE je2.USER_ID = u.USER_ID
                    AND je2.GAMEDB_GAME_ID = u.GAMEDB_GAME_ID) AS JOURNAL_COUNT,
                (SELECT MAX(je3.CREATED_AT)
                   FROM USER_GAME_JOURNAL_ENTRIES je3
                  WHERE je3.USER_ID = u.USER_ID
                    AND je3.GAMEDB_GAME_ID = u.GAMEDB_GAME_ID) AS LAST_JOURNAL_AT
           FROM USER_NOW_PLAYING u
           JOIN GAMEDB_GAMES g ON g.GAME_ID = u.GAMEDB_GAME_ID
           LEFT JOIN GAMEDB_PLATFORMS p ON p.PLATFORM_ID = u.PLATFORM_ID
           LEFT JOIN USER_GAME_JOURNAL_PREFS jp
             ON jp.USER_ID = u.USER_ID
            AND jp.GAMEDB_GAME_ID = u.GAMEDB_GAME_ID
          WHERE u.USER_ID = :userId
            AND u.GAMEDB_GAME_ID IS NOT NULL
          ORDER BY u.SORT_ORDER NULLS LAST, u.ADDED_AT DESC, u.ENTRY_ID DESC`,
      postgres: ``,
    }) satisfies SqlEntry,

  getAllNowPlaying: (threadIdSql: string) =>
    ({
      oracle: `SELECT u.USER_ID,
                ru.USERNAME,
                ru.GLOBAL_NAME,
                g.GAME_ID,
                g.TITLE,
                u.PLATFORM_ID,
                p.PLATFORM_NAME,
                p.PLATFORM_ABBREVIATION,
                ${threadIdSql} AS THREAD_ID,
                u.NOTE,
                u.ADDED_AT,
                u.NOTE_UPDATED_AT,
                u.ENTRY_ID
           FROM USER_NOW_PLAYING u
           JOIN RPG_CLUB_USERS ru ON ru.USER_ID = u.USER_ID
           JOIN GAMEDB_GAMES g ON g.GAME_ID = u.GAMEDB_GAME_ID
           LEFT JOIN GAMEDB_PLATFORMS p ON p.PLATFORM_ID = u.PLATFORM_ID
          WHERE NVL(ru.IS_BOT, 0) = 0
            AND ru.SERVER_LEFT_AT IS NULL
          ORDER BY COALESCE(ru.GLOBAL_NAME, ru.USERNAME, ru.USER_ID),
                   u.ADDED_AT DESC,
                   u.ENTRY_ID DESC`,
      postgres: ``,
    }) satisfies SqlEntry,

  getNowPlayingByGameIds: (placeholders: string) =>
    ({
      oracle: `SELECT u.GAMEDB_GAME_ID AS GAME_ID,
              g.TITLE,
              u.USER_ID
         FROM USER_NOW_PLAYING u
         JOIN RPG_CLUB_USERS ru ON ru.USER_ID = u.USER_ID
         JOIN GAMEDB_GAMES g ON g.GAME_ID = u.GAMEDB_GAME_ID
        WHERE u.GAMEDB_GAME_ID IN (${placeholders})
          AND NVL(ru.IS_BOT, 0) = 0
          AND ru.SERVER_LEFT_AT IS NULL
        ORDER BY g.TITLE, u.USER_ID`,
      postgres: ``,
    }) satisfies SqlEntry,

  getNowPlayingByTitleSearch: {
    oracle: `SELECT u.GAMEDB_GAME_ID AS GAME_ID,
              g.TITLE,
              u.USER_ID
         FROM USER_NOW_PLAYING u
         JOIN RPG_CLUB_USERS ru ON ru.USER_ID = u.USER_ID
         JOIN GAMEDB_GAMES g ON g.GAME_ID = u.GAMEDB_GAME_ID
        WHERE (LOWER(g.TITLE) LIKE :searchQuery
            OR REGEXP_REPLACE(LOWER(g.TITLE), '[^a-z0-9]', '') LIKE :normalizedQuery)
          AND NVL(ru.IS_BOT, 0) = 0
          AND ru.SERVER_LEFT_AT IS NULL
        ORDER BY g.TITLE, u.USER_ID`,
    postgres: ``,
  } satisfies SqlEntry,

  getNowPlayingEntries: {
    oracle: `SELECT u.GAMEDB_GAME_ID AS GAME_ID,
              g.TITLE,
              u.PLATFORM_ID,
              p.PLATFORM_NAME,
              p.PLATFORM_ABBREVIATION,
              u.NOTE,
              u.ADDED_AT,
              u.NOTE_UPDATED_AT,
              u.SORT_ORDER,
              jp.IS_ENABLED AS JOURNAL_ENABLED
         FROM USER_NOW_PLAYING u
         JOIN GAMEDB_GAMES g ON g.GAME_ID = u.GAMEDB_GAME_ID
         LEFT JOIN GAMEDB_PLATFORMS p ON p.PLATFORM_ID = u.PLATFORM_ID
         LEFT JOIN USER_GAME_JOURNAL_PREFS jp
           ON jp.USER_ID = u.USER_ID
          AND jp.GAMEDB_GAME_ID = u.GAMEDB_GAME_ID
        WHERE u.USER_ID = :userId
          AND u.GAMEDB_GAME_ID IS NOT NULL
        ORDER BY u.SORT_ORDER NULLS LAST, u.ADDED_AT DESC, u.ENTRY_ID DESC`,
    postgres: ``,
  } satisfies SqlEntry,

  getNowPlayingEntryMeta: {
    oracle: `SELECT ADDED_AT
         FROM USER_NOW_PLAYING
        WHERE USER_ID = :userId
          AND GAMEDB_GAME_ID = :gameId`,
    postgres: ``,
  } satisfies SqlEntry,

  updateNowPlayingNote: {
    oracle: `UPDATE USER_NOW_PLAYING
          SET NOTE = :note,
              NOTE_UPDATED_AT = :noteUpdatedAt
        WHERE USER_ID = :userId
          AND GAMEDB_GAME_ID = :gameId`,
    postgres: ``,
  } satisfies SqlEntry,

  countNowPlaying: {
    oracle: `SELECT COUNT(*) AS CNT FROM USER_NOW_PLAYING WHERE USER_ID = :userId`,
    postgres: ``,
  } satisfies SqlEntry,

  getNowPlayingMaxSort: {
    oracle: `SELECT MAX(SORT_ORDER) AS MAX_SORT
             FROM USER_NOW_PLAYING
            WHERE USER_ID = :userId`,
    postgres: ``,
  } satisfies SqlEntry,

  insertNowPlaying: {
    oracle: `INSERT INTO USER_NOW_PLAYING
            (USER_ID, GAMEDB_GAME_ID, PLATFORM_ID, NOTE, NOTE_UPDATED_AT, SORT_ORDER)
           VALUES (:userId, :gameId, :platformId, :note, :noteUpdatedAt, :sortOrder)`,
    postgres: ``,
  } satisfies SqlEntry,

  mergeJournalPrefs: {
    oracle: `MERGE INTO USER_GAME_JOURNAL_PREFS p
           USING (SELECT :userId AS USER_ID, :gameId AS GAMEDB_GAME_ID FROM dual) src
              ON (p.USER_ID = src.USER_ID AND p.GAMEDB_GAME_ID = src.GAMEDB_GAME_ID)
           WHEN MATCHED THEN
             UPDATE SET IS_ENABLED = 1, UPDATED_AT = SYSTIMESTAMP
           WHEN NOT MATCHED THEN
             INSERT (USER_ID, GAMEDB_GAME_ID, IS_ENABLED, DEFAULT_IS_PUBLIC)
             VALUES (:userId, :gameId, 1, 0)`,
    postgres: ``,
  } satisfies SqlEntry,

  getGameJournalPreference: {
    oracle: `SELECT USER_ID,
              GAMEDB_GAME_ID,
              IS_ENABLED
         FROM USER_GAME_JOURNAL_PREFS
        WHERE USER_ID = :userId
          AND GAMEDB_GAME_ID = :gameId`,
    postgres: ``,
  } satisfies SqlEntry,

  upsertGameJournalPreference: {
    oracle: `MERGE INTO USER_GAME_JOURNAL_PREFS p
       USING (SELECT :userId AS USER_ID, :gameId AS GAMEDB_GAME_ID FROM dual) src
          ON (p.USER_ID = src.USER_ID AND p.GAMEDB_GAME_ID = src.GAMEDB_GAME_ID)
        WHEN MATCHED THEN
          UPDATE SET IS_ENABLED = :isEnabled,
                     DEFAULT_IS_PUBLIC = 1,
                     UPDATED_AT = SYSTIMESTAMP
        WHEN NOT MATCHED THEN
          INSERT (USER_ID, GAMEDB_GAME_ID, IS_ENABLED, DEFAULT_IS_PUBLIC)
          VALUES (:userId, :gameId, :isEnabled, 1)`,
    postgres: ``,
  } satisfies SqlEntry,

  getJournalStatusForGames: (inlineTable: string) =>
    ({
      oracle: `SELECT gids.GAME_ID,
              COUNT(*) AS JOURNAL_COUNT,
              MAX(je.CREATED_AT) AS LAST_JOURNAL_AT
         FROM (${inlineTable}) gids
         LEFT JOIN USER_GAME_JOURNAL_ENTRIES je
           ON je.USER_ID = :userId
          AND je.GAMEDB_GAME_ID = gids.GAME_ID
        GROUP BY gids.GAME_ID`,
      postgres: ``,
    }) satisfies SqlEntry,

  getGameJournalEntries: {
    oracle: `WITH all_entries AS (
         SELECT ENTRY_ID,
                USER_ID,
                GAMEDB_GAME_ID,
                ENTRY_TITLE,
                ENTRY_BODY,
                CREATED_AT,
                UPDATED_AT,
                ROW_NUMBER() OVER (ORDER BY CREATED_AT ASC, ENTRY_ID ASC) AS ENTRY_NUMBER
           FROM USER_GAME_JOURNAL_ENTRIES
          WHERE USER_ID = :userId
            AND GAMEDB_GAME_ID = :gameId
       )
       SELECT ENTRY_ID,
              USER_ID,
              GAMEDB_GAME_ID,
              ENTRY_TITLE,
              ENTRY_BODY,
              CREATED_AT,
              UPDATED_AT,
              ENTRY_NUMBER
         FROM all_entries
        ORDER BY CREATED_AT DESC, ENTRY_ID DESC
        OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
    postgres: ``,
  } satisfies SqlEntry,

  countGameJournalEntries: {
    oracle: `SELECT COUNT(*) AS CNT
         FROM USER_GAME_JOURNAL_ENTRIES
        WHERE USER_ID = :userId
          AND GAMEDB_GAME_ID = :gameId`,
    postgres: ``,
  } satisfies SqlEntry,

  addGameJournalEntry: {
    oracle: `INSERT INTO USER_GAME_JOURNAL_ENTRIES
        (USER_ID, GAMEDB_GAME_ID, ENTRY_TITLE, ENTRY_BODY, IS_PUBLIC)
       VALUES
        (:userId, :gameId, :title, :body, 1)`,
    postgres: ``,
  } satisfies SqlEntry,

  getGameJournalEntryForUser: {
    oracle: `SELECT e.ENTRY_ID,
              e.USER_ID,
              e.GAMEDB_GAME_ID,
              e.ENTRY_TITLE,
              e.ENTRY_BODY,
              e.CREATED_AT,
              e.UPDATED_AT,
              (SELECT COUNT(*) + 1
                 FROM USER_GAME_JOURNAL_ENTRIES e2
                WHERE e2.USER_ID = e.USER_ID
                  AND e2.GAMEDB_GAME_ID = e.GAMEDB_GAME_ID
                  AND (e2.CREATED_AT < e.CREATED_AT
                       OR (e2.CREATED_AT = e.CREATED_AT AND e2.ENTRY_ID < e.ENTRY_ID))
              ) AS ENTRY_NUMBER
         FROM USER_GAME_JOURNAL_ENTRIES e
        WHERE e.USER_ID = :userId
          AND e.ENTRY_ID = :entryId
        FETCH FIRST 1 ROWS ONLY`,
    postgres: ``,
  } satisfies SqlEntry,

  updateGameJournalEntry: (fields: string[]) =>
    ({
      oracle: `UPDATE USER_GAME_JOURNAL_ENTRIES
          SET ${fields.join(", ")}
        WHERE USER_ID = :userId
          AND ENTRY_ID = :entryId`,
      postgres: ``,
    }) satisfies SqlEntry,

  deleteGameJournalEntry: {
    oracle: `DELETE FROM USER_GAME_JOURNAL_ENTRIES
        WHERE USER_ID = :userId
          AND ENTRY_ID = :entryId`,
    postgres: ``,
  } satisfies SqlEntry,

  updateNowPlayingSort: {
    oracle: `UPDATE USER_NOW_PLAYING
            SET SORT_ORDER = :sortOrder
          WHERE USER_ID = :userId
            AND GAMEDB_GAME_ID = :gameId`,
    postgres: ``,
  } satisfies SqlEntry,

  removeNowPlaying: {
    oracle: `DELETE FROM USER_NOW_PLAYING WHERE USER_ID = :userId AND GAMEDB_GAME_ID = :gameId`,
    postgres: ``,
  } satisfies SqlEntry,

  addCompletion: {
    oracle: `INSERT INTO USER_GAME_COMPLETIONS (
          USER_ID, GAMEDB_GAME_ID, COMPLETION_TYPE, PLATFORM_ID,
          COMPLETED_AT, FINAL_PLAYTIME_HRS, NOTE
        ) VALUES (
          :userId, :gameId, :type, :platformId, :completedAt, :playtime, :note
        )
        RETURNING COMPLETION_ID INTO :completionId`,
    postgres: ``,
  } satisfies SqlEntry,

  verifyCompletion: {
    oracle: `SELECT COUNT(*) AS CNT FROM USER_GAME_COMPLETIONS
          WHERE COMPLETION_ID = :id AND USER_ID = :userId`,
    postgres: ``,
  } satisfies SqlEntry,

  getCompletion: {
    oracle: `${COMPLETION_SELECT_SQL}
       WHERE c.COMPLETION_ID = :completionId`,
    postgres: ``,
  } satisfies SqlEntry,

  getCompletionForUser: {
    oracle: `${COMPLETION_SELECT_SQL}
       WHERE c.USER_ID = :userId
         AND c.COMPLETION_ID = :completionId`,
    postgres: ``,
  } satisfies SqlEntry,

  getCompletionByGameId: {
    oracle: `${COMPLETION_SELECT_SQL}
       WHERE c.USER_ID = :userId
         AND c.GAMEDB_GAME_ID = :gameId
       FETCH FIRST 1 ROWS ONLY`,
    postgres: ``,
  } satisfies SqlEntry,

  getCompletions: (whereClause: string) =>
    ({
      oracle: `${COMPLETION_SELECT_SQL}
       WHERE ${whereClause}
       ORDER BY c.COMPLETED_AT DESC NULLS LAST, c.COMPLETION_ID DESC
       OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
      postgres: ``,
    }) satisfies SqlEntry,

  getAllCompletions: {
    oracle: `${COMPLETION_SELECT_SQL}
       WHERE c.USER_ID = :userId
       ORDER BY c.COMPLETED_AT DESC NULLS LAST, c.CREATED_AT DESC, c.COMPLETION_ID DESC`,
    postgres: ``,
  } satisfies SqlEntry,

  countCompletions: (whereClause: string) =>
    ({
      oracle: `SELECT COUNT(*) AS CNT
        FROM USER_GAME_COMPLETIONS c
        JOIN GAMEDB_GAMES g ON g.GAME_ID = c.GAMEDB_GAME_ID
       WHERE ${whereClause}`,
      postgres: ``,
    }) satisfies SqlEntry,

  updateCompletion: (fields: string[]) =>
    ({
      oracle: `UPDATE USER_GAME_COMPLETIONS
         SET ${fields.join(", ")}
       WHERE COMPLETION_ID = :completionId
         AND USER_ID = :userId`,
      postgres: ``,
    }) satisfies SqlEntry,

  deleteCompletion: {
    oracle: `DELETE FROM USER_GAME_COMPLETIONS
       WHERE COMPLETION_ID = :completionId
         AND USER_ID = :userId`,
    postgres: ``,
  } satisfies SqlEntry,

  getCompletionsForGame: {
    oracle: `${COMPLETION_SELECT_SQL}
       WHERE c.USER_ID = :userId
         AND c.GAMEDB_GAME_ID = :gameId
       ORDER BY c.COMPLETED_AT DESC NULLS LAST, c.COMPLETION_ID DESC`,
    postgres: ``,
  } satisfies SqlEntry,

  getRecentCompletionForGame: {
    oracle: `${COMPLETION_SELECT_SQL}
       WHERE c.USER_ID = :userId
         AND c.GAMEDB_GAME_ID = :gameId
         AND COALESCE(c.COMPLETED_AT, c.CREATED_AT) BETWEEN :startDate AND :endDate
       ORDER BY COALESCE(c.COMPLETED_AT, c.CREATED_AT) DESC
       FETCH FIRST 1 ROWS ONLY`,
    postgres: ``,
  } satisfies SqlEntry,

  getRecentNickHistory: {
    oracle: `SELECT OLD_NICK, NEW_NICK, CHANGED_AT
           FROM RPG_CLUB_USER_NICK_HISTORY
          WHERE USER_ID = :userId
          ORDER BY CHANGED_AT DESC
          FETCH FIRST :limit ROWS ONLY`,
    postgres: ``,
  } satisfies SqlEntry,

  getCompletionLeaderboard: (whereClause: string) =>
    ({
      oracle: `SELECT c.USER_ID, u.USERNAME, u.GLOBAL_NAME, COUNT(*) AS CNT
        FROM USER_GAME_COMPLETIONS c
        JOIN RPG_CLUB_USERS u ON u.USER_ID = c.USER_ID
        JOIN GAMEDB_GAMES g ON g.GAME_ID = c.GAMEDB_GAME_ID
       WHERE ${whereClause}
       GROUP BY c.USER_ID, u.USERNAME, u.GLOBAL_NAME
       ORDER BY CNT DESC
       FETCH FIRST :limit ROWS ONLY`,
      postgres: ``,
    }) satisfies SqlEntry,

  searchMembers: (where: string) =>
    ({
      oracle: `SELECT USER_ID,
              USERNAME,
              GLOBAL_NAME,
              IS_BOT,
              COMPLETIONATOR_URL,
              STEAM_URL,
              PSN_USERNAME,
              XBL_USERNAME,
              NSW_FRIEND_CODE,
              ROLE_ADMIN,
              ROLE_MODERATOR,
              ROLE_REGULAR,
              ROLE_MEMBER,
              ROLE_NEWCOMER,
              SERVER_LEFT_AT,
              SERVER_JOINED_AT,
              LAST_SEEN_AT
         FROM RPG_CLUB_USERS
        WHERE ${where}
        ORDER BY COALESCE(UPPER(GLOBAL_NAME), UPPER(USERNAME), USER_ID)
        FETCH FIRST :limit ROWS ONLY`,
      postgres: ``,
    }) satisfies SqlEntry,

  getByUserId: {
    oracle: `SELECT USER_ID,
                IS_BOT,
                USERNAME,
                GLOBAL_NAME,
               AVATAR_BLOB,
               SERVER_JOINED_AT,
                SERVER_LEFT_AT,
                LAST_SEEN_AT,
                ROLE_ADMIN,
                ROLE_MODERATOR,
                ROLE_REGULAR,
                ROLE_MEMBER,
                ROLE_NEWCOMER,
                MESSAGE_COUNT,
                COMPLETIONATOR_URL,
                PSN_USERNAME,
                XBL_USERNAME,
                NSW_FRIEND_CODE,
                STEAM_URL,
                PROFILE_IMAGE,
                PROFILE_IMAGE_AT
           FROM RPG_CLUB_USERS
          WHERE USER_ID = :userId`,
    postgres: ``,
  } satisfies SqlEntry,

  updateNowPlayingPlatform: {
    oracle: `UPDATE USER_NOW_PLAYING
          SET PLATFORM_ID = :platformId
        WHERE USER_ID = :userId
          AND GAMEDB_GAME_ID = :gameId`,
    postgres: ``,
  } satisfies SqlEntry,

  getAvatarHistory: {
    oracle: `SELECT EVENT_ID,
                USER_ID,
                AVATAR_HASH,
                AVATAR_URL,
                AVATAR_BLOB,
                CHANGED_AT
           FROM RPG_CLUB_USER_AVATAR_HISTORY
          WHERE USER_ID = :userId
          ORDER BY CHANGED_AT DESC, EVENT_ID DESC
          OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
    postgres: ``,
  } satisfies SqlEntry,

  updateMember: {
    oracle: `UPDATE RPG_CLUB_USERS
            SET IS_BOT = :isBot,
                USERNAME = :username,
                GLOBAL_NAME = :globalName,
                AVATAR_BLOB = :avatarBlob,
                SERVER_JOINED_AT = :joinedAt,
                SERVER_LEFT_AT = :leftAt,
                LAST_SEEN_AT = :lastSeenAt,
                LAST_FETCHED_AT = SYSTIMESTAMP,
                ROLE_ADMIN = :roleAdmin,
                ROLE_MODERATOR = :roleModerator,
                ROLE_REGULAR = :roleRegular,
                ROLE_MEMBER = :roleMember,
                ROLE_NEWCOMER = :roleNewcomer,
                COMPLETIONATOR_URL = :completionatorUrl,
                PSN_USERNAME = :psnUsername,
                XBL_USERNAME = :xblUsername,
                NSW_FRIEND_CODE = :nswFriendCode,
                STEAM_URL = :steamUrl,
                UPDATED_AT = SYSTIMESTAMP
          WHERE USER_ID = :userId`,
    postgres: ``,
  } satisfies SqlEntry,

  insertMember: {
    oracle: `INSERT INTO RPG_CLUB_USERS (
             USER_ID, IS_BOT, USERNAME, GLOBAL_NAME, AVATAR_BLOB,
             SERVER_JOINED_AT, SERVER_LEFT_AT, LAST_SEEN_AT, LAST_FETCHED_AT,
             ROLE_ADMIN, ROLE_MODERATOR, ROLE_REGULAR, ROLE_MEMBER, ROLE_NEWCOMER,
             COMPLETIONATOR_URL, PSN_USERNAME, XBL_USERNAME, NSW_FRIEND_CODE,
             STEAM_URL,
             CREATED_AT, UPDATED_AT
           ) VALUES (
             :userId, :isBot, :username, :globalName, :avatarBlob,
             :joinedAt, :leftAt, :lastSeenAt, SYSTIMESTAMP,
             :roleAdmin, :roleModerator, :roleRegular, :roleMember, :roleNewcomer,
             :completionatorUrl, :psnUsername, :xblUsername,
             :nswFriendCode, :steamUrl,
             SYSTIMESTAMP, SYSTIMESTAMP
           )`,
    postgres: ``,
  } satisfies SqlEntry,

  markDepartedNotIn: (placeholders: string) =>
    ({
      oracle: `UPDATE RPG_CLUB_USERS
             SET SERVER_LEFT_AT = SYSTIMESTAMP,
                 UPDATED_AT = SYSTIMESTAMP
           WHERE SERVER_LEFT_AT IS NULL
             AND USER_ID NOT IN (${placeholders})`,
      postgres: ``,
    }) satisfies SqlEntry,

  getGameJournalList: {
    oracle: `SELECT g.GAME_ID,
              g.TITLE,
              COUNT(e.ENTRY_ID) AS TOTAL_ENTRIES
         FROM USER_GAME_JOURNAL_PREFS jp
         JOIN GAMEDB_GAMES g ON g.GAME_ID = jp.GAMEDB_GAME_ID
         LEFT JOIN USER_GAME_JOURNAL_ENTRIES e
           ON e.USER_ID = jp.USER_ID
          AND e.GAMEDB_GAME_ID = jp.GAMEDB_GAME_ID
        WHERE jp.USER_ID = :userId
          AND jp.IS_ENABLED = 1
        GROUP BY g.GAME_ID, g.TITLE
       HAVING COUNT(e.ENTRY_ID) > 0
        ORDER BY g.TITLE`,
    postgres: ``,
  } satisfies SqlEntry,

  getAllJournalUsers: {
    oracle: `SELECT u.USER_ID,
              u.USERNAME,
              u.GLOBAL_NAME,
              COUNT(DISTINCT je.GAMEDB_GAME_ID) AS GAME_COUNT,
              COUNT(je.ENTRY_ID) AS ENTRY_COUNT
         FROM USER_GAME_JOURNAL_ENTRIES je
         JOIN RPG_CLUB_USERS u ON u.USER_ID = je.USER_ID
        WHERE NVL(u.IS_BOT, 0) = 0
          AND u.SERVER_LEFT_AT IS NULL
        GROUP BY u.USER_ID, u.USERNAME, u.GLOBAL_NAME
        ORDER BY COUNT(DISTINCT je.GAMEDB_GAME_ID) DESC,
                 u.GLOBAL_NAME NULLS LAST,
                 u.USERNAME NULLS LAST`,
    postgres: ``,
  } satisfies SqlEntry,

  searchJournalEntries: {
    oracle: `SELECT COUNT(*) OVER () AS TOTAL_COUNT,
              je.ENTRY_ID,
              je.USER_ID,
              u.GLOBAL_NAME,
              u.USERNAME,
              je.GAMEDB_GAME_ID,
              g.TITLE         AS GAME_TITLE,
              je.ENTRY_TITLE,
              je.ENTRY_BODY,
              je.CREATED_AT
         FROM USER_GAME_JOURNAL_ENTRIES je
         JOIN GAMEDB_GAMES g ON g.GAME_ID = je.GAMEDB_GAME_ID
         JOIN RPG_CLUB_USERS u ON u.USER_ID = je.USER_ID
        WHERE (
                UPPER(je.ENTRY_TITLE) LIKE '%' || UPPER(:searchTerm) || '%'
             OR UPPER(je.ENTRY_BODY)  LIKE '%' || UPPER(:searchTerm) || '%'
              )
          AND (:userId IS NULL OR je.USER_ID = :userId)
          AND (:gameId IS NULL OR je.GAMEDB_GAME_ID = :gameId)
        ORDER BY je.CREATED_AT DESC, je.ENTRY_ID DESC
        OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
    postgres: ``,
  } satisfies SqlEntry,

  updateEmojiName: {
    oracle: `UPDATE RPG_CLUB_USERS
          SET EMOJI_NAME = :emojiName,
              UPDATED_AT = SYSTIMESTAMP
        WHERE USER_ID = :userId`,
    postgres: ``,
  } satisfies SqlEntry,

  getAllWithEmojiName: {
    oracle: `SELECT USER_ID, EMOJI_NAME
         FROM RPG_CLUB_USERS
        WHERE EMOJI_NAME IS NOT NULL`,
    postgres: ``,
  } satisfies SqlEntry,

  upsertJournalMessageContext: {
    oracle: `MERGE INTO JOURNAL_MESSAGE_CONTEXTS dst
       USING (SELECT :channelId AS CHANNEL_ID, :messageId AS MESSAGE_ID FROM DUAL) src
          ON (dst.CHANNEL_ID = src.CHANNEL_ID AND dst.MESSAGE_ID = src.MESSAGE_ID)
        WHEN MATCHED THEN
          UPDATE SET CREATED_AT_MS = :createdAtMs,
                     OWNER_USER_ID = :ownerUserId,
                     GAME_ID       = :gameId
        WHEN NOT MATCHED THEN
          INSERT (CHANNEL_ID, MESSAGE_ID, CREATED_AT_MS, OWNER_USER_ID, GAME_ID)
          VALUES (:channelId, :messageId, :createdAtMs, :ownerUserId, :gameId)`,
    postgres: ``,
  } satisfies SqlEntry,

  deleteJournalMessageContext: {
    oracle: `DELETE FROM JOURNAL_MESSAGE_CONTEXTS
        WHERE CHANNEL_ID = :channelId
          AND MESSAGE_ID = :messageId`,
    postgres: ``,
  } satisfies SqlEntry,

  loadActiveJournalMessageContexts: {
    oracle: `SELECT CHANNEL_ID, MESSAGE_ID, CREATED_AT_MS, OWNER_USER_ID, GAME_ID
         FROM JOURNAL_MESSAGE_CONTEXTS
        WHERE CREATED_AT_MS >= :cutoffMs`,
    postgres: ``,
  } satisfies SqlEntry,

  pruneExpiredJournalMessageContexts: {
    oracle: `DELETE FROM JOURNAL_MESSAGE_CONTEXTS WHERE CREATED_AT_MS < :cutoffMs`,
    postgres: ``,
  } satisfies SqlEntry,

  getGiveawayDonorNotifySetting: {
    oracle: `SELECT DONOR_NOTIFY_ON_CLAIM
         FROM RPG_CLUB_USERS
        WHERE USER_ID = :userId`,
    postgres: ``,
  } satisfies SqlEntry,

  updateGiveawayDonorNotifySetting: {
    oracle: `UPDATE RPG_CLUB_USERS
            SET DONOR_NOTIFY_ON_CLAIM = :enabled
          WHERE USER_ID = :userId`,
    postgres: ``,
  } satisfies SqlEntry,

  insertGiveawayDonorNotifySetting: {
    oracle: `INSERT INTO RPG_CLUB_USERS (USER_ID, DONOR_NOTIFY_ON_CLAIM)
           VALUES (:userId, :enabled)`,
    postgres: ``,
  } satisfies SqlEntry,

  countAvatarHistory: {
    oracle: `SELECT COUNT(*) AS TOTAL
         FROM RPG_CLUB_USER_AVATAR_HISTORY
        WHERE USER_ID = :userId`,
    postgres: ``,
  } satisfies SqlEntry,

  insertAvatarHistoryRecord: {
    oracle: `INSERT INTO RPG_CLUB_USER_AVATAR_HISTORY
       (USER_ID, AVATAR_HASH, AVATAR_URL, AVATAR_BLOB)
       VALUES (:userId, :avatarHash, :avatarUrl, :avatarBlob)`,
    postgres: ``,
  } satisfies SqlEntry,

  getAllMembersAvatarHistoryCounts: {
    oracle: `SELECT h.USER_ID,
              u.USERNAME,
              u.GLOBAL_NAME,
              COUNT(*) AS TOTAL
         FROM RPG_CLUB_USER_AVATAR_HISTORY h
         JOIN RPG_CLUB_USERS u ON u.USER_ID = h.USER_ID
        WHERE NVL(u.IS_BOT, 0) = 0
          AND u.SERVER_LEFT_AT IS NULL
        GROUP BY h.USER_ID, u.USERNAME, u.GLOBAL_NAME
        ORDER BY COALESCE(u.GLOBAL_NAME, u.USERNAME, h.USER_ID)`,
    postgres: ``,
  } satisfies SqlEntry,

  getMembersWithPlatforms: {
    oracle: `SELECT USER_ID,
              USERNAME,
              GLOBAL_NAME,
              STEAM_URL,
              PSN_USERNAME,
              XBL_USERNAME,
              NSW_FRIEND_CODE,
              SERVER_LEFT_AT
         FROM RPG_CLUB_USERS
        WHERE (STEAM_URL IS NOT NULL
               OR PSN_USERNAME IS NOT NULL
               OR XBL_USERNAME IS NOT NULL
               OR NSW_FRIEND_CODE IS NOT NULL)
          AND NVL(IS_BOT, 0) = 0
          AND SERVER_LEFT_AT IS NULL`,
    postgres: ``,
  } satisfies SqlEntry,

  checkLinkedThreadColumn: {
    oracle: `SELECT COUNT(*) AS CNT
           FROM ALL_TAB_COLUMNS
          WHERE OWNER = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')
            AND TABLE_NAME = 'GAMEDB_GAMES'
            AND COLUMN_NAME = 'LINKED_THREAD_ID'`,
    postgres: ``,
  } satisfies SqlEntry,
};
