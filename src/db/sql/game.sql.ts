import type { ISqlEntry } from "./types.js";

const PLATFORM_COLS_PG = `platform_id,
              platform_code,
              platform_name,
              platform_abbreviation,
              igdb_platform_id`;

export const GameSql = {
  // titleFoldExpr and titleNormExpr are dialect-specific SQL fragments
  searchGamesAutocomplete: (
    titleFoldExpr: string,
    titleNormExpr: string,
  ) =>
    ({
      postgres: `SELECT game_id, title, initial_release_date
           FROM gamedb_games
          WHERE ${titleFoldExpr} LIKE :rawContains
             OR (
               (:exactNorm)::text IS NOT NULL AND
               ${titleNormExpr} LIKE :normContains
             )
          ORDER BY CASE
                     WHEN ${titleFoldExpr} = :exactRaw THEN 0
                     WHEN ${titleFoldExpr} LIKE :rawPrefix THEN 1
                     WHEN (:exactNorm)::text IS NOT NULL AND
                          ${titleNormExpr} = :exactNorm THEN 2
                     WHEN (:exactNorm)::text IS NOT NULL AND
                          ${titleNormExpr} LIKE :normPrefix THEN 3
                     ELSE 4
                   END,
                   title ASC
          LIMIT :limit`,
    }) satisfies ISqlEntry,

  // whereClause and orderPrefix are dialect-specific SQL fragments
  searchGames: (whereClause: string, orderPrefix: string) =>
    ({
      postgres: `WITH upcoming AS (
           SELECT game_id, MIN(release_date) AS upcoming_date
             FROM gamedb_releases
            WHERE release_date > CURRENT_DATE
            GROUP BY game_id
         )
         SELECT g.game_id, g.title, g.description, g.igdb_id, g.slug, g.total_rating,
                g.igdb_url, g.featured_video_url, g.initial_release_date,
                g.created_at, g.updated_at,
                u.upcoming_date AS upcoming_release_date,
                (SELECT STRING_AGG(COALESCE(p.platform_abbreviation, p.platform_name), ','
                        ORDER BY p.platform_name)
                   FROM gamedb_releases r
                   JOIN gamedb_platforms p ON p.platform_id = r.platform_id
                  WHERE r.game_id = g.game_id AND r.release_date = u.upcoming_date
                ) AS upcoming_platforms
           FROM gamedb_games g
           LEFT JOIN upcoming u ON u.game_id = g.game_id
          WHERE ${whereClause}
          ORDER BY ${orderPrefix}g.title ASC`,
    }) satisfies ISqlEntry,

  getPlatformsForGame: {
    postgres: `SELECT DISTINCT p.platform_id,
              p.platform_code,
              p.platform_name,
              p.platform_abbreviation,
              p.igdb_platform_id
         FROM gamedb_releases r
         JOIN gamedb_platforms p ON p.platform_id = r.platform_id
        WHERE r.game_id = :gameId
        ORDER BY p.platform_name ASC`,
  } satisfies ISqlEntry,

  getAllPlatforms: {
    postgres: `SELECT ${PLATFORM_COLS_PG}
         FROM gamedb_platforms
        ORDER BY platform_name ASC`,
  } satisfies ISqlEntry,

  getPlatformsByIgdbIds: (placeholders: string) =>
    ({
      postgres: `SELECT ${PLATFORM_COLS_PG}
         FROM gamedb_platforms
        WHERE igdb_platform_id IN (${placeholders})`,
    }) satisfies ISqlEntry,

  attachPlatformsToGames: (placeholders: string) =>
    ({
      postgres: `SELECT gp.game_id,
              gp.platform_id,
              p.platform_code,
              p.platform_name,
              p.platform_abbreviation,
              p.igdb_platform_id
         FROM gamedb_game_platforms gp
         LEFT JOIN gamedb_platforms p ON p.platform_id = gp.platform_id
        WHERE gp.game_id IN (${placeholders})`,
    }) satisfies ISqlEntry,

  getPlatformByCode: {
    postgres: `SELECT ${PLATFORM_COLS_PG}
         FROM gamedb_platforms
        WHERE platform_code = :code`,
  } satisfies ISqlEntry,

  getRegionByCode: {
    postgres: `SELECT region_id, region_code, region_name, igdb_region_id
         FROM gamedb_regions
        WHERE region_code = :code`,
  } satisfies ISqlEntry,

  addGamePlatformMerge: {
    postgres: `INSERT INTO gamedb_game_platforms (game_id, platform_id)
           VALUES (:gameId, :platformId)
           ON CONFLICT (game_id, platform_id) DO NOTHING`,
  } satisfies ISqlEntry,

  getGotmWins: {
    postgres: `SELECT ge.round_number,
                COALESCE(
                  (SELECT MIN(tgl.thread_id)
                     FROM thread_game_links tgl
                    WHERE tgl.gamedb_game_id = ge.gamedb_game_id),
                  (SELECT MIN(th.thread_id)
                     FROM threads th
                    WHERE th.gamedb_game_id = ge.gamedb_game_id)
                ) AS thread_id,
                ge.reddit_url, ge.month_year
           FROM gotm_entries ge
          WHERE ge.gamedb_game_id = :gameId
          ORDER BY ge.round_number`,
  } satisfies ISqlEntry,

  getNrGotmWins: {
    postgres: `SELECT nge.round_number,
                COALESCE(
                  (SELECT MIN(tgl.thread_id)
                     FROM thread_game_links tgl
                    WHERE tgl.gamedb_game_id = nge.gamedb_game_id),
                  (SELECT MIN(th.thread_id)
                     FROM threads th
                    WHERE th.gamedb_game_id = nge.gamedb_game_id)
                ) AS thread_id,
                nge.reddit_url, nge.month_year
           FROM nr_gotm_entries nge
          WHERE nge.gamedb_game_id = :gameId
          ORDER BY nge.round_number`,
  } satisfies ISqlEntry,

  getGotmNominations: {
    postgres: `SELECT n.round_number, n.user_id, u.username, u.global_name
           FROM gotm_nominations n
           LEFT JOIN rpg_club_users u ON u.user_id = n.user_id
          WHERE n.gamedb_game_id = :gameId
          ORDER BY n.round_number`,
  } satisfies ISqlEntry,

  getNrGotmNominations: {
    postgres: `SELECT n.round_number, n.user_id, u.username, u.global_name
           FROM nr_gotm_nominations n
           LEFT JOIN rpg_club_users u ON u.user_id = n.user_id
          WHERE n.gamedb_game_id = :gameId
          ORDER BY n.round_number`,
  } satisfies ISqlEntry,

  getGameCollectionOwners: {
    postgres: `SELECT c.user_id, u.username, u.global_name
         FROM user_game_collections c
         LEFT JOIN rpg_club_users u ON u.user_id = c.user_id
        WHERE c.gamedb_game_id = :gameId
        GROUP BY c.user_id, u.username, u.global_name
        ORDER BY LOWER(COALESCE(u.global_name, u.username, c.user_id))`,
  } satisfies ISqlEntry,
};
