import type { ISqlEntry } from "./types.js";

export const GameReleaseAnnouncementSql = {
  syncReleaseAnnouncements: {
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
    postgres: `UPDATE gamedb_release_announcements
          SET sent_at = :sentAt,
              skip_reason = NULL,
              updated_at = CURRENT_TIMESTAMP
        WHERE release_id = :releaseId
          AND sent_at IS NULL
          AND skipped_at IS NULL`,
  } satisfies ISqlEntry,

  markMissed: {
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
