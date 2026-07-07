import { apiGet } from "../services/RpgClubApiClient.js";
import GameSearchSynonym from "./GameSearchSynonym.js";
import { mapGameFromApi } from "../functions/GameMappers.js";
import {
  autocompleteSearchCache,
  pendingAutocompleteSearches,
  foldAccentE,
  buildAutocompleteCacheKey,
  pruneAutocompleteCache,
  AUTOCOMPLETE_CACHE_TTL_MS,
} from "../functions/GameAutocompleteCache.js";
import type {
  IGame,
  IGameSearchResult,
  IGameAutocompleteResult,
} from "../types/GameTypes.js";
import GamePlatformRegionService from "./GamePlatformRegionService.js";
import GameProfileService from "./GameProfileService.js";

type GamesListResponse = { data: unknown[]; meta: { next: number | null } };

const MAX_QUERY_VARIANTS = 8;

export default class GameSearchService {
  private static async fetchGamesPages(
    params: Record<string, unknown>,
  ): Promise<IGame[]> {
    const results: IGame[] = [];
    let page = 1;
    for (;;) {
      const result = await apiGet<GamesListResponse>("/api/v1/games", {
        params: { ...params, page, per: 100 },
      });
      if (!result?.data?.length) break;
      results.push(...result.data.map(mapGameFromApi));
      if (!result.meta?.next) break;
      page++;
    }
    return results;
  }

  private static async buildQueryVariants(baseQuery: string): Promise<string[]> {
    if (!baseQuery) return [];

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
        if (synonym.trim()) options.add(synonym.trim());
      });
      tokenOptions.push(Array.from(options));
    }

    if (tokenOptions.length) {
      let variants: string[] = [""];
      for (const options of tokenOptions) {
        const nextVariants: string[] = [];
        for (const prefix of variants) {
          for (const option of options) {
            nextVariants.push(prefix ? `${prefix} ${option}` : option);
            if (nextVariants.length >= MAX_QUERY_VARIANTS) break;
          }
          if (nextVariants.length >= MAX_QUERY_VARIANTS) break;
        }
        variants = nextVariants;
        if (variants.length >= MAX_QUERY_VARIANTS) break;
      }
      variants.forEach((variant) => queryVariants.add(variant));
    }

    const termSet = new Map<string, string>();
    Array.from(queryVariants).forEach((term) => {
      const folded = foldAccentE(term).toLowerCase();
      const norm = folded.replace(/[^a-z0-9]/g, "");
      if (norm) termSet.set(norm, folded);
    });

    return Array.from(termSet.values()).slice(0, MAX_QUERY_VARIANTS);
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

    const queryPromise = (async () => {
      const result = await apiGet<{ data: unknown[] }>("/api/v1/games", {
        params: { q: baseQuery, per: safeLimit },
      });
      const games = (result?.data ?? []).map(mapGameFromApi);

      const rank = (game: IGame): number => {
        const folded = foldAccentE(game.title.toLowerCase()).toLowerCase();
        const norm = folded.replace(/[^a-z0-9]/g, "");
        if (folded === foldedLowerQuery) return 0;
        if (folded.startsWith(foldedLowerQuery)) return 1;
        if (normalizedQuery && norm === normalizedQuery) return 2;
        if (normalizedQuery && norm.startsWith(normalizedQuery)) return 3;
        return 4;
      };

      const sorted = [...games].sort((a, b) => {
        const rankDiff = rank(a) - rank(b);
        return rankDiff !== 0 ? rankDiff : a.title.localeCompare(b.title);
      });

      const results: IGameAutocompleteResult[] = sorted
        .slice(0, safeLimit)
        .map((g) => ({
          id: g.id,
          title: g.title,
          initialReleaseDate: g.initialReleaseDate,
        }));

      autocompleteSearchCache.set(cacheKey, {
        expiresAt: Date.now() + AUTOCOMPLETE_CACHE_TTL_MS,
        results,
      });
      pruneAutocompleteCache(Date.now());

      return results;
    })();

    pendingAutocompleteSearches.set(cacheKey, queryPromise);
    try {
      return await queryPromise;
    } finally {
      pendingAutocompleteSearches.delete(cacheKey);
    }
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

    const companyIds = [filters.developerId, filters.publisherId].filter(
      (id): id is number => typeof id === "number" && Number.isFinite(id) && id > 0,
    );

    const queryTerms = await GameSearchService.buildQueryVariants(baseQuery);
    if (baseQuery && !queryTerms.length) {
      return [];
    }

    const gameMap = new Map<number, IGame>();
    const fetchParams: Record<string, unknown> = {};
    if (companyIds.length) fetchParams.company_id = companyIds;

    if (queryTerms.length) {
      for (const term of queryTerms) {
        const rows = await GameSearchService.fetchGamesPages({
          ...fetchParams,
          q: term,
        });
        rows.forEach((g) => gameMap.set(g.id, g));
      }
    } else {
      const rows = await GameSearchService.fetchGamesPages(fetchParams);
      rows.forEach((g) => gameMap.set(g.id, g));
    }

    let games = Array.from(gameMap.values());

    if (filters.year) {
      const targetYear = filters.year;
      games = games.filter(
        (g) => g.initialReleaseDate?.getUTCFullYear() === targetYear,
      );
    }

    if (filters.developerId || filters.publisherId) {
      const checked = await Promise.all(
        games.map(async (g) => {
          const relations = await GameProfileService.getGameRelations(g.id);
          const companies = relations?.companies ?? [];
          const devOk =
            !filters.developerId ||
            companies.some(
              (c) => c.role === "Developer" && Number(c.company_id) === filters.developerId,
            );
          const pubOk =
            !filters.publisherId ||
            companies.some(
              (c) => c.role === "Publisher" && Number(c.company_id) === filters.publisherId,
            );
          return devOk && pubOk ? g : null;
        }),
      );
      games = checked.filter((g): g is IGame => g !== null);
    }

    const upcomingDates = new Map<number, Date | null>();
    const upcomingPlatforms = new Map<number, string[]>();
    if (filters.upcomingRelease) {
      const now = Date.now();
      const withUpcoming = await Promise.all(
        games.map(async (g) => {
          const relations = await GameProfileService.getGameRelations(g.id);
          const futureReleases = (relations?.releases ?? [])
            .filter((r) => r.release_date && new Date(r.release_date).getTime() > now)
            .sort(
              (a, b) =>
                new Date(a.release_date!).getTime() - new Date(b.release_date!).getTime(),
            );
          if (!futureReleases.length) return null;
          const upcomingTime = new Date(futureReleases[0].release_date!).getTime();
          const platformsAtDate = Array.from(
            new Set(
              futureReleases
                .filter((r) => new Date(r.release_date!).getTime() === upcomingTime)
                .map((r) => r.platform_name)
                .filter((v): v is string => Boolean(v)),
            ),
          );
          upcomingDates.set(g.id, new Date(upcomingTime));
          upcomingPlatforms.set(g.id, platformsAtDate);
          return g;
        }),
      );
      games = withUpcoming.filter((g): g is IGame => g !== null);
    }

    const withPlatforms = await GamePlatformRegionService.attachPlatformsToGames(games);
    let results: IGameSearchResult[] = withPlatforms.map((g) => ({
      ...g,
      upcomingReleaseDate: upcomingDates.get(g.id) ?? null,
      upcomingReleasePlatforms: upcomingPlatforms.get(g.id) ?? [],
    }));

    if (filters.platformId) {
      const platformId = filters.platformId;
      results = results.filter((g) => g.platforms.some((p) => p.id === platformId));
    }

    results.sort((a, b) => {
      if (filters.upcomingRelease) {
        const aTime = a.upcomingReleaseDate?.getTime() ?? Number.POSITIVE_INFINITY;
        const bTime = b.upcomingReleaseDate?.getTime() ?? Number.POSITIVE_INFINITY;
        if (aTime !== bTime) return aTime - bTime;
      }
      return a.title.localeCompare(b.title);
    });

    return results;
  }
}
