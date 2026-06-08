import type { SqlEntry } from "./types.js";

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
    postgres: ``,
  } satisfies SqlEntry,

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
    postgres: ``,
  } satisfies SqlEntry,

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
    postgres: ``,
  } satisfies SqlEntry,

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
    postgres: ``,
  } satisfies SqlEntry,

  markSent: {
    oracle: `UPDATE GAMEDB_RELEASE_ANNOUNCEMENTS
          SET SENT_AT = :sentAt,
              SKIP_REASON = NULL,
              UPDATED_AT = CURRENT_TIMESTAMP
        WHERE RELEASE_ID = :releaseId
          AND SENT_AT IS NULL
          AND SKIPPED_AT IS NULL`,
    postgres: ``,
  } satisfies SqlEntry,

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
    postgres: ``,
  } satisfies SqlEntry,
};
