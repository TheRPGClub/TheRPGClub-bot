import type { ISqlEntry } from "./types.js";

export const GameReleaseAnnouncementSql = {
  syncReleaseAnnouncements: {
    oracle: `MERGE INTO GAMEDB_RELEASE_ANNOUNCEMENTS a
         USING (
           SELECT r.RELEASE_ID, r.RELEASE_DATE - 7 AS ANNOUNCE_AT
           FROM GAMEDB_RELEASES r
           WHERE r.RELEASE_DATE IS NOT NULL
         ) src
         ON (a.RELEASE_ID = src.RELEASE_ID)
         WHEN MATCHED THEN
           UPDATE SET
             a.ANNOUNCE_AT = src.ANNOUNCE_AT,
             a.UPDATED_AT = CURRENT_TIMESTAMP
           WHERE a.SENT_AT IS NULL
             AND a.SKIPPED_AT IS NULL
             AND a.ANNOUNCE_AT <> src.ANNOUNCE_AT
         WHEN NOT MATCHED THEN
           INSERT (
             RELEASE_ID, ANNOUNCE_AT, SENT_AT, SKIPPED_AT,
             SKIP_REASON, CREATED_AT, UPDATED_AT
           )
           VALUES (
             src.RELEASE_ID, src.ANNOUNCE_AT, NULL, NULL, NULL,
             CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
           )`,
    postgres: `INSERT INTO gamedb_release_announcements
         (release_id, announce_at, sent_at, skipped_at, skip_reason, created_at, updated_at)
         SELECT r.release_id, r.release_date - INTERVAL '7 days', NULL, NULL, NULL,
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
           FROM gamedb_releases r
          WHERE r.release_date IS NOT NULL
         ON CONFLICT (release_id) DO UPDATE SET
           announce_at = EXCLUDED.announce_at,
           updated_at = CURRENT_TIMESTAMP
         WHERE gamedb_release_announcements.sent_at IS NULL
           AND gamedb_release_announcements.skipped_at IS NULL
           AND gamedb_release_announcements.announce_at <> EXCLUDED.announce_at`,
  } satisfies ISqlEntry,

  restoreNonCanonical: {
    oracle: `UPDATE GAMEDB_RELEASE_ANNOUNCEMENTS a
            SET a.SKIPPED_AT = NULL,
                a.SKIP_REASON = NULL,
                a.UPDATED_AT = CURRENT_TIMESTAMP
          WHERE a.SENT_AT IS NULL
            AND a.SKIP_REASON IN (:portOnlyReason, :sameDayReason)
            AND NOT EXISTS (
              SELECT 1
              FROM (
                SELECT ranked.RELEASE_ID
                FROM (
                  SELECT r.RELEASE_ID,
                         r.RELEASE_DATE,
                         MIN(r.RELEASE_DATE) OVER (PARTITION BY r.GAME_ID) AS FIRST_RELEASE_DATE,
                         ROW_NUMBER() OVER (
                           PARTITION BY r.GAME_ID, r.RELEASE_DATE
                           ORDER BY r.RELEASE_ID ASC
                         ) AS SAME_DAY_RANK
                  FROM GAMEDB_RELEASES r
                  WHERE r.RELEASE_DATE IS NOT NULL
                ) ranked
                WHERE ranked.RELEASE_DATE > ranked.FIRST_RELEASE_DATE
                   OR (
                     ranked.RELEASE_DATE = ranked.FIRST_RELEASE_DATE
                     AND ranked.SAME_DAY_RANK > 1
                   )
              ) non_canonical
              WHERE non_canonical.RELEASE_ID = a.RELEASE_ID
            )`,
    postgres: `UPDATE gamedb_release_announcements
            SET skipped_at = NULL,
                skip_reason = NULL,
                updated_at = CURRENT_TIMESTAMP
          WHERE sent_at IS NULL
            AND skip_reason IN (:portOnlyReason, :sameDayReason)
            AND NOT EXISTS (
              SELECT 1
              FROM (
                SELECT r.release_id,
                       r.release_date,
                       MIN(r.release_date) OVER (PARTITION BY r.game_id) AS first_release_date,
                       ROW_NUMBER() OVER (
                         PARTITION BY r.game_id, r.release_date
                         ORDER BY r.release_id ASC
                       ) AS same_day_rank
                FROM gamedb_releases r
                WHERE r.release_date IS NOT NULL
              ) ranked
              WHERE (ranked.release_date > ranked.first_release_date
                 OR (
                   ranked.release_date = ranked.first_release_date
                   AND ranked.same_day_rank > 1
                 ))
                AND ranked.release_id = gamedb_release_announcements.release_id
            )`,
  } satisfies ISqlEntry,

  markNonCanonical: {
    oracle: `MERGE INTO GAMEDB_RELEASE_ANNOUNCEMENTS a
       USING (
         SELECT ranked.RELEASE_ID,
                CASE
                  WHEN ranked.RELEASE_DATE > ranked.FIRST_RELEASE_DATE THEN :portOnlyReason
                  ELSE :sameDayReason
                END AS SKIP_REASON
         FROM (
           SELECT r.RELEASE_ID,
                  r.RELEASE_DATE,
                  MIN(r.RELEASE_DATE) OVER (PARTITION BY r.GAME_ID) AS FIRST_RELEASE_DATE,
                  ROW_NUMBER() OVER (
                    PARTITION BY r.GAME_ID, r.RELEASE_DATE
                    ORDER BY r.RELEASE_ID ASC
                  ) AS SAME_DAY_RANK
           FROM GAMEDB_RELEASES r
           WHERE r.RELEASE_DATE IS NOT NULL
         ) ranked
         WHERE ranked.RELEASE_DATE > ranked.FIRST_RELEASE_DATE
            OR (
              ranked.RELEASE_DATE = ranked.FIRST_RELEASE_DATE
              AND ranked.SAME_DAY_RANK > 1
            )
       ) src
       ON (a.RELEASE_ID = src.RELEASE_ID)
       WHEN MATCHED THEN
         UPDATE SET
           a.SKIPPED_AT = CURRENT_TIMESTAMP,
           a.SKIP_REASON = src.SKIP_REASON,
           a.UPDATED_AT = CURRENT_TIMESTAMP
         WHERE a.SENT_AT IS NULL
           AND a.SKIPPED_AT IS NULL`,
    postgres: `UPDATE gamedb_release_announcements a
         SET skipped_at = CURRENT_TIMESTAMP,
             skip_reason = src.skip_reason,
             updated_at = CURRENT_TIMESTAMP
        FROM (
          SELECT ranked.release_id,
                 CASE
                   WHEN ranked.release_date > ranked.first_release_date THEN :portOnlyReason
                   ELSE :sameDayReason
                 END AS skip_reason
          FROM (
            SELECT r.release_id,
                   r.release_date,
                   MIN(r.release_date) OVER (PARTITION BY r.game_id) AS first_release_date,
                   ROW_NUMBER() OVER (
                     PARTITION BY r.game_id, r.release_date
                     ORDER BY r.release_id ASC
                   ) AS same_day_rank
            FROM gamedb_releases r
            WHERE r.release_date IS NOT NULL
          ) ranked
          WHERE ranked.release_date > ranked.first_release_date
             OR (
               ranked.release_date = ranked.first_release_date
               AND ranked.same_day_rank > 1
             )
        ) src
        WHERE a.release_id = src.release_id
          AND a.sent_at IS NULL
          AND a.skipped_at IS NULL`,
  } satisfies ISqlEntry,

  listDueAnnouncements: {
    oracle: `SELECT a.RELEASE_ID,
              r.GAME_ID,
              g.TITLE,
              r.RELEASE_DATE,
              a.ANNOUNCE_AT,
              p.PLATFORM_NAME,
              p.PLATFORM_ABBREVIATION,
              g.IGDB_URL
         FROM GAMEDB_RELEASE_ANNOUNCEMENTS a
         JOIN GAMEDB_RELEASES r ON r.RELEASE_ID = a.RELEASE_ID
         JOIN GAMEDB_GAMES g ON g.GAME_ID = r.GAME_ID
         LEFT JOIN GAMEDB_PLATFORMS p ON p.PLATFORM_ID = r.PLATFORM_ID
         JOIN (
           SELECT canonical.RELEASE_ID
           FROM (
             SELECT r.RELEASE_ID,
                    r.RELEASE_DATE,
                    MIN(r.RELEASE_DATE) OVER (PARTITION BY r.GAME_ID) AS FIRST_RELEASE_DATE,
                    ROW_NUMBER() OVER (
                      PARTITION BY r.GAME_ID, r.RELEASE_DATE
                      ORDER BY r.RELEASE_ID ASC
                    ) AS SAME_DAY_RANK
             FROM GAMEDB_RELEASES r
             WHERE r.RELEASE_DATE IS NOT NULL
           ) canonical
           WHERE canonical.RELEASE_DATE = canonical.FIRST_RELEASE_DATE
             AND canonical.SAME_DAY_RANK = 1
         ) c ON c.RELEASE_ID = a.RELEASE_ID
        WHERE a.SENT_AT IS NULL
          AND a.SKIPPED_AT IS NULL
          AND a.ANNOUNCE_AT <= :referenceTime
          AND r.RELEASE_DATE > :referenceTime
        ORDER BY a.ANNOUNCE_AT ASC, r.RELEASE_DATE ASC, r.GAME_ID ASC, a.RELEASE_ID ASC
        FETCH FIRST :limit ROWS ONLY`,
    postgres: `SELECT a.release_id,
              r.game_id,
              g.title,
              r.release_date,
              a.announce_at,
              p.platform_name,
              p.platform_abbreviation,
              g.igdb_url
         FROM gamedb_release_announcements a
         JOIN gamedb_releases r ON r.release_id = a.release_id
         JOIN gamedb_games g ON g.game_id = r.game_id
         LEFT JOIN gamedb_platforms p ON p.platform_id = r.platform_id
         JOIN (
           SELECT canonical.release_id
           FROM (
             SELECT r.release_id,
                    r.release_date,
                    MIN(r.release_date) OVER (PARTITION BY r.game_id) AS first_release_date,
                    ROW_NUMBER() OVER (
                      PARTITION BY r.game_id, r.release_date
                      ORDER BY r.release_id ASC
                    ) AS same_day_rank
             FROM gamedb_releases r
             WHERE r.release_date IS NOT NULL
           ) canonical
           WHERE canonical.release_date = canonical.first_release_date
             AND canonical.same_day_rank = 1
         ) c ON c.release_id = a.release_id
        WHERE a.sent_at IS NULL
          AND a.skipped_at IS NULL
          AND a.announce_at <= :referenceTime
          AND r.release_date > :referenceTime
        ORDER BY a.announce_at ASC, r.release_date ASC, r.game_id ASC, a.release_id ASC
        LIMIT :limit`,
  } satisfies ISqlEntry,

  markSent: {
    oracle: `UPDATE GAMEDB_RELEASE_ANNOUNCEMENTS
          SET SENT_AT = :sentAt,
              SKIP_REASON = NULL,
              UPDATED_AT = CURRENT_TIMESTAMP
        WHERE RELEASE_ID = :releaseId
          AND SENT_AT IS NULL
          AND SKIPPED_AT IS NULL`,
    postgres: `UPDATE gamedb_release_announcements
          SET sent_at = :sentAt,
              skip_reason = NULL,
              updated_at = CURRENT_TIMESTAMP
        WHERE release_id = :releaseId
          AND sent_at IS NULL
          AND skipped_at IS NULL`,
  } satisfies ISqlEntry,

  markMissed: {
    oracle: `UPDATE GAMEDB_RELEASE_ANNOUNCEMENTS a
          SET a.SKIPPED_AT = :referenceTime,
              a.SKIP_REASON = :reason,
              a.UPDATED_AT = CURRENT_TIMESTAMP
        WHERE a.SENT_AT IS NULL
          AND a.SKIPPED_AT IS NULL
          AND a.ANNOUNCE_AT <= :referenceTime
          AND EXISTS (
            SELECT 1
            FROM GAMEDB_RELEASES r
            WHERE r.RELEASE_ID = a.RELEASE_ID
              AND r.RELEASE_DATE <= :referenceTime
          )`,
    postgres: `UPDATE gamedb_release_announcements
          SET skipped_at = :referenceTime,
              skip_reason = :reason,
              updated_at = CURRENT_TIMESTAMP
        WHERE sent_at IS NULL
          AND skipped_at IS NULL
          AND announce_at <= :referenceTime
          AND EXISTS (
            SELECT 1
            FROM gamedb_releases r
            WHERE r.release_id = gamedb_release_announcements.release_id
              AND r.release_date <= :referenceTime
          )`,
  } satisfies ISqlEntry,
};
