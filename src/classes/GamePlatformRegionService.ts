import {
  mapPlatformFromApi,
  mapRegionFromApi,
  buildPlatformCode,
  IGDB_REGION_MAP,
  type PlatformApiData,
  type RegionApiData,
} from "../functions/GameMappers.js";
import type { IPlatformDef, IRegionDef, IGame, IGameWithPlatforms } from "../types/GameTypes.js";
import { apiGet, apiPost } from "../services/RpgClubApiClient.js";
import GameProfileService from "./GameProfileService.js";
import { isPositiveInt } from "../utilities/ValidationUtils.js";
import { createTtlCache } from "../functions/TtlCache.js";
import { AUTOCOMPLETE_CACHE_TTL_MS } from "../config/cacheDefaults.js";

export default class GamePlatformRegionService {
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

  static async ensurePlatform(igdbPlatform: {
    id: number;
    name: string | null;
  }): Promise<IPlatformDef | null> {
    const result = await apiPost<{ data: PlatformApiData }>(
      "/api/v1/platforms",
      {
        data: {
          code: buildPlatformCode(igdbPlatform.name, igdbPlatform.id),
          name: igdbPlatform.name ?? `IGDB Platform ${igdbPlatform.id}`,
          igdb_id: igdbPlatform.id,
        },
      },
    );
    if (!result?.data) return null;
    return mapPlatformFromApi(result.data);
  }

  static async ensureRegion(igdbRegionId: number): Promise<IRegionDef | null> {
    const regionConfig = IGDB_REGION_MAP[igdbRegionId];
    if (!regionConfig) return null;

    const result = await apiPost<{ data: RegionApiData }>(
      "/api/v1/regions",
      {
        data: {
          code: regionConfig.code,
          name: regionConfig.name,
          igdb_id: igdbRegionId,
        },
      },
    );
    if (!result?.data) return null;
    return mapRegionFromApi(result.data);
  }

  static async getPlatformsForGame(gameId: number): Promise<IPlatformDef[]> {
    const relations = await GameProfileService.getGameRelations(gameId);
    const platforms = (relations?.platforms ?? []).map(mapPlatformFromApi);
    return platforms.sort((a, b) => a.name.localeCompare(b.name));
  }

  static async getAllPlatforms(): Promise<IPlatformDef[]> {
    const rows =
      await GamePlatformRegionService.fetchAllPages<PlatformApiData>("/api/v1/platforms");
    return rows.map(mapPlatformFromApi).sort((a, b) => a.name.localeCompare(b.name));
  }

  private static platformCache = createTtlCache<IPlatformDef[]>(
    () => GamePlatformRegionService.getAllPlatforms(),
    AUTOCOMPLETE_CACHE_TTL_MS,
  );

  static async getCachedPlatforms(): Promise<IPlatformDef[]> {
    return GamePlatformRegionService.platformCache.get();
  }

  static clearPlatformCache(): void {
    GamePlatformRegionService.platformCache.clear();
  }

  static async getPlatformsByIgdbIds(
    igdbIds: number[],
  ): Promise<Map<number, IPlatformDef>> {
    const uniqueIds = Array.from(new Set(igdbIds.filter(isPositiveInt)));
    if (!uniqueIds.length) {
      return new Map();
    }

    const rows = await GamePlatformRegionService.fetchAllPages<PlatformApiData>(
      "/api/v1/platforms",
      { igdb_ids: uniqueIds },
    );
    const map = new Map<number, IPlatformDef>();
    rows.forEach((row) => {
      const platform = mapPlatformFromApi(row);
      if (platform.igdbPlatformId) map.set(platform.igdbPlatformId, platform);
    });
    return map;
  }

  static async getPlatformsForGameWithStandard(
    gameId: number,
    standardPlatformIds: number[],
  ): Promise<IPlatformDef[]> {
    const gamePlatforms = await GamePlatformRegionService.getPlatformsForGame(gameId);
    const allPlatforms = await GamePlatformRegionService.getAllPlatforms();
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
    const result = await apiGet<{ data: PlatformApiData[] }>(
      "/api/v1/platforms",
      { params: { code } },
    );
    const first = result?.data?.[0];
    return first ? mapPlatformFromApi(first) : null;
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

    const gameToPlatforms = new Map<number, IPlatformDef[]>();
    await Promise.all(
      gameIds.map(async (gameId) => {
        const relations = await GameProfileService.getGameRelations(gameId);
        gameToPlatforms.set(
          gameId,
          (relations?.platforms ?? []).map(mapPlatformFromApi),
        );
      }),
    );

    return games.map((game) => ({
      ...game,
      platforms: gameToPlatforms.get(game.id) ?? [],
    }));
  }

  static async getPlatformByIgdbId(igdbId: number): Promise<IPlatformDef | null> {
    const result = await apiGet<{ data: PlatformApiData[] }>(
      "/api/v1/platforms",
      { params: { igdb_id: igdbId } },
    );
    const first = result?.data?.[0];
    return first ? mapPlatformFromApi(first) : null;
  }

  static async getAllRegions(): Promise<IRegionDef[]> {
    const rows = await GamePlatformRegionService.fetchAllPages<RegionApiData>("/api/v1/regions");
    return rows.map(mapRegionFromApi);
  }

  static async getRegionByCode(code: string): Promise<IRegionDef | null> {
    const result = await apiGet<{ data: RegionApiData[] }>(
      "/api/v1/regions",
      { params: { code } },
    );
    const first = result?.data?.[0];
    return first ? mapRegionFromApi(first) : null;
  }

  static async getRegionById(id: number): Promise<IRegionDef | null> {
    const result = await apiGet<{ data: RegionApiData }>(`/api/v1/regions/${id}`);
    if (!result?.data) return null;
    return mapRegionFromApi(result.data);
  }

  static async getRegionByIgdbId(igdbId: number): Promise<IRegionDef | null> {
    const result = await apiGet<{ data: RegionApiData[] }>(
      "/api/v1/regions",
      { params: { igdb_id: igdbId } },
    );
    const first = result?.data?.[0];
    return first ? mapRegionFromApi(first) : null;
  }

}
