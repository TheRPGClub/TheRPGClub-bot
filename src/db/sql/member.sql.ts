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
    oracle: `UPDATE RPG_CLUB_USERS
            SET LAST_SEEN_AT = :lastSeen,
                UPDATED_AT = SYSTIMESTAMP
          WHERE USER_ID = :userId`,
    postgres: `UPDATE rpg_club_users
            SET last_seen_at = :lastSeen,
                updated_at = NOW()
          WHERE user_id = :userId`,
  } satisfies SqlEntry,

  // threadIdSql is a dialect-specific SQL fragment; caller must supply appropriate version
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
                COALESCE(jp.is_enabled, true) AS journal_enabled,
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
           LEFT JOIN user_game_journal_prefs jp
             ON jp.user_id = u.user_id
            AND jp.gamedb_game_id = u.gamedb_game_id
          WHERE u.user_id = :userId
            AND u.gamedb_game_id IS NOT NULL
          ORDER BY u.sort_order NULLS LAST, u.added_at DESC, u.entry_id DESC`,
    }) satisfies SqlEntry,

  // threadIdSql is a dialect-specific SQL fragment; caller must supply appropriate version
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
    postgres: `SELECT u.gamedb_game_id AS game_id,
              g.title,
              u.user_id
         FROM user_now_playing u
         JOIN rpg_club_users ru ON ru.user_id = u.user_id
         JOIN gamedb_games g ON g.game_id = u.gamedb_game_id
        WHERE (LOWER(g.title) LIKE :searchQuery
            OR REGEXP_REPLACE(LOWER(g.title), '[^a-z0-9]', '', 'g') LIKE :normalizedQuery)
          AND COALESCE(ru.is_bot, false) = false
          AND ru.server_left_at IS NULL
        ORDER BY g.title, u.user_id`,
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
    postgres: `SELECT u.gamedb_game_id AS game_id,
              g.title,
              u.platform_id,
              p.platform_name,
              p.platform_abbreviation,
              u.note,
              u.added_at,
              u.note_updated_at,
              u.sort_order,
              jp.is_enabled AS journal_enabled
         FROM user_now_playing u
         JOIN gamedb_games g ON g.game_id = u.gamedb_game_id
         LEFT JOIN gamedb_platforms p ON p.platform_id = u.platform_id
         LEFT JOIN user_game_journal_prefs jp
           ON jp.user_id = u.user_id
          AND jp.gamedb_game_id = u.gamedb_game_id
        WHERE u.user_id = :userId
          AND u.gamedb_game_id IS NOT NULL
        ORDER BY u.sort_order NULLS LAST, u.added_at DESC, u.entry_id DESC`,
  } satisfies SqlEntry,

  getNowPlayingEntryMeta: {
    oracle: `SELECT ADDED_AT
         FROM USER_NOW_PLAYING
        WHERE USER_ID = :userId
          AND GAMEDB_GAME_ID = :gameId`,
    postgres: `SELECT added_at
         FROM user_now_playing
        WHERE user_id = :userId
          AND gamedb_game_id = :gameId`,
  } satisfies SqlEntry,

  updateNowPlayingNote: {
    oracle: `UPDATE USER_NOW_PLAYING
          SET NOTE = :note,
              NOTE_UPDATED_AT = :noteUpdatedAt
        WHERE USER_ID = :userId
          AND GAMEDB_GAME_ID = :gameId`,
    postgres: `UPDATE user_now_playing
          SET note = :note,
              note_updated_at = :noteUpdatedAt
        WHERE user_id = :userId
          AND gamedb_game_id = :gameId`,
  } satisfies SqlEntry,

  countNowPlaying: {
    oracle: `SELECT COUNT(*) AS CNT FROM USER_NOW_PLAYING WHERE USER_ID = :userId`,
    postgres: `SELECT COUNT(*) AS cnt FROM user_now_playing WHERE user_id = :userId`,
  } satisfies SqlEntry,

  getNowPlayingMaxSort: {
    oracle: `SELECT MAX(SORT_ORDER) AS MAX_SORT
             FROM USER_NOW_PLAYING
            WHERE USER_ID = :userId`,
    postgres: `SELECT MAX(sort_order) AS max_sort
             FROM user_now_playing
            WHERE user_id = :userId`,
  } satisfies SqlEntry,

  insertNowPlaying: {
    oracle: `INSERT INTO USER_NOW_PLAYING
            (USER_ID, GAMEDB_GAME_ID, PLATFORM_ID, NOTE, NOTE_UPDATED_AT, SORT_ORDER)
           VALUES (:userId, :gameId, :platformId, :note, :noteUpdatedAt, :sortOrder)`,
    postgres: `INSERT INTO user_now_playing
            (user_id, gamedb_game_id, platform_id, note, note_updated_at, sort_order)
           VALUES (:userId, :gameId, :platformId, :note, :noteUpdatedAt, :sortOrder)`,
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
    postgres: `INSERT INTO user_game_journal_prefs (user_id, gamedb_game_id, is_enabled, default_is_public)
           VALUES (:userId, :gameId, true, false)
           ON CONFLICT (user_id, gamedb_game_id) DO UPDATE SET
             is_enabled = true,
             updated_at = NOW()`,
  } satisfies SqlEntry,

  getGameJournalPreference: {
    oracle: `SELECT USER_ID,
              GAMEDB_GAME_ID,
              IS_ENABLED
         FROM USER_GAME_JOURNAL_PREFS
        WHERE USER_ID = :userId
          AND GAMEDB_GAME_ID = :gameId`,
    postgres: `SELECT user_id,
              gamedb_game_id,
              is_enabled
         FROM user_game_journal_prefs
        WHERE user_id = :userId
          AND gamedb_game_id = :gameId`,
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
    postgres: `INSERT INTO user_game_journal_prefs (user_id, gamedb_game_id, is_enabled, default_is_public)
          VALUES (:userId, :gameId, :isEnabled, true)
          ON CONFLICT (user_id, gamedb_game_id) DO UPDATE SET
            is_enabled = EXCLUDED.is_enabled,
            default_is_public = true,
            updated_at = NOW()`,
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
      postgres: `SELECT gids.game_id,
              COUNT(*) AS journal_count,
              MAX(je.created_at) AS last_journal_at
         FROM (${inlineTable}) gids
         LEFT JOIN user_game_journal_entries je
           ON je.user_id = :userId
          AND je.gamedb_game_id = gids.game_id
        GROUP BY gids.game_id`,
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
  } satisfies SqlEntry,

  countGameJournalEntries: {
    oracle: `SELECT COUNT(*) AS CNT
         FROM USER_GAME_JOURNAL_ENTRIES
        WHERE USER_ID = :userId
          AND GAMEDB_GAME_ID = :gameId`,
    postgres: `SELECT COUNT(*) AS cnt
         FROM user_game_journal_entries
        WHERE user_id = :userId
          AND gamedb_game_id = :gameId`,
  } satisfies SqlEntry,

  addGameJournalEntry: {
    oracle: `INSERT INTO USER_GAME_JOURNAL_ENTRIES
        (USER_ID, GAMEDB_GAME_ID, ENTRY_TITLE, ENTRY_BODY, IS_PUBLIC)
       VALUES
        (:userId, :gameId, :title, :body, 1)`,
    postgres: `INSERT INTO user_game_journal_entries
        (user_id, gamedb_game_id, entry_title, entry_body, is_public)
       VALUES
        (:userId, :gameId, :title, :body, true)`,
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
  } satisfies SqlEntry,

  // Caller must pass lowercase column=value expressions for Postgres
  updateGameJournalEntry: (fields: string[]) =>
    ({
      oracle: `UPDATE USER_GAME_JOURNAL_ENTRIES
          SET ${fields.join(", ")}
        WHERE USER_ID = :userId
          AND ENTRY_ID = :entryId`,
      postgres: `UPDATE user_game_journal_entries
          SET ${fields.join(", ")}
        WHERE user_id = :userId
          AND entry_id = :entryId`,
    }) satisfies SqlEntry,

  deleteGameJournalEntry: {
    oracle: `DELETE FROM USER_GAME_JOURNAL_ENTRIES
        WHERE USER_ID = :userId
          AND ENTRY_ID = :entryId`,
    postgres: `DELETE FROM user_game_journal_entries
        WHERE user_id = :userId
          AND entry_id = :entryId`,
  } satisfies SqlEntry,

  updateNowPlayingSort: {
    oracle: `UPDATE USER_NOW_PLAYING
            SET SORT_ORDER = :sortOrder
          WHERE USER_ID = :userId
            AND GAMEDB_GAME_ID = :gameId`,
    postgres: `UPDATE user_now_playing
            SET sort_order = :sortOrder
          WHERE user_id = :userId
            AND gamedb_game_id = :gameId`,
  } satisfies SqlEntry,

  removeNowPlaying: {
    oracle: `DELETE FROM USER_NOW_PLAYING WHERE USER_ID = :userId AND GAMEDB_GAME_ID = :gameId`,
    postgres: `DELETE FROM user_now_playing WHERE user_id = :userId AND gamedb_game_id = :gameId`,
  } satisfies SqlEntry,

  addCompletion: {
    oracle: `INSERT INTO USER_GAME_COMPLETIONS (
          USER_ID, GAMEDB_GAME_ID, COMPLETION_TYPE, PLATFORM_ID,
          COMPLETED_AT, FINAL_PLAYTIME_HRS, NOTE
        ) VALUES (
          :userId, :gameId, :type, :platformId, :completedAt, :playtime, :note
        )
        RETURNING COMPLETION_ID INTO :completionId`,
    postgres: `INSERT INTO user_game_completions (
          user_id, gamedb_game_id, completion_type, platform_id,
          completed_at, final_playtime_hrs, note
        ) VALUES (
          :userId, :gameId, :type, :platformId, :completedAt, :playtime, :note
        )
        RETURNING completion_id`,
  } satisfies SqlEntry,

  verifyCompletion: {
    oracle: `SELECT COUNT(*) AS CNT FROM USER_GAME_COMPLETIONS
          WHERE COMPLETION_ID = :id AND USER_ID = :userId`,
    postgres: `SELECT COUNT(*) AS cnt FROM user_game_completions
          WHERE completion_id = :id AND user_id = :userId`,
  } satisfies SqlEntry,

  getCompletion: {
    oracle: `${COMPLETION_SELECT_SQL}
       WHERE c.COMPLETION_ID = :completionId`,
    postgres: `${COMPLETION_SELECT_SQL_PG}
       WHERE c.completion_id = :completionId`,
  } satisfies SqlEntry,

  getCompletionForUser: {
    oracle: `${COMPLETION_SELECT_SQL}
       WHERE c.USER_ID = :userId
         AND c.COMPLETION_ID = :completionId`,
    postgres: `${COMPLETION_SELECT_SQL_PG}
       WHERE c.user_id = :userId
         AND c.completion_id = :completionId`,
  } satisfies SqlEntry,

  getCompletionByGameId: {
    oracle: `${COMPLETION_SELECT_SQL}
       WHERE c.USER_ID = :userId
         AND c.GAMEDB_GAME_ID = :gameId
       FETCH FIRST 1 ROWS ONLY`,
    postgres: `${COMPLETION_SELECT_SQL_PG}
       WHERE c.user_id = :userId
         AND c.gamedb_game_id = :gameId
       LIMIT 1`,
  } satisfies SqlEntry,

  // Caller must pass dialect-appropriate whereClause
  getCompletions: (whereClause: string) =>
    ({
      oracle: `${COMPLETION_SELECT_SQL}
       WHERE ${whereClause}
       ORDER BY c.COMPLETED_AT DESC NULLS LAST, c.COMPLETION_ID DESC
       OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
      postgres: `${COMPLETION_SELECT_SQL_PG}
       WHERE ${whereClause}
       ORDER BY c.completed_at DESC NULLS LAST, c.completion_id DESC
       LIMIT :limit OFFSET :offset`,
    }) satisfies SqlEntry,

  getAllCompletions: {
    oracle: `${COMPLETION_SELECT_SQL}
       WHERE c.USER_ID = :userId
       ORDER BY c.COMPLETED_AT DESC NULLS LAST, c.CREATED_AT DESC, c.COMPLETION_ID DESC`,
    postgres: `${COMPLETION_SELECT_SQL_PG}
       WHERE c.user_id = :userId
       ORDER BY c.completed_at DESC NULLS LAST, c.created_at DESC, c.completion_id DESC`,
  } satisfies SqlEntry,

  // Caller must pass dialect-appropriate whereClause
  countCompletions: (whereClause: string) =>
    ({
      oracle: `SELECT COUNT(*) AS CNT
        FROM USER_GAME_COMPLETIONS c
        JOIN GAMEDB_GAMES g ON g.GAME_ID = c.GAMEDB_GAME_ID
       WHERE ${whereClause}`,
      postgres: `SELECT COUNT(*) AS cnt
        FROM user_game_completions c
        JOIN gamedb_games g ON g.game_id = c.gamedb_game_id
       WHERE ${whereClause}`,
    }) satisfies SqlEntry,

  // Caller must pass lowercase column=value expressions for Postgres
  updateCompletion: (fields: string[]) =>
    ({
      oracle: `UPDATE USER_GAME_COMPLETIONS
         SET ${fields.join(", ")}
       WHERE COMPLETION_ID = :completionId
         AND USER_ID = :userId`,
      postgres: `UPDATE user_game_completions
         SET ${fields.join(", ")}
       WHERE completion_id = :completionId
         AND user_id = :userId`,
    }) satisfies SqlEntry,

  deleteCompletion: {
    oracle: `DELETE FROM USER_GAME_COMPLETIONS
       WHERE COMPLETION_ID = :completionId
         AND USER_ID = :userId`,
    postgres: `DELETE FROM user_game_completions
       WHERE completion_id = :completionId
         AND user_id = :userId`,
  } satisfies SqlEntry,

  getCompletionsForGame: {
    oracle: `${COMPLETION_SELECT_SQL}
       WHERE c.USER_ID = :userId
         AND c.GAMEDB_GAME_ID = :gameId
       ORDER BY c.COMPLETED_AT DESC NULLS LAST, c.COMPLETION_ID DESC`,
    postgres: `${COMPLETION_SELECT_SQL_PG}
       WHERE c.user_id = :userId
         AND c.gamedb_game_id = :gameId
       ORDER BY c.completed_at DESC NULLS LAST, c.completion_id DESC`,
  } satisfies SqlEntry,

  getRecentCompletionForGame: {
    oracle: `${COMPLETION_SELECT_SQL}
       WHERE c.USER_ID = :userId
         AND c.GAMEDB_GAME_ID = :gameId
         AND COALESCE(c.COMPLETED_AT, c.CREATED_AT) BETWEEN :startDate AND :endDate
       ORDER BY COALESCE(c.COMPLETED_AT, c.CREATED_AT) DESC
       FETCH FIRST 1 ROWS ONLY`,
    postgres: `${COMPLETION_SELECT_SQL_PG}
       WHERE c.user_id = :userId
         AND c.gamedb_game_id = :gameId
         AND COALESCE(c.completed_at, c.created_at) BETWEEN :startDate AND :endDate
       ORDER BY COALESCE(c.completed_at, c.created_at) DESC
       LIMIT 1`,
  } satisfies SqlEntry,

  getRecentNickHistory: {
    oracle: `SELECT OLD_NICK, NEW_NICK, CHANGED_AT
           FROM RPG_CLUB_USER_NICK_HISTORY
          WHERE USER_ID = :userId
          ORDER BY CHANGED_AT DESC
          FETCH FIRST :limit ROWS ONLY`,
    postgres: `SELECT old_nick, new_nick, changed_at
           FROM rpg_club_user_nick_history
          WHERE user_id = :userId
          ORDER BY changed_at DESC
          LIMIT :limit`,
  } satisfies SqlEntry,

  // Caller must pass dialect-appropriate whereClause
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
      postgres: `SELECT c.user_id, u.username, u.global_name, COUNT(*) AS cnt
        FROM user_game_completions c
        JOIN rpg_club_users u ON u.user_id = c.user_id
        JOIN gamedb_games g ON g.game_id = c.gamedb_game_id
       WHERE ${whereClause}
       GROUP BY c.user_id, u.username, u.global_name
       ORDER BY cnt DESC
       LIMIT :limit`,
    }) satisfies SqlEntry,

  // Caller must pass dialect-appropriate where clause
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
  } satisfies SqlEntry,

  updateNowPlayingPlatform: {
    oracle: `UPDATE USER_NOW_PLAYING
          SET PLATFORM_ID = :platformId
        WHERE USER_ID = :userId
          AND GAMEDB_GAME_ID = :gameId`,
    postgres: `UPDATE user_now_playing
          SET platform_id = :platformId
        WHERE user_id = :userId
          AND gamedb_game_id = :gameId`,
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
  } satisfies SqlEntry,

  markDepartedNotIn: (placeholders: string) =>
    ({
      oracle: `UPDATE RPG_CLUB_USERS
             SET SERVER_LEFT_AT = SYSTIMESTAMP,
                 UPDATED_AT = SYSTIMESTAMP
           WHERE SERVER_LEFT_AT IS NULL
             AND USER_ID NOT IN (${placeholders})`,
      postgres: `UPDATE rpg_club_users
             SET server_left_at = NOW(),
                 updated_at = NOW()
           WHERE server_left_at IS NULL
             AND user_id NOT IN (${placeholders})`,
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
    postgres: `SELECT g.game_id,
              g.title,
              COUNT(e.entry_id) AS total_entries
         FROM user_game_journal_prefs jp
         JOIN gamedb_games g ON g.game_id = jp.gamedb_game_id
         LEFT JOIN user_game_journal_entries e
           ON e.user_id = jp.user_id
          AND e.gamedb_game_id = jp.gamedb_game_id
        WHERE jp.user_id = :userId
          AND jp.is_enabled = true
        GROUP BY g.game_id, g.title
       HAVING COUNT(e.entry_id) > 0
        ORDER BY g.title`,
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
  } satisfies SqlEntry,

  updateEmojiName: {
    oracle: `UPDATE RPG_CLUB_USERS
          SET EMOJI_NAME = :emojiName,
              UPDATED_AT = SYSTIMESTAMP
        WHERE USER_ID = :userId`,
    postgres: `UPDATE rpg_club_users
          SET emoji_name = :emojiName,
              updated_at = NOW()
        WHERE user_id = :userId`,
  } satisfies SqlEntry,

  getAllWithEmojiName: {
    oracle: `SELECT USER_ID, EMOJI_NAME
         FROM RPG_CLUB_USERS
        WHERE EMOJI_NAME IS NOT NULL`,
    postgres: `SELECT user_id, emoji_name
         FROM rpg_club_users
        WHERE emoji_name IS NOT NULL`,
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
    postgres: `INSERT INTO journal_message_contexts (channel_id, message_id, created_at_ms, owner_user_id, game_id)
          VALUES (:channelId, :messageId, :createdAtMs, :ownerUserId, :gameId)
          ON CONFLICT (channel_id, message_id) DO UPDATE SET
            created_at_ms = EXCLUDED.created_at_ms,
            owner_user_id = EXCLUDED.owner_user_id,
            game_id = EXCLUDED.game_id`,
  } satisfies SqlEntry,

  deleteJournalMessageContext: {
    oracle: `DELETE FROM JOURNAL_MESSAGE_CONTEXTS
        WHERE CHANNEL_ID = :channelId
          AND MESSAGE_ID = :messageId`,
    postgres: `DELETE FROM journal_message_contexts
        WHERE channel_id = :channelId
          AND message_id = :messageId`,
  } satisfies SqlEntry,

  loadActiveJournalMessageContexts: {
    oracle: `SELECT CHANNEL_ID, MESSAGE_ID, CREATED_AT_MS, OWNER_USER_ID, GAME_ID
         FROM JOURNAL_MESSAGE_CONTEXTS
        WHERE CREATED_AT_MS >= :cutoffMs`,
    postgres: `SELECT channel_id, message_id, created_at_ms, owner_user_id, game_id
         FROM journal_message_contexts
        WHERE created_at_ms >= :cutoffMs`,
  } satisfies SqlEntry,

  pruneExpiredJournalMessageContexts: {
    oracle: `DELETE FROM JOURNAL_MESSAGE_CONTEXTS WHERE CREATED_AT_MS < :cutoffMs`,
    postgres: `DELETE FROM journal_message_contexts WHERE created_at_ms < :cutoffMs`,
  } satisfies SqlEntry,

  getGiveawayDonorNotifySetting: {
    oracle: `SELECT DONOR_NOTIFY_ON_CLAIM
         FROM RPG_CLUB_USERS
        WHERE USER_ID = :userId`,
    postgres: `SELECT donor_notify_on_claim
         FROM rpg_club_users
        WHERE user_id = :userId`,
  } satisfies SqlEntry,

  updateGiveawayDonorNotifySetting: {
    oracle: `UPDATE RPG_CLUB_USERS
            SET DONOR_NOTIFY_ON_CLAIM = :enabled
          WHERE USER_ID = :userId`,
    postgres: `UPDATE rpg_club_users
            SET donor_notify_on_claim = :enabled
          WHERE user_id = :userId`,
  } satisfies SqlEntry,

  insertGiveawayDonorNotifySetting: {
    oracle: `INSERT INTO RPG_CLUB_USERS (USER_ID, DONOR_NOTIFY_ON_CLAIM)
           VALUES (:userId, :enabled)`,
    postgres: `INSERT INTO rpg_club_users (user_id, donor_notify_on_claim)
           VALUES (:userId, :enabled)`,
  } satisfies SqlEntry,

  countAvatarHistory: {
    oracle: `SELECT COUNT(*) AS TOTAL
         FROM RPG_CLUB_USER_AVATAR_HISTORY
        WHERE USER_ID = :userId`,
    postgres: `SELECT COUNT(*) AS total
         FROM rpg_club_user_avatar_history
        WHERE user_id = :userId`,
  } satisfies SqlEntry,

  insertAvatarHistoryRecord: {
    oracle: `INSERT INTO RPG_CLUB_USER_AVATAR_HISTORY
       (USER_ID, AVATAR_HASH, AVATAR_URL, AVATAR_BLOB)
       VALUES (:userId, :avatarHash, :avatarUrl, :avatarBlob)`,
    postgres: `INSERT INTO rpg_club_user_avatar_history
       (user_id, avatar_hash, avatar_url, avatar_blob)
       VALUES (:userId, :avatarHash, :avatarUrl, :avatarBlob)`,
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
  } satisfies SqlEntry,

  checkLinkedThreadColumn: {
    oracle: `SELECT COUNT(*) AS CNT
           FROM ALL_TAB_COLUMNS
          WHERE OWNER = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')
            AND TABLE_NAME = 'GAMEDB_GAMES'
            AND COLUMN_NAME = 'LINKED_THREAD_ID'`,
    postgres: `SELECT COUNT(*) AS cnt
           FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'gamedb_games'
            AND column_name = 'linked_thread_id'`,
  } satisfies SqlEntry,
};
