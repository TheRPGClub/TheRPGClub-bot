import { dbWithConnection, dbQueryConn } from "../db/SqlManager.js";
import { GameSql } from "../db/sql/index.js";
import GameSearchSynonym from "./GameSearchSynonym.js";
import { mapGameRow } from "../functions/GameMappers.js";
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

export default class GameSearchService {
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

      const withPlatforms = await GamePlatformRegionService.attachPlatformsToGames(games);
      return withPlatforms.map((g) => ({
        ...g,
        upcomingReleaseDate: upcomingDates.get(g.id) ?? null,
        upcomingReleasePlatforms: upcomingPlatforms.get(g.id) ?? [],
      }));
    });
  }
}
