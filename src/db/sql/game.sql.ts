import type { SqlEntry } from "./types.js";

const GAME_COLS = `GAME_ID, TITLE, DESCRIPTION, IMAGE_DATA, THUMBNAIL_BAD,
              THUMBNAIL_APPROVED, IGDB_ID, SLUG, TOTAL_RATING, IGDB_URL,
              FEATURED_VIDEO_URL, INITIAL_RELEASE_DATE, CREATED_AT, UPDATED_AT`;

const PLATFORM_COLS = `PLATFORM_ID,
              PLATFORM_CODE,
              PLATFORM_NAME,
              PLATFORM_ABBREVIATION,
              IGDB_PLATFORM_ID`;

const REGION_COLS = `REGION_ID, REGION_CODE, REGION_NAME, IGDB_REGION_ID`;

export const GameSql = {
  createGame: {
    oracle: `INSERT INTO GAMEDB_GAMES (
           TITLE,
           DESCRIPTION,
           IMAGE_DATA,
           IGDB_ID,
           SLUG,
           TOTAL_RATING,
           IGDB_URL,
           FEATURED_VIDEO_URL
         ) VALUES (
           :title,
           :description,
           :imageData,
           :igdbId,
           :slug,
           :totalRating,
           :igdbUrl,
           :featuredVideoUrl
         )
         RETURNING GAME_ID INTO :id`,
    postgres: ``,
  } satisfies SqlEntry,

  getGameById: {
    oracle: `SELECT GAME_ID, TITLE, DESCRIPTION, IMAGE_DATA, THUMBNAIL_BAD,
                THUMBNAIL_APPROVED, IGDB_ID, SLUG, TOTAL_RATING, IGDB_URL, FEATURED_VIDEO_URL,
                INITIAL_RELEASE_DATE, CREATED_AT, UPDATED_AT
           FROM GAMEDB_GAMES
          WHERE GAME_ID = :id`,
    postgres: ``,
  } satisfies SqlEntry,

  getGamesByIds: (placeholders: string) =>
    ({
      oracle: `SELECT ${GAME_COLS}
           FROM GAMEDB_GAMES
          WHERE GAME_ID IN (${placeholders})`,
      postgres: ``,
    }) satisfies SqlEntry,

  getAlternateVersions: {
    oracle: `SELECT ${GAME_COLS}
           FROM GAMEDB_GAMES
          WHERE GAME_ID IN (
            SELECT CASE
                     WHEN GAME_ID = :id THEN ALT_GAME_ID
                     ELSE GAME_ID
                   END
              FROM GAMEDB_GAME_ALTERNATES
             WHERE GAME_ID = :id OR ALT_GAME_ID = :id
          )
          ORDER BY UPPER(TITLE)`,
    postgres: ``,
  } satisfies SqlEntry,

  linkAlternateVersions: {
    oracle: `MERGE INTO GAMEDB_GAME_ALTERNATES t
         USING (
           SELECT :gameId AS GAME_ID,
                  :altGameId AS ALT_GAME_ID,
                  :createdBy AS CREATED_BY
             FROM dual
         ) s
            ON (t.GAME_ID = s.GAME_ID AND t.ALT_GAME_ID = s.ALT_GAME_ID)
         WHEN NOT MATCHED THEN
           INSERT (GAME_ID, ALT_GAME_ID, CREATED_BY)
           VALUES (s.GAME_ID, s.ALT_GAME_ID, s.CREATED_BY)`,
    postgres: ``,
  } satisfies SqlEntry,

  getGameByIgdbId: {
    oracle: `SELECT ${GAME_COLS}
           FROM GAMEDB_GAMES
          WHERE IGDB_ID = :igdbId`,
    postgres: ``,
  } satisfies SqlEntry,

  getOrInsertMetadataSelect: (
    idCol: string,
    table: string,
    igdbIdCol: string,
  ) =>
    ({
      oracle: `SELECT ${idCol} FROM ${table} WHERE ${igdbIdCol} = :igdbId`,
      postgres: ``,
    }) satisfies SqlEntry,

  getOrInsertMetadataInsert: (
    table: string,
    nameCol: string,
    idCol: string,
    igdbIdCol: string,
  ) =>
    ({
      oracle: `INSERT INTO ${table} (${nameCol}, ${igdbIdCol})
         VALUES (:name, :igdbId)
         RETURNING ${idCol} INTO :id`,
      postgres: ``,
    }) satisfies SqlEntry,

  insertGameCompany: {
    oracle: `INSERT INTO GAMEDB_GAME_COMPANIES (GAME_ID, COMPANY_ID, ROLE)
             VALUES (:gameId, :companyId, :role)`,
    postgres: ``,
  } satisfies SqlEntry,

  insertGameGenre: {
    oracle: `INSERT INTO GAMEDB_GAME_GENRES (GAME_ID, GENRE_ID) VALUES (:gameId, :genreId)`,
    postgres: ``,
  } satisfies SqlEntry,

  insertGameTheme: {
    oracle: `INSERT INTO GAMEDB_GAME_THEMES (GAME_ID, THEME_ID) VALUES (:gameId, :themeId)`,
    postgres: ``,
  } satisfies SqlEntry,

  insertGameMode: {
    oracle: `INSERT INTO GAMEDB_GAME_MODES (GAME_ID, MODE_ID) VALUES (:gameId, :modeId)`,
    postgres: ``,
  } satisfies SqlEntry,

  insertGamePerspective: {
    oracle: `INSERT INTO GAMEDB_GAME_PERSPECTIVES (GAME_ID, PERSPECTIVE_ID)
             VALUES (:gameId, :persId)`,
    postgres: ``,
  } satisfies SqlEntry,

  insertGameEngine: {
    oracle: `INSERT INTO GAMEDB_GAME_ENGINES (GAME_ID, ENGINE_ID) VALUES (:gameId, :engineId)`,
    postgres: ``,
  } satisfies SqlEntry,

  insertGameFranchise: {
    oracle: `INSERT INTO GAMEDB_GAME_FRANCHISES (GAME_ID, FRANCHISE_ID)
             VALUES (:gameId, :franchiseId)`,
    postgres: ``,
  } satisfies SqlEntry,

  updateCollectionId: {
    oracle: `UPDATE GAMEDB_GAMES SET COLLECTION_ID = :collectionId WHERE GAME_ID = :gameId`,
    postgres: ``,
  } satisfies SqlEntry,

  updateParentIgdbId: {
    oracle: `UPDATE GAMEDB_GAMES
               SET PARENT_IGDB_ID = :parentId,
                   PARENT_GAME_NAME = :parentName
             WHERE GAME_ID = :gameId`,
    postgres: ``,
  } satisfies SqlEntry,

  updateInitialReleaseDateSelect: {
    oracle: `SELECT MIN(RELEASE_DATE) AS MIN_DATE
         FROM GAMEDB_RELEASES
        WHERE GAME_ID = :gameId
          AND RELEASE_DATE IS NOT NULL`,
    postgres: ``,
  } satisfies SqlEntry,

  updateInitialReleaseDateUpdate: {
    oracle: `UPDATE GAMEDB_GAMES
          SET INITIAL_RELEASE_DATE = :releaseDate
        WHERE GAME_ID = :gameId`,
    postgres: ``,
  } satisfies SqlEntry,

  insertPlatform: {
    oracle: `INSERT INTO GAMEDB_PLATFORMS (PLATFORM_CODE, PLATFORM_NAME, IGDB_PLATFORM_ID)
         VALUES (:code, :name, :igdbId)`,
    postgres: ``,
  } satisfies SqlEntry,

  insertRegion: {
    oracle: `INSERT INTO GAMEDB_REGIONS (REGION_CODE, REGION_NAME, IGDB_REGION_ID)
         VALUES (:code, :name, :igdbId)
         RETURNING REGION_ID INTO :id`,
    postgres: ``,
  } satisfies SqlEntry,

  getGameCompanies: {
    oracle: `SELECT c.NAME FROM GAMEDB_COMPANIES c
       JOIN GAMEDB_GAME_COMPANIES gc ON c.COMPANY_ID = gc.COMPANY_ID
       WHERE gc.GAME_ID = :gameId AND gc.ROLE = :role`,
    postgres: ``,
  } satisfies SqlEntry,

  getSimpleList: (defTable: string, mapTable: string, idCol: string) =>
    ({
      oracle: `SELECT t.NAME FROM ${defTable} t
       JOIN ${mapTable} m ON t.${idCol} = m.${idCol}
       WHERE m.GAME_ID = :gameId`,
      postgres: ``,
    }) satisfies SqlEntry,

  getGameSeries: {
    oracle: `SELECT c.NAME FROM GAMEDB_COLLECTIONS c
       JOIN GAMEDB_GAMES g ON c.COLLECTION_ID = g.COLLECTION_ID
       WHERE g.GAME_ID = :gameId`,
    postgres: ``,
  } satisfies SqlEntry,

  insertRelease: {
    oracle: `INSERT INTO GAMEDB_RELEASES
       (GAME_ID, PLATFORM_ID, REGION_ID, FORMAT, RELEASE_DATE, NOTES)
       VALUES (:gameId, :platformId, :regionId, :format, :releaseDate, :notes)
       RETURNING RELEASE_ID INTO :id`,
    postgres: ``,
  } satisfies SqlEntry,

  getReleaseById: {
    oracle: `SELECT RELEASE_ID, GAME_ID, PLATFORM_ID, REGION_ID, FORMAT, RELEASE_DATE, NOTES
         FROM GAMEDB_RELEASES
        WHERE RELEASE_ID = :id`,
    postgres: ``,
  } satisfies SqlEntry,

  getGameReleases: {
    oracle: `SELECT RELEASE_ID, GAME_ID, PLATFORM_ID, REGION_ID, FORMAT, RELEASE_DATE, NOTES
         FROM GAMEDB_RELEASES
        WHERE GAME_ID = :gameId
        ORDER BY RELEASE_DATE ASC`,
    postgres: ``,
  } satisfies SqlEntry,

  getPlatformsForGame: {
    oracle: `SELECT DISTINCT p.PLATFORM_ID,
              p.PLATFORM_CODE,
              p.PLATFORM_NAME,
              p.PLATFORM_ABBREVIATION,
              p.IGDB_PLATFORM_ID
         FROM GAMEDB_RELEASES r
         JOIN GAMEDB_PLATFORMS p ON p.PLATFORM_ID = r.PLATFORM_ID
        WHERE r.GAME_ID = :gameId
        ORDER BY p.PLATFORM_NAME ASC`,
    postgres: ``,
  } satisfies SqlEntry,

  getAllPlatforms: {
    oracle: `SELECT ${PLATFORM_COLS}
         FROM GAMEDB_PLATFORMS
        ORDER BY PLATFORM_NAME ASC`,
    postgres: ``,
  } satisfies SqlEntry,

  getPlatformsByIgdbIds: (placeholders: string) =>
    ({
      oracle: `SELECT ${PLATFORM_COLS}
         FROM GAMEDB_PLATFORMS
        WHERE IGDB_PLATFORM_ID IN (${placeholders})`,
      postgres: ``,
    }) satisfies SqlEntry,

  attachPlatformsToGames: (placeholders: string) =>
    ({
      oracle: `SELECT gp.GAME_ID,
              gp.PLATFORM_ID,
              p.PLATFORM_CODE,
              p.PLATFORM_NAME,
              p.PLATFORM_ABBREVIATION,
              p.IGDB_PLATFORM_ID
         FROM GAMEDB_GAME_PLATFORMS gp
         LEFT JOIN GAMEDB_PLATFORMS p ON p.PLATFORM_ID = gp.PLATFORM_ID
        WHERE gp.GAME_ID IN (${placeholders})`,
      postgres: ``,
    }) satisfies SqlEntry,

  getPlatformByIgdbId: {
    oracle: `SELECT ${PLATFORM_COLS}
         FROM GAMEDB_PLATFORMS
        WHERE IGDB_PLATFORM_ID = :igdbId`,
    postgres: ``,
  } satisfies SqlEntry,

  getAllRegions: {
    oracle: `SELECT ${REGION_COLS}
         FROM GAMEDB_REGIONS
        ORDER BY REGION_NAME ASC`,
    postgres: ``,
  } satisfies SqlEntry,

  getRegionByCode: {
    oracle: `SELECT ${REGION_COLS}
         FROM GAMEDB_REGIONS
        WHERE REGION_CODE = :code`,
    postgres: ``,
  } satisfies SqlEntry,

  getRegionById: {
    oracle: `SELECT ${REGION_COLS}
         FROM GAMEDB_REGIONS
        WHERE REGION_ID = :id`,
    postgres: ``,
  } satisfies SqlEntry,

  getRegionByIgdbId: {
    oracle: `SELECT ${REGION_COLS}
         FROM GAMEDB_REGIONS
        WHERE IGDB_REGION_ID = :igdbId`,
    postgres: ``,
  } satisfies SqlEntry,

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
      postgres: ``,
    }) satisfies SqlEntry,

  getAllCompanies: {
    oracle: `SELECT COMPANY_ID, NAME, IGDB_COMPANY_ID
       FROM GAMEDB_COMPANIES
       ORDER BY NAME ASC`,
    postgres: ``,
  } satisfies SqlEntry,

  getCompanyById: {
    oracle: `SELECT COMPANY_ID, NAME, IGDB_COMPANY_ID
       FROM GAMEDB_COMPANIES
       WHERE COMPANY_ID = :id`,
    postgres: ``,
  } satisfies SqlEntry,

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
      postgres: ``,
    }) satisfies SqlEntry,

  addGamePlatformMerge: {
    oracle: `MERGE INTO GAMEDB_GAME_PLATFORMS gp
           USING (SELECT :gameId AS GAME_ID, :platformId AS PLATFORM_ID FROM dual) src
           ON (gp.GAME_ID = src.GAME_ID AND gp.PLATFORM_ID = src.PLATFORM_ID)
           WHEN NOT MATCHED THEN
             INSERT (GAME_ID, PLATFORM_ID) VALUES (src.GAME_ID, src.PLATFORM_ID)`,
    postgres: ``,
  } satisfies SqlEntry,

  getGamesForAudit: (combinedClause: string) =>
    ({
      oracle: `SELECT g.GAME_ID, g.TITLE, g.DESCRIPTION, g.IMAGE_DATA, g.IGDB_ID, g.SLUG,
                g.TOTAL_RATING, g.IGDB_URL, g.FEATURED_VIDEO_URL,
                g.INITIAL_RELEASE_DATE, g.CREATED_AT, g.UPDATED_AT
           FROM GAMEDB_GAMES g
          WHERE ${combinedClause}
          ORDER BY g.TITLE ASC`,
      postgres: ``,
    }) satisfies SqlEntry,

  updateGameImage: {
    oracle: `UPDATE GAMEDB_GAMES
         SET IMAGE_DATA = :imageData,
             UPDATED_AT = SYSTIMESTAMP
       WHERE GAME_ID = :gameId`,
    postgres: ``,
  } satisfies SqlEntry,

  updateGameThumbnailBad: {
    oracle: `UPDATE GAMEDB_GAMES
          SET THUMBNAIL_BAD = :thumbnailBad,
              UPDATED_AT = SYSTIMESTAMP
        WHERE GAME_ID = :gameId`,
    postgres: ``,
  } satisfies SqlEntry,

  updateGameThumbnailApproved: {
    oracle: `UPDATE GAMEDB_GAMES
          SET THUMBNAIL_APPROVED = :thumbnailApproved,
              UPDATED_AT = SYSTIMESTAMP
        WHERE GAME_ID = :gameId`,
    postgres: ``,
  } satisfies SqlEntry,

  getThreadStatusForGameIds: (placeholders: string) =>
    ({
      oracle: `SELECT DISTINCT g.GAME_ID
         FROM GAMEDB_GAMES g
        WHERE g.GAME_ID IN (${placeholders})
          AND (
            EXISTS (SELECT 1 FROM THREAD_GAME_LINKS tgl WHERE tgl.GAMEDB_GAME_ID = g.GAME_ID)
            OR EXISTS (SELECT 1 FROM THREADS th WHERE th.GAMEDB_GAME_ID = g.GAME_ID)
          )`,
      postgres: ``,
    }) satisfies SqlEntry,

  updateFeaturedVideoUrl: {
    oracle: `UPDATE GAMEDB_GAMES
          SET FEATURED_VIDEO_URL = :featuredVideoUrl,
              UPDATED_AT = SYSTIMESTAMP
        WHERE GAME_ID = :gameId`,
    postgres: ``,
  } satisfies SqlEntry,

  updateGameDescription: {
    oracle: `UPDATE GAMEDB_GAMES
          SET DESCRIPTION = :description,
              UPDATED_AT = SYSTIMESTAMP
        WHERE GAME_ID = :gameId`,
    postgres: ``,
  } satisfies SqlEntry,

  clearReleaseAnnouncements: {
    oracle: `DELETE FROM GAMEDB_RELEASE_ANNOUNCEMENTS
          WHERE RELEASE_ID IN (
            SELECT RELEASE_ID FROM GAMEDB_RELEASES WHERE GAME_ID = :gameId
          )`,
    postgres: ``,
  } satisfies SqlEntry,

  clearReleases: {
    oracle: `DELETE FROM GAMEDB_RELEASES WHERE GAME_ID = :gameId`,
    postgres: ``,
  } satisfies SqlEntry,

  clearInitialReleaseDate: {
    oracle: `UPDATE GAMEDB_GAMES
            SET INITIAL_RELEASE_DATE = NULL, UPDATED_AT = SYSTIMESTAMP
          WHERE GAME_ID = :gameId`,
    postgres: ``,
  } satisfies SqlEntry,

  touchGameUpdatedAt: {
    oracle: `UPDATE GAMEDB_GAMES SET UPDATED_AT = SYSTIMESTAMP WHERE GAME_ID = :gameId`,
    postgres: ``,
  } satisfies SqlEntry,

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
    postgres: ``,
  } satisfies SqlEntry,

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
    postgres: ``,
  } satisfies SqlEntry,

  getGotmNominations: {
    oracle: `SELECT n.ROUND_NUMBER, n.USER_ID, u.USERNAME, u.GLOBAL_NAME
           FROM GOTM_NOMINATIONS n
           LEFT JOIN RPG_CLUB_USERS u ON u.USER_ID = n.USER_ID
          WHERE n.GAMEDB_GAME_ID = :gameId
          ORDER BY n.ROUND_NUMBER`,
    postgres: ``,
  } satisfies SqlEntry,

  getNrGotmNominations: {
    oracle: `SELECT n.ROUND_NUMBER, n.USER_ID, u.USERNAME, u.GLOBAL_NAME
           FROM NR_GOTM_NOMINATIONS n
           LEFT JOIN RPG_CLUB_USERS u ON u.USER_ID = n.USER_ID
          WHERE n.GAMEDB_GAME_ID = :gameId
          ORDER BY n.ROUND_NUMBER`,
    postgres: ``,
  } satisfies SqlEntry,

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
    postgres: ``,
  } satisfies SqlEntry,

  getGameCompletions: {
    oracle: `SELECT c.USER_ID, u.USERNAME, u.GLOBAL_NAME,
              c.COMPLETION_TYPE, c.COMPLETED_AT, c.FINAL_PLAYTIME_HRS
         FROM USER_GAME_COMPLETIONS c
         LEFT JOIN RPG_CLUB_USERS u ON u.USER_ID = c.USER_ID
        WHERE c.GAMEDB_GAME_ID = :gameId
        ORDER BY c.COMPLETED_AT DESC NULLS LAST, c.CREATED_AT DESC, c.COMPLETION_ID DESC`,
    postgres: ``,
  } satisfies SqlEntry,

  getGameCollectionOwners: {
    oracle: `SELECT c.USER_ID, u.USERNAME, u.GLOBAL_NAME
         FROM USER_GAME_COLLECTIONS c
         LEFT JOIN RPG_CLUB_USERS u ON u.USER_ID = c.USER_ID
        WHERE c.GAMEDB_GAME_ID = :gameId
        GROUP BY c.USER_ID, u.USERNAME, u.GLOBAL_NAME
        ORDER BY LOWER(COALESCE(u.GLOBAL_NAME, u.USERNAME, c.USER_ID))`,
    postgres: ``,
  } satisfies SqlEntry,

  getPlatformByCode: {
    oracle: `SELECT ${PLATFORM_COLS}
         FROM GAMEDB_PLATFORMS
        WHERE PLATFORM_CODE = :code`,
    postgres: ``,
  } satisfies SqlEntry,

  getPlatformById: {
    oracle: `SELECT ${PLATFORM_COLS}
         FROM GAMEDB_PLATFORMS
        WHERE PLATFORM_ID = :id`,
    postgres: ``,
  } satisfies SqlEntry,
};
