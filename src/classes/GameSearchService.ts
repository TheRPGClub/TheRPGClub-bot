import type { AxiosRequestConfig } from "axios";
import { apiGet, apiGetOrThrow } from "../services/RpgClubApiClient.js";
import GameSearchSynonym from "./GameSearchSynonym.js";
import {
  mapGameFromApi,
  mapUpcomingReleaseFromApi,
  type UpcomingReleaseApiData,
} from "../functions/GameMappers.js";
import {
  findAccentedSpelling,
  foldAccents,
} from "../functions/GameTitleAutocompleteUtils.js";
import { createTtlCache } from "../functions/TtlCache.js";
import { AUTOCOMPLETE_CACHE_TTL_MS } from "../config/cacheDefaults.js";
import type {
  IGame,
  IGameSearchResult,
  IGameAutocompleteResult,
  IUpcomingReleaseResult,
} from "../types/GameTypes.js";
import GamePlatformRegionService from "./GamePlatformRegionService.js";
import GameProfileService from "./GameProfileService.js";
import { logError } from "../utilities/LogUtils.js";

type GamesListResponse = { data: unknown[]; meta: { next: number | null } };
type UpcomingListResponse = {
  data: UpcomingReleaseApiData[];
  meta: { next: number | null };
};

const UPCOMING_RELEASES_PATH = "/api/v1/upcoming_releases";
const UPCOMING_PAGE_SIZE = 100;
// Past this many ids the query string nears Puma's limit, so the whole Release Calendar is
// read and matched here instead. `per_game=next` is per game, so the entries are the same.
const UPCOMING_GAME_ID_LIMIT = 500;

export interface ISearchGameFilters {
  upcomingRelease?: boolean;
  platformId?: number;
  year?: number;
  developerId?: number;
  publisherId?: number;
}

/** The part of a game's relations the developer and publisher filters read. */
export interface IGameCompanyRoles {
  companies?: Array<{ company_id: number | string; role: string | null }>;
}

/** What a search reaches outside itself; tests pass fakes. */
export interface IGameSearchDeps {
  /** GET that answers null on 404. */
  get: <T>(path: string, config?: AxiosRequestConfig) => Promise<T | null>;
  /** GET that throws the AxiosError on any non-2xx, so callers can show it. */
  getOrThrow: <T>(path: string, config?: AxiosRequestConfig) => Promise<T>;
  synonymsFor: (term: string) => Promise<string[]>;
  accentedSpellings: (foldedTerms: string[]) => Promise<string[]>;
  relationsFor: (gameId: number) => Promise<IGameCompanyRoles | null>;
  /** Every GameDB game with its first release date (the cached title list). */
  listGames: () => Promise<IGameAutocompleteResult[]>;
}

const MAX_QUERY_VARIANTS = 8;

type IIndexedGameTitle = {
  game: IGameAutocompleteResult;
  folded: string;
  norm: string;
  accented: boolean;
};

export default class GameSearchService {
  private static async fetchGamesPages(
    params: Record<string, unknown>,
    get: IGameSearchDeps["get"] = apiGet,
  ): Promise<IGame[]> {
    const results: IGame[] = [];
    let page = 1;
    for (;;) {
      const result = await get<GamesListResponse>("/api/v1/games", {
        params: { ...params, page, per: 100 },
      });
      if (!result?.data?.length) break;
      results.push(...result.data.map(mapGameFromApi));
      if (!result.meta?.next) break;
      page++;
    }
    return results;
  }

  /**
   * The API's `q` search is accent-sensitive, so "pokemon" never finds "Pokémon".
   * Finds how each folded term is spelled inside accented titles in the cache
   * ("pokémon") so the caller can search the API with that spelling as well.
   */
  private static async findAccentedSpellings(foldedTerms: string[]): Promise<string[]> {
    let titles: IIndexedGameTitle[];
    try {
      titles = await GameSearchService.gameTitleCache.get();
    } catch (error) {
      logError("GameSearchService.findAccentedSpellings", error);
      return [];
    }
    const spellings = new Set<string>();
    for (const entry of titles) {
      if (!entry.accented) continue;
      for (const term of foldedTerms) {
        const spelling = findAccentedSpelling(entry.game.title, term);
        if (spelling) spellings.add(spelling);
      }
      if (spellings.size >= MAX_QUERY_VARIANTS) break;
    }
    return Array.from(spellings).slice(0, MAX_QUERY_VARIANTS);
  }

  private static async buildQueryVariants(
    baseQuery: string,
    synonymsFor: IGameSearchDeps["synonymsFor"],
  ): Promise<string[]> {
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
      const tokenSynonyms = await synonymsFor(token);
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
      const folded = foldAccents(term).toLowerCase();
      const norm = folded.replace(/[^a-z0-9]/g, "");
      if (norm) termSet.set(norm, folded);
    });

    return Array.from(termSet.values()).slice(0, MAX_QUERY_VARIANTS);
  }

  // Folded/normalized keys are computed once per cache load, not on every keystroke.
  private static gameTitleCache = createTtlCache<IIndexedGameTitle[]>(
    "games",
    async () => {
      const games = await GameSearchService.fetchGamesPages({});
      return games.map((g) => {
        const folded = foldAccents(g.title.toLowerCase()).toLowerCase();
        return {
          game: { id: g.id, title: g.title, initialReleaseDate: g.initialReleaseDate },
          folded,
          norm: folded.replace(/[^a-z0-9]/g, ""),
          accented: foldAccents(g.title) !== g.title,
        };
      });
    },
    AUTOCOMPLETE_CACHE_TTL_MS,
  );

  /**
   * Reloads the title list in the background. Call at startup so the first
   * autocomplete does not wait on a full paged fetch, and after writes so new
   * games appear without making the next keystroke block.
   */
  static refreshGameTitleCache(): Promise<void> {
    return GameSearchService.gameTitleCache.refresh();
  }

  /**
   * Looks up titles in the cached game list. Ids the cache does not hold yet
   * (games created since its last load) are absent from the result.
   */
  static async getCachedTitles(ids: number[]): Promise<Map<number, string>> {
    const wanted = new Set(ids);
    const titles = new Map<number, string>();
    if (!wanted.size) return titles;
    for (const { game } of await GameSearchService.gameTitleCache.get()) {
      if (wanted.has(game.id)) titles.set(game.id, game.title);
    }
    return titles;
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

    const lowerQuery = baseQuery.toLowerCase();
    const foldedLowerQuery = foldAccents(lowerQuery).toLowerCase();
    const normalizedQuery = foldedLowerQuery.replace(/[^a-z0-9]/g, "");
    if (!normalizedQuery && !/[a-z0-9]/.test(foldedLowerQuery)) {
      return [];
    }

    const games = await GameSearchService.gameTitleCache.get();

    const rank = ({ folded, norm }: IIndexedGameTitle): number => {
      if (folded === foldedLowerQuery) return 0;
      if (folded.startsWith(foldedLowerQuery)) return 1;
      if (normalizedQuery && norm === normalizedQuery) return 2;
      if (normalizedQuery && norm.startsWith(normalizedQuery)) return 3;
      if (folded.includes(foldedLowerQuery)) return 4;
      if (normalizedQuery && norm.includes(normalizedQuery)) return 5;
      return -1;
    };

    const matched = games
      .map((entry) => ({ game: entry.game, rank: rank(entry) }))
      .filter((entry) => entry.rank >= 0)
      .sort((a, b) => {
        const rankDiff = a.rank - b.rank;
        return rankDiff !== 0 ? rankDiff : a.game.title.localeCompare(b.game.title);
      });

    return matched.slice(0, safeLimit).map((entry) => entry.game);
  }

  private static readonly defaultDeps: IGameSearchDeps = {
    get: <T>(path: string, config?: AxiosRequestConfig) => apiGet<T>(path, config),
    getOrThrow: <T>(path: string, config?: AxiosRequestConfig) =>
      apiGetOrThrow<T>(path, config),
    synonymsFor: (term) => GameSearchSynonym.getTermsForQuery(term),
    accentedSpellings: (terms) => GameSearchService.findAccentedSpellings(terms),
    relationsFor: (gameId) => GameProfileService.getGameRelations(gameId),
    listGames: async () =>
      (await GameSearchService.gameTitleCache.get()).map((entry) => entry.game),
  };

  /**
   * Games whose title matches the query (with its synonyms and accented spellings) and,
   * when given, that involve one of the companies. With no query, every such game.
   */
  private static async fetchTitleMatches(
    baseQuery: string,
    companyIds: number[],
    deps: IGameSearchDeps,
  ): Promise<IGame[]> {
    const queryTerms = await GameSearchService.buildQueryVariants(
      baseQuery, deps.synonymsFor,
    );
    if (baseQuery && !queryTerms.length) return [];

    const fetchParams: Record<string, unknown> = {};
    if (companyIds.length) fetchParams.company_id = companyIds;
    const gameMap = new Map<number, IGame>();
    const terms = queryTerms.length
      ? [...queryTerms, ...(await deps.accentedSpellings(queryTerms))]
      : [null];
    for (const term of terms) {
      const params = term === null ? fetchParams : { ...fetchParams, q: term };
      const rows = await GameSearchService.fetchGamesPages(params, deps.get);
      rows.forEach((g) => gameMap.set(g.id, g));
    }
    return Array.from(gameMap.values());
  }

  private static companyIdsOf(filters: ISearchGameFilters): number[] {
    return [filters.developerId, filters.publisherId].filter(
      (id): id is number => typeof id === "number" && Number.isFinite(id) && id > 0,
    );
  }

  /** Keeps the items whose game has the developer and publisher the filters ask for. */
  private static async filterByCompanyRoles<T extends { id: number }>(
    items: T[],
    filters: ISearchGameFilters,
    relationsFor: IGameSearchDeps["relationsFor"],
  ): Promise<T[]> {
    if (!filters.developerId && !filters.publisherId) return items;
    const checked = await Promise.all(
      items.map(async (item) => {
        const companies = (await relationsFor(item.id))?.companies ?? [];
        const hasRole = (role: string, companyId: number | undefined): boolean =>
          !companyId ||
          companies.some((c) => c.role === role && Number(c.company_id) === companyId);
        return hasRole("Developer", filters.developerId) &&
          hasRole("Publisher", filters.publisherId)
          ? item
          : null;
      }),
    );
    return checked.filter((item): item is Awaited<T> => item !== null);
  }

  /** Every page of the Release Calendar, one entry per game (its next one). */
  private static async fetchNextUpcomingReleases(
    gameIds: number[] | null,
    platformId: number | undefined,
    getOrThrow: IGameSearchDeps["getOrThrow"],
  ): Promise<IUpcomingReleaseResult[]> {
    const params: Record<string, unknown> = { per_game: "next", per: UPCOMING_PAGE_SIZE };
    const sendIds = gameIds !== null && gameIds.length <= UPCOMING_GAME_ID_LIMIT;
    // Comma-separated, because a plain repeated `game_id=` keeps only the last id in Rails.
    if (sendIds) params.game_id = gameIds.join(",");
    if (platformId) params.platform_id = String(platformId);

    const rows: IUpcomingReleaseResult[] = [];
    let page = 1;
    for (;;) {
      const result = await getOrThrow<UpcomingListResponse>(UPCOMING_RELEASES_PATH, {
        params: { ...params, page },
      });
      rows.push(...(result?.data ?? []).map(mapUpcomingReleaseFromApi));
      const next = result?.meta?.next;
      if (!next || next <= page) break;
      page = next;
    }
    if (gameIds && !sendIds) {
      const wanted = new Set(gameIds);
      return rows.filter((row) => wanted.has(row.id));
    }
    return rows;
  }

  /**
   * `/gamedb search upcoming_release:true`: each matching game once, on its next Upcoming
   * Release, in Release Calendar order. Title, year and company filters are resolved to
   * game ids first; the platform filter goes to the Release Calendar as is.
   * Throws the AxiosError when the Release Calendar answers with an error.
   */
  static async searchUpcomingReleases(
    query: string,
    filters: ISearchGameFilters = {},
    deps: IGameSearchDeps = GameSearchService.defaultDeps,
  ): Promise<IUpcomingReleaseResult[]> {
    const baseQuery = query.trim();
    const companyIds = GameSearchService.companyIdsOf(filters);

    let candidates: Array<Pick<IGame, "id" | "initialReleaseDate">> | null = null;
    if (baseQuery || companyIds.length) {
      candidates = await GameSearchService.fetchTitleMatches(baseQuery, companyIds, deps);
    } else if (filters.year) {
      candidates = await deps.listGames();
    }
    if (candidates && filters.year) {
      const targetYear = filters.year;
      candidates = candidates.filter(
        (g) => g.initialReleaseDate?.getUTCFullYear() === targetYear,
      );
    }
    if (candidates && !candidates.length) return [];

    const rows = await GameSearchService.fetchNextUpcomingReleases(
      candidates?.map((g) => g.id) ?? null,
      filters.platformId,
      deps.getOrThrow,
    );
    return GameSearchService.filterByCompanyRoles(rows, filters, deps.relationsFor);
  }

  /**
   * Title and filter search over GameDB games, ordered by title. The upcoming Release
   * filter is not handled here: `searchUpcomingReleases` answers it.
   */
  static async searchGames(
    query: string,
    filters: Omit<ISearchGameFilters, "upcomingRelease"> = {},
  ): Promise<IGameSearchResult[]> {
    const deps = GameSearchService.defaultDeps;
    const baseQuery = query.trim();
    const hasFilters =
      filters.platformId || filters.year || filters.developerId || filters.publisherId;
    if (!baseQuery && !hasFilters) {
      return [];
    }

    let games = await GameSearchService.fetchTitleMatches(
      baseQuery, GameSearchService.companyIdsOf(filters), deps,
    );

    if (filters.year) {
      const targetYear = filters.year;
      games = games.filter(
        (g) => g.initialReleaseDate?.getUTCFullYear() === targetYear,
      );
    }

    games = await GameSearchService.filterByCompanyRoles(games, filters, deps.relationsFor);

    let results = await GamePlatformRegionService.attachPlatformsToGames(games);
    if (filters.platformId) {
      const platformId = filters.platformId;
      results = results.filter((g) => g.platforms.some((p) => p.id === platformId));
    }

    return results.sort((a, b) => a.title.localeCompare(b.title));
  }
}
