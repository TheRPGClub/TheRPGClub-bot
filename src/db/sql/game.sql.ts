import type { ISqlEntry } from "./types.js";

const GAME_COLS_PG = `game_id, title, description, thumbnail_bad,
              thumbnail_approved, igdb_id, slug, total_rating, igdb_url,
              featured_video_url, initial_release_date, created_at, updated_at`;

const PLATFORM_COLS_PG = `platform_id,
              platform_code,
              platform_name,
              platform_abbreviation,
              igdb_platform_id`;

const REGION_COLS = `REGION_ID, REGION_CODE, REGION_NAME, IGDB_REGION_ID`;
const REGION_COLS_PG = `region_id, region_code, region_name, igdb_region_id`;

export const GameSql = {
  createGame: {
    postgres: `INSERT INTO gamedb_games (
           title,
           description,
           igdb_id,
           slug,
           total_rating,
           igdb_url,
           featured_video_url
         ) VALUES (
           :title,
           :description,
           :igdbId,
           :slug,
           :totalRating,
           :igdbUrl,
           :featuredVideoUrl
         )
         RETURNING game_id`,
  } satisfies ISqlEntry,

  getGameById: {
    postgres: `SELECT game_id, title, description, thumbnail_bad,
                thumbnail_approved, igdb_id, slug, total_rating, igdb_url, featured_video_url,
                initial_release_date, created_at, updated_at
           FROM gamedb_games
          WHERE game_id = :id`,
  } satisfies ISqlEntry,

  getGamesByIds: (placeholders: string) =>
    ({
      postgres: `SELECT ${GAME_COLS_PG}
           FROM gamedb_games
          WHERE game_id IN (${placeholders})`,
    }) satisfies ISqlEntry,

  getAlternateVersions: {
    postgres: `SELECT ${GAME_COLS_PG}
           FROM gamedb_games
          WHERE game_id IN (
            SELECT CASE
                     WHEN game_id = :id THEN alt_game_id
                     ELSE game_id
                   END
              FROM gamedb_game_alternates
             WHERE game_id = :id OR alt_game_id = :id
          )
          ORDER BY UPPER(title)`,
  } satisfies ISqlEntry,

  linkAlternateVersions: {
    postgres: `INSERT INTO gamedb_game_alternates (game_id, alt_game_id, created_by)
           VALUES (:gameId, :altGameId, :createdBy)
           ON CONFLICT (game_id, alt_game_id) DO NOTHING`,
  } satisfies ISqlEntry,

  getGameByIgdbId: {
    postgres: `SELECT ${GAME_COLS_PG}
           FROM gamedb_games
          WHERE igdb_id = :igdbId`,
  } satisfies ISqlEntry,

  // Caller should pass lowercase identifiers for Postgres
  getOrInsertMetadataSelect: (
    idCol: string,
    table: string,
    igdbIdCol: string,
  ) =>
    ({
      postgres: `SELECT ${idCol.toLowerCase()} FROM ${table.toLowerCase()} WHERE ${igdbIdCol.toLowerCase()} = :igdbId`,
    }) satisfies ISqlEntry,

  // Caller should pass lowercase identifiers for Postgres
  getOrInsertMetadataInsert: (
    table: string,
    nameCol: string,
    idCol: string,
    igdbIdCol: string,
  ) =>
    ({
      postgres: `INSERT INTO ${table.toLowerCase()} (${nameCol.toLowerCase()}, ${igdbIdCol.toLowerCase()})
         VALUES (:name, :igdbId)
         RETURNING ${idCol.toLowerCase()}`,
    }) satisfies ISqlEntry,

  insertGameCompany: {
    postgres: `INSERT INTO gamedb_game_companies (game_id, company_id, role)
             VALUES (:gameId, :companyId, :role)`,
  } satisfies ISqlEntry,

  insertGameGenre: {
    postgres: `INSERT INTO gamedb_game_genres (game_id, genre_id) VALUES (:gameId, :genreId)`,
  } satisfies ISqlEntry,

  insertGameTheme: {
    postgres: `INSERT INTO gamedb_game_themes (game_id, theme_id) VALUES (:gameId, :themeId)`,
  } satisfies ISqlEntry,

  insertGameMode: {
    postgres: `INSERT INTO gamedb_game_modes (game_id, mode_id) VALUES (:gameId, :modeId)`,
  } satisfies ISqlEntry,

  insertGamePerspective: {
    postgres: `INSERT INTO gamedb_game_perspectives (game_id, perspective_id)
             VALUES (:gameId, :persId)`,
  } satisfies ISqlEntry,

  insertGameEngine: {
    postgres: `INSERT INTO gamedb_game_engines (game_id, engine_id) VALUES (:gameId, :engineId)`,
  } satisfies ISqlEntry,

  insertGameFranchise: {
    postgres: `INSERT INTO gamedb_game_franchises (game_id, franchise_id)
             VALUES (:gameId, :franchiseId)`,
  } satisfies ISqlEntry,

  updateCollectionId: {
    postgres: `UPDATE gamedb_games SET collection_id = :collectionId WHERE game_id = :gameId`,
  } satisfies ISqlEntry,

  updateParentIgdbId: {
    postgres: `UPDATE gamedb_games
               SET parent_igdb_id = :parentId,
                   parent_game_name = :parentName
             WHERE game_id = :gameId`,
  } satisfies ISqlEntry,

  updateInitialReleaseDateSelect: {
    postgres: `SELECT MIN(release_date) AS min_date
         FROM gamedb_releases
        WHERE game_id = :gameId
          AND release_date IS NOT NULL`,
  } satisfies ISqlEntry,

  updateInitialReleaseDateUpdate: {
    postgres: `UPDATE gamedb_games
          SET initial_release_date = :releaseDate
        WHERE game_id = :gameId`,
  } satisfies ISqlEntry,

  insertPlatform: {
    postgres: `INSERT INTO gamedb_platforms (platform_code, platform_name, igdb_platform_id)
         VALUES (:code, :name, :igdbId)`,
  } satisfies ISqlEntry,

  insertRegion: {
    postgres: `INSERT INTO gamedb_regions (region_code, region_name, igdb_region_id)
         VALUES (:code, :name, :igdbId)
         RETURNING region_id`,
  } satisfies ISqlEntry,

  getGameCompanies: {
    postgres: `SELECT c.name FROM gamedb_companies c
       JOIN gamedb_game_companies gc ON c.company_id = gc.company_id
       WHERE gc.game_id = :gameId AND gc.role = :role`,
  } satisfies ISqlEntry,

  // Caller should pass lowercase identifiers for Postgres
  getSimpleList: (defTable: string, mapTable: string, idCol: string) =>
    ({
      postgres: `SELECT t.name FROM ${defTable.toLowerCase()} t
       JOIN ${mapTable.toLowerCase()} m ON t.${idCol.toLowerCase()} = m.${idCol.toLowerCase()}
       WHERE m.game_id = :gameId`,
    }) satisfies ISqlEntry,

  getGameSeries: {
    postgres: `SELECT c.name FROM gamedb_collections c
       JOIN gamedb_games g ON c.collection_id = g.collection_id
       WHERE g.game_id = :gameId`,
  } satisfies ISqlEntry,

  insertRelease: {
    postgres: `INSERT INTO gamedb_releases
       (game_id, platform_id, region_id, format, release_date, notes)
       VALUES (:gameId, :platformId, :regionId, :format, :releaseDate, :notes)
       RETURNING release_id`,
  } satisfies ISqlEntry,

  getReleaseById: {
    postgres: `SELECT release_id, game_id, platform_id, region_id, format, release_date, notes
         FROM gamedb_releases
        WHERE release_id = :id`,
  } satisfies ISqlEntry,

  getGameReleases: {
    postgres: `SELECT release_id, game_id, platform_id, region_id, format, release_date, notes
         FROM gamedb_releases
        WHERE game_id = :gameId
        ORDER BY release_date ASC`,
  } satisfies ISqlEntry,

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

  getPlatformByIgdbId: {
    postgres: `SELECT ${PLATFORM_COLS_PG}
         FROM gamedb_platforms
        WHERE igdb_platform_id = :igdbId`,
  } satisfies ISqlEntry,

  getAllRegions: {
    postgres: `SELECT ${REGION_COLS_PG}
         FROM gamedb_regions
        ORDER BY region_name ASC`,
  } satisfies ISqlEntry,

  getRegionByCode: {
    oracle: `SELECT ${REGION_COLS}
         FROM GAMEDB_REGIONS
        WHERE REGION_CODE = :code`,
    postgres: `SELECT ${REGION_COLS_PG}
         FROM gamedb_regions
        WHERE region_code = :code`,
  } satisfies ISqlEntry,

  getRegionById: {
    oracle: `SELECT ${REGION_COLS}
         FROM GAMEDB_REGIONS
        WHERE REGION_ID = :id`,
    postgres: `SELECT ${REGION_COLS_PG}
         FROM gamedb_regions
        WHERE region_id = :id`,
  } satisfies ISqlEntry,

  getRegionByIgdbId: {
    oracle: `SELECT ${REGION_COLS}
         FROM GAMEDB_REGIONS
        WHERE IGDB_REGION_ID = :igdbId`,
    postgres: `SELECT ${REGION_COLS_PG}
         FROM gamedb_regions
        WHERE igdb_region_id = :igdbId`,
  } satisfies ISqlEntry,

  // titleFoldExpr and titleNormExpr are dialect-specific SQL fragments
  searchGamesAutocomplete: (
    titleFoldExpr: string,
    titleNormExpr: string,
  ) =>
    ({
      oracle: `SELECT GAME_ID, TITLE, INITIAL_RELEASE_DATE
           FROM GAMEDB_GAMES
          WHERE ${titleFoldExpr} LIKE :rawContains
             OR (
               :exactNorm IS NOT NULL AND
               ${titleNormExpr} LIKE :normContains
             )
          ORDER BY CASE
                     WHEN ${titleFoldExpr} = :exactRaw THEN 0
                     WHEN ${titleFoldExpr} LIKE :rawPrefix THEN 1
                     WHEN :exactNorm IS NOT NULL AND
                          ${titleNormExpr} = :exactNorm THEN 2
                     WHEN :exactNorm IS NOT NULL AND
                          ${titleNormExpr} LIKE :normPrefix THEN 3
                     ELSE 4
                   END,
                   TITLE ASC
          FETCH FIRST :limit ROWS ONLY`,
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

  getAllCompanies: {
    oracle: `SELECT COMPANY_ID, NAME, IGDB_COMPANY_ID
       FROM GAMEDB_COMPANIES
       ORDER BY NAME ASC`,
    postgres: `SELECT company_id, name, igdb_company_id
       FROM gamedb_companies
       ORDER BY name ASC`,
  } satisfies ISqlEntry,

  getCompanyById: {
    oracle: `SELECT COMPANY_ID, NAME, IGDB_COMPANY_ID
       FROM GAMEDB_COMPANIES
       WHERE COMPANY_ID = :id`,
    postgres: `SELECT company_id, name, igdb_company_id
       FROM gamedb_companies
       WHERE company_id = :id`,
  } satisfies ISqlEntry,

  // whereClause and orderPrefix are dialect-specific SQL fragments
  searchGames: (whereClause: string, orderPrefix: string) =>
    ({
      oracle: `WITH upcoming AS (
           SELECT GAME_ID, MIN(RELEASE_DATE) AS UPCOMING_DATE
             FROM GAMEDB_RELEASES
            WHERE RELEASE_DATE > SYSDATE
            GROUP BY GAME_ID
         )
         SELECT g.GAME_ID, g.TITLE, g.DESCRIPTION, g.IGDB_ID, g.SLUG, g.TOTAL_RATING,
                g.IGDB_URL, g.FEATURED_VIDEO_URL, g.INITIAL_RELEASE_DATE,
                g.CREATED_AT, g.UPDATED_AT,
                u.UPCOMING_DATE AS UPCOMING_RELEASE_DATE,
                (SELECT LISTAGG(COALESCE(p.PLATFORM_ABBREVIATION, p.PLATFORM_NAME), ',')
                        WITHIN GROUP (ORDER BY p.PLATFORM_NAME)
                   FROM GAMEDB_RELEASES r
                   JOIN GAMEDB_PLATFORMS p ON p.PLATFORM_ID = r.PLATFORM_ID
                  WHERE r.GAME_ID = g.GAME_ID AND r.RELEASE_DATE = u.UPCOMING_DATE
                ) AS UPCOMING_PLATFORMS
           FROM GAMEDB_GAMES g
           LEFT JOIN upcoming u ON u.GAME_ID = g.GAME_ID
          WHERE ${whereClause}
          ORDER BY ${orderPrefix}g.TITLE ASC`,
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

  addGamePlatformMerge: {
    oracle: `MERGE INTO GAMEDB_GAME_PLATFORMS gp
           USING (SELECT :gameId AS GAME_ID, :platformId AS PLATFORM_ID FROM dual) src
           ON (gp.GAME_ID = src.GAME_ID AND gp.PLATFORM_ID = src.PLATFORM_ID)
           WHEN NOT MATCHED THEN
             INSERT (GAME_ID, PLATFORM_ID) VALUES (src.GAME_ID, src.PLATFORM_ID)`,
    postgres: `INSERT INTO gamedb_game_platforms (game_id, platform_id)
           VALUES (:gameId, :platformId)
           ON CONFLICT (game_id, platform_id) DO NOTHING`,
  } satisfies ISqlEntry,

  // combinedClause is a dialect-specific SQL fragment
  getGamesForAudit: (combinedClause: string) =>
    ({
      oracle: `SELECT g.GAME_ID, g.TITLE, g.DESCRIPTION, g.IMAGE_DATA, g.IGDB_ID, g.SLUG,
                g.TOTAL_RATING, g.IGDB_URL, g.FEATURED_VIDEO_URL,
                g.INITIAL_RELEASE_DATE, g.CREATED_AT, g.UPDATED_AT
           FROM GAMEDB_GAMES g
          WHERE ${combinedClause}
          ORDER BY g.TITLE ASC`,
      postgres: `SELECT g.game_id, g.title, g.description, g.igdb_id, g.slug,
                g.total_rating, g.igdb_url, g.featured_video_url,
                g.initial_release_date, g.created_at, g.updated_at
           FROM gamedb_games g
          WHERE ${combinedClause}
          ORDER BY g.title ASC`,
    }) satisfies ISqlEntry,

  updateGameImage: {
    oracle: `UPDATE GAMEDB_GAMES
         SET IMAGE_DATA = :imageData,
             UPDATED_AT = SYSTIMESTAMP
       WHERE GAME_ID = :gameId`,
    postgres: `UPDATE gamedb_games
         SET updated_at = NOW()
       WHERE game_id = :gameId`,
  } satisfies ISqlEntry,

  updateGameThumbnailBad: {
    oracle: `UPDATE GAMEDB_GAMES
          SET THUMBNAIL_BAD = :thumbnailBad,
              UPDATED_AT = SYSTIMESTAMP
        WHERE GAME_ID = :gameId`,
    postgres: `UPDATE gamedb_games
          SET thumbnail_bad = :thumbnailBad,
              updated_at = NOW()
        WHERE game_id = :gameId`,
  } satisfies ISqlEntry,

  updateGameThumbnailApproved: {
    oracle: `UPDATE GAMEDB_GAMES
          SET THUMBNAIL_APPROVED = :thumbnailApproved,
              UPDATED_AT = SYSTIMESTAMP
        WHERE GAME_ID = :gameId`,
    postgres: `UPDATE gamedb_games
          SET thumbnail_approved = :thumbnailApproved,
              updated_at = NOW()
        WHERE game_id = :gameId`,
  } satisfies ISqlEntry,

  getThreadStatusForGameIds: (placeholders: string) =>
    ({
      oracle: `SELECT DISTINCT g.GAME_ID
         FROM GAMEDB_GAMES g
        WHERE g.GAME_ID IN (${placeholders})
          AND (
            EXISTS (SELECT 1 FROM THREAD_GAME_LINKS tgl WHERE tgl.GAMEDB_GAME_ID = g.GAME_ID)
            OR EXISTS (SELECT 1 FROM THREADS th WHERE th.GAMEDB_GAME_ID = g.GAME_ID)
          )`,
      postgres: `SELECT DISTINCT g.game_id
         FROM gamedb_games g
        WHERE g.game_id IN (${placeholders})
          AND (
            EXISTS (SELECT 1 FROM thread_game_links tgl WHERE tgl.gamedb_game_id = g.game_id)
            OR EXISTS (SELECT 1 FROM threads th WHERE th.gamedb_game_id = g.game_id)
          )`,
    }) satisfies ISqlEntry,

  updateFeaturedVideoUrl: {
    oracle: `UPDATE GAMEDB_GAMES
          SET FEATURED_VIDEO_URL = :featuredVideoUrl,
              UPDATED_AT = SYSTIMESTAMP
        WHERE GAME_ID = :gameId`,
    postgres: `UPDATE gamedb_games
          SET featured_video_url = :featuredVideoUrl,
              updated_at = NOW()
        WHERE game_id = :gameId`,
  } satisfies ISqlEntry,

  updateGameDescription: {
    oracle: `UPDATE GAMEDB_GAMES
          SET DESCRIPTION = :description,
              UPDATED_AT = SYSTIMESTAMP
        WHERE GAME_ID = :gameId`,
    postgres: `UPDATE gamedb_games
          SET description = :description,
              updated_at = NOW()
        WHERE game_id = :gameId`,
  } satisfies ISqlEntry,

  clearReleaseAnnouncements: {
    oracle: `DELETE FROM GAMEDB_RELEASE_ANNOUNCEMENTS
          WHERE RELEASE_ID IN (
            SELECT RELEASE_ID FROM GAMEDB_RELEASES WHERE GAME_ID = :gameId
          )`,
    postgres: `DELETE FROM gamedb_release_announcements
          WHERE release_id IN (
            SELECT release_id FROM gamedb_releases WHERE game_id = :gameId
          )`,
  } satisfies ISqlEntry,

  clearReleases: {
    oracle: `DELETE FROM GAMEDB_RELEASES WHERE GAME_ID = :gameId`,
    postgres: `DELETE FROM gamedb_releases WHERE game_id = :gameId`,
  } satisfies ISqlEntry,

  clearInitialReleaseDate: {
    oracle: `UPDATE GAMEDB_GAMES
            SET INITIAL_RELEASE_DATE = NULL, UPDATED_AT = SYSTIMESTAMP
          WHERE GAME_ID = :gameId`,
    postgres: `UPDATE gamedb_games
            SET initial_release_date = NULL, updated_at = NOW()
          WHERE game_id = :gameId`,
  } satisfies ISqlEntry,

  touchGameUpdatedAt: {
    oracle: `UPDATE GAMEDB_GAMES SET UPDATED_AT = SYSTIMESTAMP WHERE GAME_ID = :gameId`,
    postgres: `UPDATE gamedb_games SET updated_at = NOW() WHERE game_id = :gameId`,
  } satisfies ISqlEntry,

  getGotmWins: {
    oracle: `SELECT ge.ROUND_NUMBER,
                COALESCE(
                  (SELECT MIN(tgl.THREAD_ID)
                     FROM THREAD_GAME_LINKS tgl
                    WHERE tgl.GAMEDB_GAME_ID = ge.GAMEDB_GAME_ID),
                  (SELECT MIN(th.THREAD_ID)
                     FROM THREADS th
                    WHERE th.GAMEDB_GAME_ID = ge.GAMEDB_GAME_ID)
                ) AS THREAD_ID,
                ge.REDDIT_URL, ge.MONTH_YEAR
           FROM GOTM_ENTRIES ge
          WHERE ge.GAMEDB_GAME_ID = :gameId
          ORDER BY ge.ROUND_NUMBER`,
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
    oracle: `SELECT nge.ROUND_NUMBER,
                COALESCE(
                  (SELECT MIN(tgl.THREAD_ID)
                     FROM THREAD_GAME_LINKS tgl
                    WHERE tgl.GAMEDB_GAME_ID = nge.GAMEDB_GAME_ID),
                  (SELECT MIN(th.THREAD_ID)
                     FROM THREADS th
                    WHERE th.GAMEDB_GAME_ID = nge.GAMEDB_GAME_ID)
                ) AS THREAD_ID,
                nge.REDDIT_URL, nge.MONTH_YEAR
           FROM NR_GOTM_ENTRIES nge
          WHERE nge.GAMEDB_GAME_ID = :gameId
          ORDER BY nge.ROUND_NUMBER`,
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
    oracle: `SELECT n.ROUND_NUMBER, n.USER_ID, u.USERNAME, u.GLOBAL_NAME
           FROM GOTM_NOMINATIONS n
           LEFT JOIN RPG_CLUB_USERS u ON u.USER_ID = n.USER_ID
          WHERE n.GAMEDB_GAME_ID = :gameId
          ORDER BY n.ROUND_NUMBER`,
    postgres: `SELECT n.round_number, n.user_id, u.username, u.global_name
           FROM gotm_nominations n
           LEFT JOIN rpg_club_users u ON u.user_id = n.user_id
          WHERE n.gamedb_game_id = :gameId
          ORDER BY n.round_number`,
  } satisfies ISqlEntry,

  getNrGotmNominations: {
    oracle: `SELECT n.ROUND_NUMBER, n.USER_ID, u.USERNAME, u.GLOBAL_NAME
           FROM NR_GOTM_NOMINATIONS n
           LEFT JOIN RPG_CLUB_USERS u ON u.USER_ID = n.USER_ID
          WHERE n.GAMEDB_GAME_ID = :gameId
          ORDER BY n.ROUND_NUMBER`,
    postgres: `SELECT n.round_number, n.user_id, u.username, u.global_name
           FROM nr_gotm_nominations n
           LEFT JOIN rpg_club_users u ON u.user_id = n.user_id
          WHERE n.gamedb_game_id = :gameId
          ORDER BY n.round_number`,
  } satisfies ISqlEntry,

  getNowPlayingMembers: {
    oracle: `SELECT u.USER_ID,
              ru.USERNAME,
              ru.GLOBAL_NAME,
              COALESCE(
                (SELECT MIN(tgl.THREAD_ID) FROM THREAD_GAME_LINKS tgl
                  WHERE tgl.GAMEDB_GAME_ID = u.GAMEDB_GAME_ID),
                (SELECT MIN(th.THREAD_ID) FROM THREADS th
                  WHERE th.GAMEDB_GAME_ID = u.GAMEDB_GAME_ID)
              ) AS THREAD_ID,
              u.ADDED_AT
         FROM USER_NOW_PLAYING u
         JOIN RPG_CLUB_USERS ru ON ru.USER_ID = u.USER_ID
        WHERE u.GAMEDB_GAME_ID = :gameId
        ORDER BY u.ADDED_AT DESC, u.ENTRY_ID DESC`,
    postgres: `SELECT u.user_id,
              ru.username,
              ru.global_name,
              COALESCE(
                (SELECT MIN(tgl.thread_id) FROM thread_game_links tgl
                  WHERE tgl.gamedb_game_id = u.gamedb_game_id),
                (SELECT MIN(th.thread_id) FROM threads th
                  WHERE th.gamedb_game_id = u.gamedb_game_id)
              ) AS thread_id,
              u.added_at
         FROM user_now_playing u
         JOIN rpg_club_users ru ON ru.user_id = u.user_id
        WHERE u.gamedb_game_id = :gameId
        ORDER BY u.added_at DESC, u.entry_id DESC`,
  } satisfies ISqlEntry,

  getGameCompletions: {
    oracle: `SELECT c.USER_ID, u.USERNAME, u.GLOBAL_NAME,
              c.COMPLETION_TYPE, c.COMPLETED_AT, c.FINAL_PLAYTIME_HRS
         FROM USER_GAME_COMPLETIONS c
         LEFT JOIN RPG_CLUB_USERS u ON u.USER_ID = c.USER_ID
        WHERE c.GAMEDB_GAME_ID = :gameId
        ORDER BY c.COMPLETED_AT DESC NULLS LAST, c.CREATED_AT DESC, c.COMPLETION_ID DESC`,
    postgres: `SELECT c.user_id, u.username, u.global_name,
              c.completion_type, c.completed_at, c.final_playtime_hrs
         FROM user_game_completions c
         LEFT JOIN rpg_club_users u ON u.user_id = c.user_id
        WHERE c.gamedb_game_id = :gameId
        ORDER BY c.completed_at DESC NULLS LAST, c.created_at DESC, c.completion_id DESC`,
  } satisfies ISqlEntry,

  getGameCollectionOwners: {
    oracle: `SELECT c.USER_ID, u.USERNAME, u.GLOBAL_NAME
         FROM USER_GAME_COLLECTIONS c
         LEFT JOIN RPG_CLUB_USERS u ON u.USER_ID = c.USER_ID
        WHERE c.GAMEDB_GAME_ID = :gameId
        GROUP BY c.USER_ID, u.USERNAME, u.GLOBAL_NAME
        ORDER BY LOWER(COALESCE(u.GLOBAL_NAME, u.USERNAME, c.USER_ID))`,
    postgres: `SELECT c.user_id, u.username, u.global_name
         FROM user_game_collections c
         LEFT JOIN rpg_club_users u ON u.user_id = c.user_id
        WHERE c.gamedb_game_id = :gameId
        GROUP BY c.user_id, u.username, u.global_name
        ORDER BY LOWER(COALESCE(u.global_name, u.username, c.user_id))`,
  } satisfies ISqlEntry,

  getPlatformByCode: {
    oracle: `SELECT ${PLATFORM_COLS}
         FROM GAMEDB_PLATFORMS
        WHERE PLATFORM_CODE = :code`,
    postgres: `SELECT ${PLATFORM_COLS_PG}
         FROM gamedb_platforms
        WHERE platform_code = :code`,
  } satisfies ISqlEntry,

  getPlatformById: {
    oracle: `SELECT ${PLATFORM_COLS}
         FROM GAMEDB_PLATFORMS
        WHERE PLATFORM_ID = :id`,
    postgres: `SELECT ${PLATFORM_COLS_PG}
         FROM gamedb_platforms
        WHERE platform_id = :id`,
  } satisfies ISqlEntry,
};
