import {
  dbQuery,
  dbMutate,
  dbInsert,
  dbTransaction,
  dbMutateConn,
} from "../db/SqlManager.js";
import { GameSql } from "../db/sql/index.js";
import {
  mapPlatformDefRow,
  mapPlatformFromApi,
  mapRegionDefRow,
  mapRegionFromApi,
  buildPlatformCode,
  IGDB_REGION_MAP,
  type PlatformApiData,
  type RegionApiData,
} from "../functions/GameMappers.js";
import type { IPlatformDef, IRegionDef, IGame, IGameWithPlatforms } from "../types/GameTypes.js";
import { apiGet } from "../services/RpgClubApiClient.js";
import { isPositiveInt } from "../utilities/ValidationUtils.js";
import { logError, logWarn } from "../utilities/LogUtils.js";

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
    const existing = await GamePlatformRegionService.getPlatformByIgdbId(igdbPlatform.id);
    if (existing) {
      return existing;
    }

    try {
      await dbMutate(GameSql.insertPlatform, {
        code: buildPlatformCode(igdbPlatform.name, igdbPlatform.id),
        name: igdbPlatform.name ?? `IGDB Platform ${igdbPlatform.id}`,
        igdbId: igdbPlatform.id,
      });
      return GamePlatformRegionService.getPlatformByIgdbId(igdbPlatform.id);
    } catch (err) {
      logError("GamePlatformRegionService.insertPlatform", err);
      return null;
    }
  }

  static async ensureRegion(igdbRegionId: number): Promise<IRegionDef | null> {
    const existing = await GamePlatformRegionService.getRegionByIgdbId(igdbRegionId);
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
      return GamePlatformRegionService.getRegionById(regionId);
    } catch (err) {
      logError("GamePlatformRegionService.insertRegion", err);
      return null;
    }
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
        "GamePlatformRegionService.attachPlatformsToGames",
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
    const rows = await GamePlatformRegionService.fetchAllPages<RegionApiData>("/api/v1/regions");
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

  static async addGamePlatformsByIgdbIds(
    gameId: number,
    igdbPlatformIds: number[],
  ): Promise<void> {
    if (!isPositiveInt(gameId)) return;
    const uniqueIds = Array.from(
      new Set(igdbPlatformIds.filter(isPositiveInt)),
    );
    if (!uniqueIds.length) return;

    const platformMap = await GamePlatformRegionService.getPlatformsByIgdbIds(uniqueIds);
    const missingIds = uniqueIds.filter((id) => !platformMap.has(id));
    if (missingIds.length) {
      logWarn(
        "GamePlatformRegionService.addGamePlatformsByIgdbIds",
        `Missing IGDB platform IDs in GAMEDB_PLATFORMS: ${missingIds.join(", ")}`,
      );
    }

    await dbTransaction(async (conn) => {
      for (const igdbId of uniqueIds) {
        const platform = platformMap.get(igdbId);
        if (!platform) continue;
        await dbMutateConn(conn, GameSql.addGamePlatformMerge, {
          gameId,
          platformId: platform.id,
        });
      }
    });
  }
}
