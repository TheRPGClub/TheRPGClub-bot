import { apiGet } from "../services/RpgClubApiClient.js";
import { mapReleaseFromApi } from "../functions/GameMappers.js";
import type {
  IReleaseWithNames,
  ICompany,
  IGameAssociationSummary,
  INowPlayingMember,
  ICompletedMember,
  ICollectionOwnerMember,
  IMappedGameProfile,
} from "../types/GameTypes.js";
import {
  type GameRelationsApiData,
  type NowPlayingApiEntry,
  type CompletionGameApiEntry,
  type CompanyApiData,
  type GameProfileApiData,
  mapGameProfileFromApi,
} from "../functions/GameProfileMapper.js";
import { createTtlCache } from "../functions/TtlCache.js";
import { AUTOCOMPLETE_CACHE_TTL_MS } from "../config/cacheDefaults.js";

export default class GameProfileService {
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

  static async getGameRelations(
    gameId: number,
  ): Promise<GameRelationsApiData | null> {
    const now = Date.now();
    const cached = GameProfileService.relationsCache.get(gameId);
    if (cached && cached.expires > now) return cached.promise;

    const promise = (async () => {
      const result = await apiGet<{ data: GameRelationsApiData }>(
        `/api/v1/games/${gameId}/relations`,
      );
      return result?.data ?? null;
    })();
    promise.catch(() => GameProfileService.relationsCache.delete(gameId));

    GameProfileService.relationsCache.set(gameId, {
      promise,
      expires: now + GameProfileService.RELATIONS_CACHE_TTL_MS,
    });
    return promise;
  }

  static async getGameReleasesDetailed(
    gameId: number,
  ): Promise<IReleaseWithNames[]> {
    const relations = await GameProfileService.getGameRelations(gameId);
    if (!relations?.releases?.length) return [];
    return relations.releases.map((r) => ({
      ...mapReleaseFromApi(r),
      platformName: r.platform_name ?? null,
      regionName: r.region_name ?? null,
    }));
  }

  static async getAllCompanies(): Promise<ICompany[]> {
    const rows =
      await GameProfileService.fetchAllPages<CompanyApiData>("/api/v1/companies");
    return rows.map((d) => ({
      id: Number(d.company_id),
      name: String(d.name),
      igdbId: d.igdb_company_id != null ? Number(d.igdb_company_id) : null,
    }));
  }

  private static companyCache = createTtlCache<ICompany[]>(
    () => GameProfileService.getAllCompanies(),
    AUTOCOMPLETE_CACHE_TTL_MS,
  );

  static async getCachedCompanies(): Promise<ICompany[]> {
    return GameProfileService.companyCache.get();
  }

  static clearCompanyCache(): void {
    GameProfileService.companyCache.clear();
  }

  static async getCompanyById(id: number): Promise<ICompany | null> {
    const result = await apiGet<{ data: CompanyApiData }>(`/api/v1/companies/${id}`);
    if (!result?.data) return null;
    return {
      id: Number(result.data.company_id),
      name: String(result.data.name),
      igdbId:
        result.data.igdb_company_id != null
          ? Number(result.data.igdb_company_id)
          : null,
    };
  }

  static async getGameAssociations(
    gameId: number,
  ): Promise<IGameAssociationSummary> {
    const result = await apiGet<{ data: GameProfileApiData }>(
      `/api/v1/games/${gameId}/profile`,
    );
    const assoc = result?.data?.associations;
    return {
      gotmWins: (assoc?.gotm_wins ?? []).map((w) => ({
        round: Number(w.round),
        threadId: null,
        redditUrl: w.reddit_url ?? null,
        monthYear: "",
      })),
      nrGotmWins: (assoc?.nr_gotm_wins ?? []).map((w) => ({
        round: Number(w.round),
        threadId: null,
        redditUrl: w.reddit_url ?? null,
        monthYear: "",
      })),
      gotmNominations: (assoc?.gotm_nominations ?? []).map((n) => ({
        round: Number(n.round),
        userId: String(n.user_id),
        username: String(n.username || n.user_id),
      })),
      nrGotmNominations: (assoc?.nr_gotm_nominations ?? []).map((n) => ({
        round: Number(n.round),
        userId: String(n.user_id),
        username: String(n.username || n.user_id),
      })),
    };
  }

  static async getNowPlayingMembers(
    gameId: number,
  ): Promise<INowPlayingMember[]> {
    const rows = await GameProfileService.fetchAllPages<NowPlayingApiEntry>(
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
    const rows = await GameProfileService.fetchAllPages<CompletionGameApiEntry>(
      `/api/v1/games/${gameId}/completions`,
    );
    return rows.map((d) => ({
      userId: String(d.user_id),
      username: d.user?.username ?? null,
      globalName: d.user?.global_name ?? null,
      completionType: String(d.completion_type),
      completedAt: d.completed_at ? new Date(d.completed_at) : null,
      finalPlaytimeHours:
        d.final_playtime_hrs != null ? Number(d.final_playtime_hrs) : null,
    }));
  }

  static async getGameCollectionOwners(
    gameId: number,
  ): Promise<ICollectionOwnerMember[]> {
    const result = await apiGet<{ data: GameProfileApiData }>(
      `/api/v1/games/${gameId}/profile`,
    );
    return (result?.data?.collection_owners ?? []).map((o) => ({
      userId: String(o.user_id),
      username: o.username ?? null,
      globalName: null,
    }));
  }

  static async getGameProfile(
    gameId: number,
  ): Promise<IMappedGameProfile | null> {
    const result = await apiGet<{ data: GameProfileApiData }>(
      `/api/v1/games/${gameId}/profile`,
    );
    const d = result?.data;
    if (!d) return null;
    return mapGameProfileFromApi(d, gameId);
  }
}
