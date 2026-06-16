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
import {
  apiGet,
  apiGetRaw,
  type ApiGetRawMeta,
} from "../services/RpgClubApiClient.js";
import { isPositiveInt } from "../utilities/ValidationUtils.js";
import {
  mapGameFromApi,
  mapGameRow,
  mapReleaseRow,
  mapReleaseFromApi,
  type ReleaseApiData,
} from "../functions/GameMappers.js";
import type {
  IGame,
  IRelease,
  GameSource,
} from "../types/GameTypes.js";
import {
  clearAutocompleteSearchCaches,
} from "../functions/GameAutocompleteCache.js";
import GameProfileService from "./GameProfileService.js";

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
    const relations = await GameProfileService.getGameRelations(gameId);
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
    const relations = await GameProfileService.getGameRelations(gameId);
    if (!relations) return [];
    return relations.companies
      .filter((c) => c.role === role)
      .map((c) => String(c.name));
  }

  static async getGameGenres(gameId: number): Promise<string[]> {
    const relations = await GameProfileService.getGameRelations(gameId);
    return (relations?.genres ?? []).map((g) => String(g.name));
  }

  static async getGameThemes(gameId: number): Promise<string[]> {
    const relations = await GameProfileService.getGameRelations(gameId);
    return (relations?.themes ?? []).map((g) => String(g.name));
  }

  static async getGameModes(gameId: number): Promise<string[]> {
    const relations = await GameProfileService.getGameRelations(gameId);
    return (relations?.modes ?? []).map((g) => String(g.name));
  }

  static async getGamePerspectives(gameId: number): Promise<string[]> {
    const relations = await GameProfileService.getGameRelations(gameId);
    return (relations?.perspectives ?? []).map((g) => String(g.name));
  }

  static async getGameEngines(gameId: number): Promise<string[]> {
    const relations = await GameProfileService.getGameRelations(gameId);
    return (relations?.engines ?? []).map((g) => String(g.name));
  }

  static async getGameFranchises(gameId: number): Promise<string[]> {
    const relations = await GameProfileService.getGameRelations(gameId);
    return (relations?.franchises ?? []).map((g) => String(g.name));
  }

  static async getGameSeries(gameId: number): Promise<string | null> {
    const relations = await GameProfileService.getGameRelations(gameId);
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

  static async touchGameUpdatedAt(gameId: number): Promise<void> {
    await dbMutate(GameSql.touchGameUpdatedAt, { gameId });
  }

}
