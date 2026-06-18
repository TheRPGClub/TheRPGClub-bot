import axios from "axios";
import type { IGDBGameDetails } from "../services/IGDB/IgdbService.js";
import {
  apiGet,
  apiGetRaw,
  apiPost,
  apiPatch,
  apiPostForm,
  type ApiGetRawMeta,
} from "../services/RpgClubApiClient.js";
import { isPositiveInt } from "../utilities/ValidationUtils.js";
import {
  mapGameFromApi,
  mapReleaseFromApi,
  type ReleaseApiData,
} from "../functions/GameMappers.js";
import type {
  IGame,
  IRelease,
} from "../types/GameTypes.js";
import {
  clearAutocompleteSearchCaches,
} from "../functions/GameAutocompleteCache.js";
import GameProfileService from "./GameProfileService.js";

export default class Game {
  static async createGame(igdbId: number): Promise<IGame> {
    const result = await apiPost<{ data: { game_id: number } }>(
      "/api/v1/games",
      { igdb_id: igdbId },
    );
    if (!result) throw new Error("No IGDB game found with that id.");
    const newGame = await Game.getGameById(result.data.game_id);
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

  static async getGameById(id: number): Promise<IGame | null> {
    const result = await apiGet<{ data: unknown }>(`/api/v1/games/${id}`);
    const data = result?.data;
    return data ? mapGameFromApi(data) : null;
  }

  static async getGamesByIds(ids: number[]): Promise<IGame[]> {
    const uniqueIds = Array.from(new Set(ids.filter(isPositiveInt)));
    if (!uniqueIds.length) return [];
    const results = await Promise.all(uniqueIds.map((id) => Game.getGameById(id)));
    return results.filter((g): g is IGame => g !== null);
  }

  static async getAllGameIds(): Promise<number[]> {
    const ids: number[] = [];
    let page = 1;
    const per = 500;
    while (true) {
      const result = await apiGet<{ data: unknown[]; meta: { pages: number } }>(
        "/api/v1/games",
        { params: { page, per } },
      );
      if (!result?.data?.length) break;
      for (const item of result.data) {
        const game = mapGameFromApi(item);
        if (game.igdbId != null) ids.push(game.id);
      }
      if (page >= (result.meta?.pages ?? 1)) break;
      page++;
    }
    return ids;
  }

  static async getAlternateVersions(gameId: number): Promise<IGame[]> {
    if (!isPositiveInt(gameId)) return [];
    const relations = await GameProfileService.getGameRelations(gameId);
    if (!relations?.alternates?.length) return [];
    return relations.alternates.map(mapGameFromApi);
  }

  static async linkAlternateVersions(gameIds: number[]): Promise<number> {
    const uniqueIds = Array.from(new Set(gameIds.filter(isPositiveInt))).sort(
      (a, b) => a - b,
    );
    if (uniqueIds.length < 2) {
      throw new Error("At least two GameDB ids are required to link versions.");
    }

    let count = 0;
    for (let i = 0; i < uniqueIds.length; i += 1) {
      for (let j = i + 1; j < uniqueIds.length; j += 1) {
        await apiPost(`/api/v1/games/${uniqueIds[i]}/alternates`, {
          data: { alt_game_id: uniqueIds[j] },
        });
        count++;
      }
    }
    return count;
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
    const result = await apiPost<{ data: ReleaseApiData }>(
      `/api/v1/games/${gameId}/releases`,
      {
        data: {
          platform_id: platformId,
          region_id: regionId,
          format: format ?? null,
          release_date: releaseDate ? releaseDate.toISOString().split("T")[0] : null,
          notes: notes ?? null,
        },
      },
    );
    if (!result?.data) throw new Error("Failed to create release via API.");
    return mapReleaseFromApi(result.data);
  }

  static async getGameReleases(gameId: number): Promise<IRelease[]> {
    const result = await apiGet<{ data: ReleaseApiData[] }>(
      `/api/v1/games/${gameId}/releases`,
    );
    if (!result?.data) return [];
    return result.data.map(mapReleaseFromApi);
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

  static async updateGameImage(gameId: number, imageData: Buffer): Promise<void> {
    const form = new FormData();
    form.append(
      "image",
      new Blob([new Uint8Array(imageData)], { type: "image/jpeg" }),
      "cover.jpg",
    );
    await apiPostForm(`/api/v1/games/${gameId}/images`, form);
  }

  static async refreshImageFromIgdb(gameId: number): Promise<void> {
    await apiPost(`/api/v1/games/${gameId}/refresh-images`);
  }

  static async updateFeaturedVideoUrl(
    gameId: number,
    featuredVideoUrl: string | null,
  ): Promise<void> {
    await apiPatch(`/api/v1/games/${gameId}`, { data: { featured_video_url: featuredVideoUrl } });
  }

  static async updateGameDescription(
    gameId: number,
    description: string | null,
  ): Promise<void> {
    await apiPatch(`/api/v1/games/${gameId}`, { data: { description } });
  }

}
