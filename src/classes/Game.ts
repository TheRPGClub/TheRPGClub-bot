import axios from "axios";
import {
  dbQuery,
  dbMutate,
  dbInsert,
  dbWithConnection,
  dbTransaction,
  dbQueryConn,
  dbMutateConn,
} from "../db/SqlManager.js";
import { GameSql } from "../db/sql/index.js";
import type { IGDBGameDetails } from "../services/IGDB/IgdbService.js";
import GameSearchSynonym from "./GameSearchSynonym.js";
import {
  apiGet,
  apiGetRaw,
  type ApiGetRawMeta,
} from "../services/RpgClubApiClient.js";
import { isPositiveInt } from "../utilities/ValidationUtils.js";
import { logError, logWarn } from "../utilities/LogUtils.js";
import {
  mapGameFromApi,
  mapGameRow,
  mapReleaseRow,
  mapReleaseFromApi,
  mapPlatformDefRow,
  mapPlatformFromApi,
  mapRegionDefRow,
  mapRegionFromApi,
  buildPlatformCode,
  IGDB_REGION_MAP,
  type ReleaseApiData,
  type PlatformApiData,
  type RegionApiData,
} from "../functions/GameMappers.js";
import type {
  IGame,
  IRelease,
  IReleaseWithNames,
  IPlatformDef,
  IGameWithPlatforms,
  IGameSearchResult,
  IGameAutocompleteResult,
  IRegionDef,
  ICompany,
  IGameAssociationSummary,
  INowPlayingMember,
  ICompletedMember,
  ICollectionOwnerMember,
  IMappedGameProfile,
  GameSource,
} from "../types/GameTypes.js";
import {
  clearAutocompleteSearchCaches,
  autocompleteSearchCache,
  pendingAutocompleteSearches,
  foldAccentE,
  buildAutocompleteCacheKey,
  pruneAutocompleteCache,
  AUTOCOMPLETE_CACHE_TTL_MS,
} from "../functions/GameAutocompleteCache.js";
import {
  type GameRelationsApiData,
  type NowPlayingApiEntry,
  type CompletionGameApiEntry,
  type CompanyApiData,
  type GameProfileApiData,
  mapGameProfileFromApi,
} from "../functions/GameProfileMapper.js";
import {
  importGameFromIgdb as _importGameFromIgdb,
  importReleaseDatesFromIgdb as _importReleaseDatesFromIgdb,
  saveFullGameMetadata as _saveFullGameMetadata,
  addGamePlatformsByIgdbIds as _addGamePlatformsByIgdbIds,
  updateInitialReleaseDate as _updateInitialReleaseDate,
  saveReleaseDates,
} from "../functions/GameIgdbSync.js";

export default class Game {
  static async createGame(
    title: string,
    description: string | null,
    imageData: Buffer | null,
    igdbId: number | null = null,
    slug: string | null = null,
    totalRating: number | null = null,
    igdbUrl: string | null = null,
    featuredVideoUrl: string | null = null,
  ): Promise<IGame> {
    const gameId = await dbInsert(
      GameSql.createGame,
      {
        title,
        description,
        imageData: imageData || null,
        igdbId: igdbId || null,
        slug: slug || null,
        totalRating: totalRating || null,
        igdbUrl: igdbUrl || null,
        featuredVideoUrl: featuredVideoUrl || null,
      },
      "id",
    );

    if (!gameId) throw new Error("Failed to retrieve GAME_ID after insert.");

    const newGame = await Game.getGameById(gameId);
    if (!newGame) throw new Error("Failed to fetch newly created game.");
    clearAutocompleteSearchCaches();
    return newGame;
  }

  /**
   * Returns the raw `data` payload from the Rails API for a game, without any
   * field mapping. Useful for debugging what the API actually returns.
   */
  static async getGameRawFromApi(id: number): Promise<unknown> {
    const result = await apiGet<{ data: unknown }>(`/api/v1/games/${id}`);
    return result?.data ?? null;
  }

  /**
   * Like `getGameRawFromApi` but also returns HTTP status, request/response
   * headers, and the full raw response body so callers can log diagnostics.
   * HTTP errors (4xx/5xx) are returned as values; check `errorMessage`.
   */
  static async getGameRawFromApiWithMeta(
    id: number,
  ): Promise<ApiGetRawMeta & { gameData: unknown }> {
    const meta = await apiGetRaw<{ data: unknown }>(`/api/v1/games/${id}`);
    const body = meta.rawData as { data?: unknown } | null;
    return { ...meta, gameData: body?.data ?? null };
  }

  static async getGameById(
    id: number,
    source: GameSource = "API",
  ): Promise<IGame | null> {
    if (source === "API") {
      const result = await apiGet<{ data: unknown }>(`/api/v1/games/${id}`);
      const data = result?.data;
      return data ? mapGameFromApi(data) : null;
    }

    return dbWithConnection(async (conn) => {
      const rows = await dbQueryConn(
        conn,
        GameSql.getGameById,
        { id },
        mapGameRow,
      );
      return rows[0] ?? null;
    });
  }

  static async getGamesByIds(ids: number[]): Promise<IGame[]> {
    const uniqueIds = Array.from(new Set(ids.filter(isPositiveInt)));
    if (!uniqueIds.length) return [];

    const binds: Record<string, number> = {};
    const placeholders: string[] = [];
    uniqueIds.forEach((id, idx) => {
      const key = `id${idx}`;
      binds[key] = id;
      placeholders.push(`:${key}`);
    });

    return dbWithConnection(async (conn) => {
      const entry = GameSql.getGamesByIds(placeholders.join(", "));
      return dbQueryConn(conn, entry, binds, mapGameRow);
    });
  }

  static async getAlternateVersions(gameId: number): Promise<IGame[]> {
    if (!isPositiveInt(gameId)) return [];
    const relations = await Game.getGameRelations(gameId);
    if (!relations?.alternates?.length) return [];
    return relations.alternates.map(mapGameFromApi);
  }

  static async linkAlternateVersions(
    gameIds: number[],
    createdBy: string | null,
  ): Promise<number> {
    const uniqueIds = Array.from(new Set(gameIds.filter(isPositiveInt))).sort(
      (a, b) => a - b,
    );
    if (uniqueIds.length < 2) {
      throw new Error("At least two GameDB ids are required to link versions.");
    }

    const pairs: Array<{
      gameId: number;
      altGameId: number;
      createdBy: string | null;
    }> = [];
    for (let i = 0; i < uniqueIds.length; i += 1) {
      for (let j = i + 1; j < uniqueIds.length; j += 1) {
        pairs.push({
          gameId: uniqueIds[i],
          altGameId: uniqueIds[j],
          createdBy,
        });
      }
    }

    await dbTransaction(async (conn) => {
      for (const pair of pairs) {
        await dbMutateConn(conn, GameSql.linkAlternateVersions, pair);
      }
    });
    return pairs.length;
  }

  static async getAllGameIdsWithIgdb(): Promise<number[]> {
    const rows = await dbQuery<{ GAME_ID: number }, number>(
      GameSql.getAllGameIdsWithIgdb,
      {},
      (row) => row.GAME_ID,
    );
    return rows;
  }

  static async getGameByIgdbId(igdbId: number): Promise<IGame | null> {
    return dbWithConnection(async (conn) => {
      const rows = await dbQueryConn(
        conn,
        GameSql.getGameByIgdbId,
        { igdbId },
        mapGameRow,
      );
      return rows[0] ?? null;
    });
  }

  static getFeaturedVideoUrl(details: IGDBGameDetails): string | null {
    const videoId = details.videos?.[0]?.video_id;
    if (!videoId) {
      return null;
    }
    return `https://www.youtube.com/watch?v=${videoId}`;
  }

  static async importGameFromIgdb(
    igdbId: number,
  ): Promise<{ gameId: number; title: string }> {
    return _importGameFromIgdb(igdbId);
  }

  static async importReleaseDatesFromIgdb(
    gameId: number,
    igdbId: number,
  ): Promise<void> {
    return _importReleaseDatesFromIgdb(gameId, igdbId);
  }

  static async saveFullGameMetadata(
    gameId: number,
    details: IGDBGameDetails,
  ): Promise<void> {
    return _saveFullGameMetadata(gameId, details);
  }

  static async updateInitialReleaseDate(gameId: number): Promise<void> {
    return _updateInitialReleaseDate(gameId);
  }

  static async ensurePlatform(igdbPlatform: {
    id: number;
    name: string | null;
  }): Promise<IPlatformDef | null> {
    const existing = await Game.getPlatformByIgdbId(igdbPlatform.id);
    if (existing) {
      return existing;
    }

    try {
      await dbMutate(GameSql.insertPlatform, {
        code: buildPlatformCode(igdbPlatform.name, igdbPlatform.id),
        name: igdbPlatform.name ?? `IGDB Platform ${igdbPlatform.id}`,
        igdbId: igdbPlatform.id,
      });
      return Game.getPlatformByIgdbId(igdbPlatform.id);
    } catch (err) {
      logError("Game.insertPlatform", err);
      return null;
    }
  }

  static async ensureRegion(igdbRegionId: number): Promise<IRegionDef | null> {
    const existing = await Game.getRegionByIgdbId(igdbRegionId);
    if (existing) {
      return existing;
    }

    const regionConfig = IGDB_REGION_MAP[igdbRegionId];
    if (!regionConfig) {
      return null;
    }

    try {
      const regionId = await dbInsert(
        GameSql.insertRegion,
        {
          code: regionConfig.code,
          name: regionConfig.name,
          igdbId: igdbRegionId,
        },
        "id",
      );
      return Game.getRegionById(regionId);
    } catch (err) {
      logError("Game.insertRegion", err);
      return null;
    }
  }

  // --- Getters for View ---

  static async getGameDevelopers(gameId: number): Promise<string[]> {
    return Game.getGameCompanies(gameId, "Developer");
  }

  static async getGamePublishers(gameId: number): Promise<string[]> {
    return Game.getGameCompanies(gameId, "Publisher");
  }

  private static async getGameCompanies(
    gameId: number,
    role: string,
  ): Promise<string[]> {
    const relations = await Game.getGameRelations(gameId);
    if (!relations) return [];
    return relations.companies
      .filter((c) => c.role === role)
      .map((c) => String(c.name));
  }

  static async getGameGenres(gameId: number): Promise<string[]> {
    const relations = await Game.getGameRelations(gameId);
    return (relations?.genres ?? []).map((g) => String(g.name));
  }

  static async getGameThemes(gameId: number): Promise<string[]> {
    const relations = await Game.getGameRelations(gameId);
    return (relations?.themes ?? []).map((g) => String(g.name));
  }

  static async getGameModes(gameId: number): Promise<string[]> {
    const relations = await Game.getGameRelations(gameId);
    return (relations?.modes ?? []).map((g) => String(g.name));
  }

  static async getGamePerspectives(gameId: number): Promise<string[]> {
    const relations = await Game.getGameRelations(gameId);
    return (relations?.perspectives ?? []).map((g) => String(g.name));
  }

  static async getGameEngines(gameId: number): Promise<string[]> {
    const relations = await Game.getGameRelations(gameId);
    return (relations?.engines ?? []).map((g) => String(g.name));
  }

  static async getGameFranchises(gameId: number): Promise<string[]> {
    const relations = await Game.getGameRelations(gameId);
    return (relations?.franchises ?? []).map((g) => String(g.name));
  }

  static async getGameSeries(gameId: number): Promise<string | null> {
    const relations = await Game.getGameRelations(gameId);
    return relations?.collection?.name ?? null;
  }

  static async addReleaseInfo(
    gameId: number,
    platformId: number,
    regionId: number,
    format: "Physical" | "Digital" | null,
    releaseDate: Date | null,
    notes: string | null,
  ): Promise<IRelease> {
    const releaseId = await dbInsert(
      GameSql.insertRelease,
      {
        gameId,
        platformId,
        regionId,
        format,
        releaseDate: releaseDate || null,
        notes: notes || null,
      },
      "id",
    );
    if (!releaseId)
      throw new Error("Failed to retrieve RELEASE_ID after insert.");
    const newRelease = await Game.getReleaseById(releaseId);
    if (!newRelease) throw new Error("Failed to fetch newly created release.");
    return newRelease;
  }

  private static async fetchAllPages<T>(
    path: string,
    params: Record<string, unknown> = {},
  ): Promise<T[]> {
    const results: T[] = [];
    let page = 1;
    for (;;) {
      const result = await apiGet<{ data: T[]; meta: { next: number | null } }>(
        path,
        { params: { ...params, page, per: 500 } },
      );
      if (!result?.data?.length) break;
      results.push(...result.data);
      if (!result.meta?.next) break;
      page++;
    }
    return results;
  }

  private static readonly relationsCache = new Map<
    number,
    { promise: Promise<GameRelationsApiData | null>; expires: number }
  >();

  private static readonly RELATIONS_CACHE_TTL_MS = 2000;

  private static async getGameRelations(
    gameId: number,
  ): Promise<GameRelationsApiData | null> {
    const now = Date.now();
    const cached = Game.relationsCache.get(gameId);
    if (cached && cached.expires > now) return cached.promise;

    const promise = (async () => {
      const result = await apiGet<{ data: GameRelationsApiData }>(
        `/api/v1/games/${gameId}/relations`,
      );
      return result?.data ?? null;
    })();
    promise.catch(() => Game.relationsCache.delete(gameId));

    Game.relationsCache.set(gameId, {
      promise,
      expires: now + Game.RELATIONS_CACHE_TTL_MS,
    });
    return promise;
  }

  static async getGameReleasesDetailed(
    gameId: number,
  ): Promise<IReleaseWithNames[]> {
    const relations = await Game.getGameRelations(gameId);
    if (!relations?.releases?.length) return [];
    return relations.releases.map((r) => ({
      ...mapReleaseFromApi(r),
      platformName: r.platform_name ?? null,
      regionName: r.region_name ?? null,
    }));
  }

  static async getReleaseById(id: number): Promise<IRelease | null> {
    const rows = await dbQuery(GameSql.getReleaseById, { id }, mapReleaseRow);
    return rows[0] ?? null;
  }

  static async getGameReleases(gameId: number): Promise<IRelease[]> {
    const result = await apiGet<{ data: ReleaseApiData[] }>(
      `/api/v1/games/${gameId}/releases`,
    );
    if (!result?.data) return [];
    return result.data.map(mapReleaseFromApi);
  }

  static async getPlatformsForGame(gameId: number): Promise<IPlatformDef[]> {
    return dbQuery(GameSql.getPlatformsForGame, { gameId }, mapPlatformDefRow);
  }

  static async getAllPlatforms(): Promise<IPlatformDef[]> {
    return dbQuery(GameSql.getAllPlatforms, {}, mapPlatformDefRow);
  }

  static async getPlatformsByIgdbIds(
    igdbIds: number[],
  ): Promise<Map<number, IPlatformDef>> {
    const uniqueIds = Array.from(new Set(igdbIds.filter(isPositiveInt)));
    if (!uniqueIds.length) {
      return new Map();
    }

    const binds: Record<string, number> = {};
    const placeholders: string[] = [];
    uniqueIds.forEach((id, idx) => {
      const key = `id${idx}`;
      binds[key] = id;
      placeholders.push(`:${key}`);
    });

    const platforms = await dbQuery(
      GameSql.getPlatformsByIgdbIds(placeholders.join(", ")),
      binds,
      mapPlatformDefRow,
    );
    const map = new Map<number, IPlatformDef>();
    platforms.forEach((platform) => {
      if (platform.igdbPlatformId) map.set(platform.igdbPlatformId, platform);
    });
    return map;
  }

  static async getPlatformsForGameWithStandard(
    gameId: number,
    standardPlatformIds: number[],
  ): Promise<IPlatformDef[]> {
    const gamePlatforms = await Game.getPlatformsForGame(gameId);
    const allPlatforms = await Game.getAllPlatforms();
    const byId = new Map(
      allPlatforms.map((platform) => [platform.id, platform]),
    );
    const seen = new Set<number>();
    const merged: IPlatformDef[] = [];

    for (const platform of gamePlatforms) {
      const full = byId.get(platform.id) ?? platform;
      if (!seen.has(platform.id)) {
        merged.push(full);
        seen.add(platform.id);
      }
    }

    const extra = standardPlatformIds
      .filter((id) => !seen.has(id))
      .map((id) => byId.get(id))
      .filter((platform): platform is IPlatformDef => Boolean(platform));

    extra.sort((a, b) => a.name.localeCompare(b.name));
    merged.push(...extra);

    return merged;
  }

  static async getPlatformByCode(code: string): Promise<IPlatformDef | null> {
    const rows = await dbQuery(
      GameSql.getPlatformByCode,
      { code },
      mapPlatformDefRow,
    );
    return rows[0] ?? null;
  }

  static async getPlatformById(id: number): Promise<IPlatformDef | null> {
    const result = await apiGet<{ data: PlatformApiData }>(`/api/v1/platforms/${id}`);
    if (!result?.data) return null;
    return mapPlatformFromApi(result.data);
  }

  static async attachPlatformsToGames(
    games: IGame[],
  ): Promise<IGameWithPlatforms[]> {
    const gameIds = Array.from(
      new Set(games.map((game) => game.id).filter(isPositiveInt)),
    );
    if (!gameIds.length) {
      return games.map((game) => ({ ...game, platforms: [] }));
    }

    const binds: Record<string, number> = {};
    const placeholders: string[] = [];
    gameIds.forEach((id, idx) => {
      const key = `id${idx}`;
      binds[key] = id;
      placeholders.push(`:${key}`);
    });

    const gameToPlatforms = new Map<number, IPlatformDef[]>();
    const missingPlatformIds = new Set<number>();

    const rows = await dbQuery(
      GameSql.attachPlatformsToGames(placeholders.join(", ")),
      binds,
      (row: {
        GAME_ID: number;
        PLATFORM_ID: number;
        PLATFORM_CODE: string | null;
        PLATFORM_NAME: string | null;
        PLATFORM_ABBREVIATION: string | null;
        IGDB_PLATFORM_ID: number | null;
      }) => row,
    );

    rows.forEach((row) => {
      const gameId = Number(row.GAME_ID);
      const platformId = Number(row.PLATFORM_ID);
      if (!Number.isInteger(gameId) || !Number.isInteger(platformId)) return;
      if (!row.PLATFORM_NAME || !row.PLATFORM_CODE) {
        missingPlatformIds.add(platformId);
        return;
      }
      const platform: IPlatformDef = {
        id: platformId,
        code: String(row.PLATFORM_CODE),
        name: String(row.PLATFORM_NAME),
        abbreviation: row.PLATFORM_ABBREVIATION
          ? String(row.PLATFORM_ABBREVIATION)
          : null,
        igdbPlatformId: row.IGDB_PLATFORM_ID
          ? Number(row.IGDB_PLATFORM_ID)
          : null,
      };
      if (!gameToPlatforms.has(gameId)) gameToPlatforms.set(gameId, []);
      gameToPlatforms.get(gameId)!.push(platform);
    });

    if (missingPlatformIds.size) {
      logWarn(
        "Game.getPlatformsByIgdbIds",
        `Missing platform IDs in GAMEDB_PLATFORMS: ${Array.from(missingPlatformIds).join(", ")}`,
      );
    }

    return games.map((game) => ({
      ...game,
      platforms: gameToPlatforms.get(game.id) ?? [],
    }));
  }

  static async getPlatformByIgdbId(
    igdbId: number,
  ): Promise<IPlatformDef | null> {
    const rows = await dbQuery(
      GameSql.getPlatformByIgdbId,
      { igdbId },
      mapPlatformDefRow,
    );
    return rows[0] ?? null;
  }

  static async getAllRegions(): Promise<IRegionDef[]> {
    const rows = await Game.fetchAllPages<RegionApiData>("/api/v1/regions");
    return rows.map(mapRegionFromApi);
  }

  static async getRegionByCode(code: string): Promise<IRegionDef | null> {
    const rows = await dbQuery(
      GameSql.getRegionByCode,
      { code },
      mapRegionDefRow,
    );
    return rows[0] ?? null;
  }

  static async getRegionById(id: number): Promise<IRegionDef | null> {
    const result = await apiGet<{ data: RegionApiData }>(`/api/v1/regions/${id}`);
    if (!result?.data) return null;
    return mapRegionFromApi(result.data);
  }

  static async getRegionByIgdbId(igdbId: number): Promise<IRegionDef | null> {
    const rows = await dbQuery(
      GameSql.getRegionByIgdbId,
      { igdbId },
      mapRegionDefRow,
    );
    return rows[0] ?? null;
  }

  static async searchGamesAutocomplete(
    query: string,
    limit: number = 24,
  ): Promise<IGameAutocompleteResult[]> {
    const baseQuery = query.trim();
    if (!baseQuery) {
      return [];
    }

    const safeLimit = Math.min(24, Math.max(1, Math.trunc(limit) || 24));
    const now = Date.now();
    pruneAutocompleteCache(now);

    const cacheKey = buildAutocompleteCacheKey(baseQuery, safeLimit);
    const cached = autocompleteSearchCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.results;
    }
    const pending = pendingAutocompleteSearches.get(cacheKey);
    if (pending) {
      return pending;
    }

    const lowerQuery = baseQuery.toLowerCase();
    const foldedLowerQuery = foldAccentE(lowerQuery).toLowerCase();
    const normalizedQuery = foldedLowerQuery.replace(/[^a-z0-9]/g, "");
    if (!normalizedQuery && !/[a-z0-9]/.test(foldedLowerQuery)) {
      return [];
    }

    const queryPromise = dbWithConnection(async (conn) => {
      const titleFoldExpr = `REPLACE(REPLACE(REPLACE(REPLACE(LOWER(title), 'é', 'e'), 'è', 'e'), 'ê', 'e'), 'ë', 'e')`;
      const titleNormExpr = `REGEXP_REPLACE(${titleFoldExpr}, '[^a-z0-9]', '', 'g')`;

      const binds = {
        exactRaw: foldedLowerQuery,
        rawPrefix: `${foldedLowerQuery}%`,
        rawContains: `%${foldedLowerQuery}%`,
        exactNorm: normalizedQuery || null,
        normPrefix: normalizedQuery ? `${normalizedQuery}%` : null,
        normContains: normalizedQuery ? `%${normalizedQuery}%` : null,
        limit: safeLimit,
      };

      const games = await dbQueryConn(
        conn,
        GameSql.searchGamesAutocomplete(titleFoldExpr, titleNormExpr),
        binds,
        (row: any): IGameAutocompleteResult => {
          const ird = row.INITIAL_RELEASE_DATE ?? row.initial_release_date;
          return {
            id: Number(row.GAME_ID ?? row.game_id),
            title: String(row.TITLE ?? row.title),
            initialReleaseDate:
              ird instanceof Date ? ird : ird ? new Date(ird) : null,
          };
        },
      );

      autocompleteSearchCache.set(cacheKey, {
        expiresAt: Date.now() + AUTOCOMPLETE_CACHE_TTL_MS,
        results: games,
      });
      pruneAutocompleteCache(Date.now());

      return games;
    });

    pendingAutocompleteSearches.set(cacheKey, queryPromise);
    try {
      return await queryPromise;
    } finally {
      pendingAutocompleteSearches.delete(cacheKey);
    }
  }

  static async getAllCompanies(): Promise<ICompany[]> {
    const rows = await Game.fetchAllPages<CompanyApiData>("/api/v1/companies");
    return rows.map((d) => ({
      id: Number(d.company_id),
      name: String(d.name),
      igdbId: d.igdb_company_id != null ? Number(d.igdb_company_id) : null,
    }));
  }

  static async getCompanyById(id: number): Promise<ICompany | null> {
    const result = await apiGet<{ data: CompanyApiData }>(`/api/v1/companies/${id}`);
    if (!result?.data) return null;
    return {
      id: Number(result.data.company_id),
      name: String(result.data.name),
      igdbId: result.data.igdb_company_id != null ? Number(result.data.igdb_company_id) : null,
    };
  }

  static async searchGames(
    query: string,
    filters: {
      upcomingRelease?: boolean;
      platformId?: number;
      year?: number;
      developerId?: number;
      publisherId?: number;
    } = {},
  ): Promise<IGameSearchResult[]> {
    return dbWithConnection(async (connection) => {
      const baseQuery = query.trim();
      const hasFilters =
        filters.upcomingRelease ||
        filters.platformId ||
        filters.year ||
        filters.developerId ||
        filters.publisherId;
      if (!baseQuery && !hasFilters) {
        return [];
      }

      const titleFoldExpr = `REPLACE(REPLACE(REPLACE(REPLACE(LOWER(title), 'é', 'e'), 'è', 'e'), 'ê', 'e'), 'ë', 'e')`;
      const titleNormExpr = `REGEXP_REPLACE(${titleFoldExpr}, '[^a-z0-9]', '', 'g')`;

      const clauses: string[] = [];
      const binds: Record<string, string | number> = {};

      if (baseQuery) {
        const queryVariants = new Set<string>();
        queryVariants.add(baseQuery);
        const spacedQuery = baseQuery
          .replace(/([a-zA-Z])(\d)/g, "$1 $2")
          .replace(/(\d)([a-zA-Z])/g, "$1 $2");
        queryVariants.add(spacedQuery);

        const tokens = spacedQuery.split(/\s+/).filter(Boolean);
        const tokenOptions: string[][] = [];
        for (const token of tokens) {
          const options = new Set<string>();
          options.add(token);
          const tokenSynonyms = await GameSearchSynonym.getTermsForQuery(token);
          tokenSynonyms.forEach((synonym) => {
            if (synonym.trim()) {
              options.add(synonym.trim());
            }
          });
          tokenOptions.push(Array.from(options));
        }

        if (tokenOptions.length) {
          let variants: string[] = [""];
          const MAX_VARIANTS = 50;
          for (const options of tokenOptions) {
            const nextVariants: string[] = [];
            for (const prefix of variants) {
              for (const option of options) {
                const next = prefix ? `${prefix} ${option}` : option;
                nextVariants.push(next);
                if (nextVariants.length >= MAX_VARIANTS) break;
              }
              if (nextVariants.length >= MAX_VARIANTS) break;
            }
            variants = nextVariants;
            if (variants.length >= MAX_VARIANTS) break;
          }
          variants.forEach((variant) => queryVariants.add(variant));
        }

        const termSet = new Map<string, string>();
        Array.from(queryVariants).forEach((term) => {
          const folded = foldAccentE(term).toLowerCase();
          const norm = folded.replace(/[^a-z0-9]/g, "");
          if (norm) {
            termSet.set(norm, folded);
          }
        });

        if (!termSet.size) {
          return [];
        }

        Array.from(termSet.entries()).forEach(([norm, term], index) => {
          const rawKey = `searchQuery${index}`;
          const normKey = `normalizedQuery${index}`;
          binds[rawKey] = `%${term}%`;
          binds[normKey] = `%${norm}%`;
          clauses.push(
            `(${titleFoldExpr} LIKE :${rawKey} OR ${titleNormExpr} LIKE :${normKey})`,
          );
        });
      }

      const filterClauses: string[] = [];
      if (filters.upcomingRelease) {
        filterClauses.push("u.upcoming_date IS NOT NULL");
      }
      if (filters.platformId) {
        filterClauses.push(
          "g.game_id IN (SELECT game_id FROM gamedb_game_platforms WHERE platform_id = :filterPlatformId)",
        );
        binds["filterPlatformId"] = filters.platformId;
      }
      if (filters.year) {
        filterClauses.push(
          "EXTRACT(YEAR FROM g.initial_release_date) = :filterYear",
        );
        binds["filterYear"] = filters.year;
      }
      if (filters.developerId) {
        filterClauses.push(
          `g.game_id IN (SELECT game_id FROM gamedb_game_companies WHERE company_id = :filterDeveloperId AND role = 'Developer')`,
        );
        binds["filterDeveloperId"] = filters.developerId;
      }
      if (filters.publisherId) {
        filterClauses.push(
          `g.game_id IN (SELECT game_id FROM gamedb_game_companies WHERE company_id = :filterPublisherId AND role = 'Publisher')`,
        );
        binds["filterPublisherId"] = filters.publisherId;
      }

      const titlePart = clauses.length ? `(${clauses.join(" OR ")})` : "";
      const filterPart = filterClauses.length
        ? `(${filterClauses.join(" AND ")})`
        : "";
      const whereClause =
        titlePart && filterPart
          ? `${titlePart} AND ${filterPart}`
          : titlePart || filterPart || "1=0";

      const upcomingCol = "u.upcoming_date";
      const orderPrefix = filters.upcomingRelease
        ? `${upcomingCol} ASC NULLS LAST, `
        : "";

      const entry = GameSql.searchGames(whereClause, orderPrefix);

      const upcomingDates = new Map<number, Date | null>();
      const upcomingPlatforms = new Map<number, string[]>();

      const rows = await dbQueryConn(connection, entry, binds, (row: any) => {
        const id = Number(row.game_id);
        const urd = row.upcoming_release_date;
        upcomingDates.set(
          id,
          urd instanceof Date ? urd : urd ? new Date(urd) : null,
        );
        upcomingPlatforms.set(
          id,
          row.upcoming_platforms
            ? String(row.upcoming_platforms)
                .split(",")
                .map((s: string) => s.trim())
                .filter(Boolean)
            : [],
        );
        return mapGameRow(row);
      });
      const games: IGame[] = rows;

      const withPlatforms = await Game.attachPlatformsToGames(games);
      return withPlatforms.map((g) => ({
        ...g,
        upcomingReleaseDate: upcomingDates.get(g.id) ?? null,
        upcomingReleasePlatforms: upcomingPlatforms.get(g.id) ?? [],
      }));
    });
  }

  static async addGamePlatformsByIgdbIds(
    gameId: number,
    igdbPlatformIds: number[],
  ): Promise<void> {
    return _addGamePlatformsByIgdbIds(gameId, igdbPlatformIds);
  }

  static async getGamesForAudit(
    missingImage: boolean,
    missingFeaturedVideo: boolean,
    missingDescription: boolean,
    missingReleaseData: boolean,
    titleWords?: string[],
    showCompleteOnly: boolean = false,
  ): Promise<IGame[]> {
    return dbWithConnection(async (connection) => {
      const imageCol = "image_data";
      const videoCol = "featured_video_url";
      const descCol = "description";
      const gameIdCol =  "g.game_id";
      const releasesTable = "gamedb_releases";
      const releaseGameIdCol = "r.game_id";
      const titleCol =  "g.title";

      const whereClauses: string[] = [];
      if (missingImage) {
        whereClauses.push(`${imageCol} IS NULL`);
      }
      if (missingFeaturedVideo) {
        whereClauses.push(`${videoCol} IS NULL`);
      }
      if (missingDescription) {
        whereClauses.push(`${descCol} IS NULL`);
      }
      if (missingReleaseData) {
        whereClauses.push(
          `NOT EXISTS (SELECT 1 FROM ${releasesTable} r WHERE ${releaseGameIdCol} = ${gameIdCol})`,
        );
      }

      if (whereClauses.length === 0) {
        return [];
      }

      const whereClause = whereClauses.join(" OR ");
      const binds: Record<string, any> = {};
      let titleClause = "";
      if (titleWords && titleWords.length) {
        const wordClauses: string[] = [];
        titleWords.forEach((word, index) => {
          const key = `titleWord${index}`;
          binds[key] = `%${word.toLowerCase()}%`;
          wordClauses.push(`LOWER(${titleCol}) LIKE :${key}`);
        });
        titleClause = wordClauses.length ? `(${wordClauses.join(" OR ")})` : "";
      }

      let combinedClause = titleClause
        ? `(${whereClause}) AND ${titleClause}`
        : whereClause;

      if (showCompleteOnly) {
        const completeClause = `${imageCol} IS NOT NULL
          AND ${videoCol} IS NOT NULL
          AND ${descCol} IS NOT NULL
          AND EXISTS (SELECT 1 FROM ${releasesTable} r WHERE ${releaseGameIdCol} = ${gameIdCol})`;
        combinedClause = titleClause
          ? `(${completeClause}) AND ${titleClause}`
          : completeClause;
      }

      const entry = GameSql.getGamesForAudit(combinedClause);

      return dbQueryConn(connection, entry, binds, mapGameRow);
    });
  }

  static async getGamePrimaryImageUrl(gameId: number): Promise<string | null> {
    type GameImage = {
      image_id: number;
      kind: string;
      is_primary: boolean;
      position: number;
      url: string;
    };
    const result = await apiGet<{ data: GameImage[] }>(
      `/api/v1/games/${gameId}/images`,
    );
    if (!result?.data?.length) return null;
    const primary =
      result.data.find((img) => img.kind === "cover" && img.is_primary) ??
      result.data.find((img) => img.is_primary) ??
      result.data[0];
    return primary?.url ?? null;
  }

  static async getGamePrimaryImageBuffer(
    gameId: number,
  ): Promise<Buffer | null> {
    const url = await Game.getGamePrimaryImageUrl(gameId);
    if (!url) return null;
    try {
      const resp = await axios.get<ArrayBuffer>(url, {
        responseType: "arraybuffer",
      });
      return Buffer.from(resp.data);
    } catch {
      return null;
    }
  }

  static async updateGameImage(
    gameId: number,
    imageData: Buffer,
  ): Promise<void> {
    await dbMutate(GameSql.updateGameImage, { imageData, gameId });
  }

  static async updateGameThumbnailBad(
    gameId: number,
    isBad: boolean,
  ): Promise<void> {
    await dbMutate(GameSql.updateGameThumbnailBad, {
      thumbnailBad: isBad ? 1 : 0,
      gameId,
    });
  }

  static async updateGameThumbnailApproved(
    gameId: number,
    isApproved: boolean,
  ): Promise<void> {
    await dbMutate(GameSql.updateGameThumbnailApproved, {
      thumbnailApproved: isApproved ? 1 : 0,
      gameId,
    });
  }

  static async getThreadStatusForGameIds(
    gameIds: number[],
  ): Promise<Set<number>> {
    const ids = Array.from(new Set(gameIds.filter(isPositiveInt)));
    if (!ids.length) return new Set();

    const placeholders = ids.map((_, idx) => `:id${idx}`).join(", ");
    const binds: Record<string, any> = {};
    ids.forEach((id, idx) => {
      binds[`id${idx}`] = id;
    });

    const rows = await dbQuery(
      GameSql.getThreadStatusForGameIds(placeholders),
      binds,
      (row: { GAME_ID: number }) => Number(row.GAME_ID),
    );
    return new Set(rows);
  }

  static async updateFeaturedVideoUrl(
    gameId: number,
    featuredVideoUrl: string | null,
  ): Promise<void> {
    await dbMutate(GameSql.updateFeaturedVideoUrl, {
      featuredVideoUrl,
      gameId,
    });
  }

  static async updateGameDescription(
    gameId: number,
    description: string | null,
  ): Promise<void> {
    await dbMutate(GameSql.updateGameDescription, { description, gameId });
  }

  static async clearReleaseDates(
    gameId: number,
  ): Promise<{ releases: number; announcements: number }> {
    return dbTransaction(async (conn) => {
      const announceCount = await dbMutateConn(
        conn,
        GameSql.clearReleaseAnnouncements,
        { gameId },
      );
      const releaseCount = await dbMutateConn(conn, GameSql.clearReleases, {
        gameId,
      });
      await dbMutateConn(conn, GameSql.clearInitialReleaseDate, { gameId });
      return {
        releases: Number(releaseCount),
        announcements: Number(announceCount),
      };
    });
  }

  static async refreshReleaseDates(
    gameId: number,
    releases: NonNullable<IGDBGameDetails["release_dates"]>,
  ): Promise<void> {
    await Game.clearReleaseDates(gameId);
    if (!releases.length) return;
    await saveReleaseDates(gameId, releases);
  }

  static async touchGameUpdatedAt(gameId: number): Promise<void> {
    await dbMutate(GameSql.touchGameUpdatedAt, { gameId });
  }

  static async getGameAssociations(
    gameId: number,
  ): Promise<IGameAssociationSummary> {
    type WinRow = {
      ROUND_NUMBER: number;
      THREAD_ID: string | null;
      REDDIT_URL: string | null;
      MONTH_YEAR: string;
    };
    type NomRow = {
      ROUND_NUMBER: number;
      USER_ID: string;
      USERNAME?: string | null;
      GLOBAL_NAME?: string | null;
    };

    const [gotmWins, nrGotmWins, gotmNominations, nrGotmNominations] =
      await Promise.all([
        dbQuery<
          WinRow,
          {
            round: number;
            threadId: string | null;
            redditUrl: string | null;
            monthYear: string;
          }
        >(GameSql.getGotmWins, { gameId }, (row) => ({
          round: Number(row.ROUND_NUMBER),
          threadId: row.THREAD_ID ?? null,
          redditUrl: row.REDDIT_URL ?? null,
          monthYear: String(row.MONTH_YEAR),
        })),
        dbQuery<
          WinRow,
          {
            round: number;
            threadId: string | null;
            redditUrl: string | null;
            monthYear: string;
          }
        >(GameSql.getNrGotmWins, { gameId }, (row) => ({
          round: Number(row.ROUND_NUMBER),
          threadId: row.THREAD_ID ?? null,
          redditUrl: row.REDDIT_URL ?? null,
          monthYear: String(row.MONTH_YEAR),
        })),
        dbQuery<NomRow, { round: number; userId: string; username: string }>(
          GameSql.getGotmNominations,
          { gameId },
          (row) => ({
            round: Number(row.ROUND_NUMBER),
            userId: String(row.USER_ID),
            username: String(row.GLOBAL_NAME || row.USERNAME || row.USER_ID),
          }),
        ),
        dbQuery<NomRow, { round: number; userId: string; username: string }>(
          GameSql.getNrGotmNominations,
          { gameId },
          (row) => ({
            round: Number(row.ROUND_NUMBER),
            userId: String(row.USER_ID),
            username: String(row.GLOBAL_NAME || row.USERNAME || row.USER_ID),
          }),
        ),
      ]);

    return { gotmWins, nrGotmWins, gotmNominations, nrGotmNominations };
  }

  static async getNowPlayingMembers(
    gameId: number,
  ): Promise<INowPlayingMember[]> {
    const rows = await Game.fetchAllPages<NowPlayingApiEntry>(
      `/api/v1/games/${gameId}/now_playing`,
    );
    return rows.map((d) => ({
      userId: String(d.user_id),
      username: d.user?.username ?? null,
      globalName: d.user?.global_name ?? null,
      threadId: null,
      addedAt: null,
    }));
  }

  static async getGameCompletions(gameId: number): Promise<ICompletedMember[]> {
    const rows = await Game.fetchAllPages<CompletionGameApiEntry>(
      `/api/v1/games/${gameId}/completions`,
    );
    return rows.map((d) => ({
      userId: String(d.user_id),
      username: d.user?.username ?? null,
      globalName: d.user?.global_name ?? null,
      completionType: String(d.completion_type),
      completedAt: d.completed_at ? new Date(d.completed_at) : null,
      finalPlaytimeHours: d.final_playtime_hrs != null ? Number(d.final_playtime_hrs) : null,
    }));
  }

  static async getGameCollectionOwners(
    gameId: number,
  ): Promise<ICollectionOwnerMember[]> {
    return dbQuery(
      GameSql.getGameCollectionOwners,
      { gameId },
      (row: {
        USER_ID: string;
        USERNAME: string | null;
        GLOBAL_NAME: string | null;
      }) => ({
        userId: String(row.USER_ID),
        username: row.USERNAME ?? null,
        globalName: row.GLOBAL_NAME ?? null,
      }),
    );
  }

  static async getGameProfile(gameId: number): Promise<IMappedGameProfile | null> {
    const result = await apiGet<{ data: GameProfileApiData }>(
      `/api/v1/games/${gameId}/profile`,
    );
    const d = result?.data;
    if (!d) return null;
    return mapGameProfileFromApi(d, gameId);
  }
}
