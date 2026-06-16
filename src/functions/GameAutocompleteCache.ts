import type { IGameAutocompleteResult } from "../types/GameTypes.js";

export const AUTOCOMPLETE_CACHE_TTL_MS = 60_000;
export const AUTOCOMPLETE_CACHE_MAX_ENTRIES = 300;
export const autocompleteSearchCache = new Map<
  string,
  { expiresAt: number; results: IGameAutocompleteResult[] }
>();
export const pendingAutocompleteSearches = new Map<
  string,
  Promise<IGameAutocompleteResult[]>
>();

export function clearAutocompleteSearchCaches(): void {
  autocompleteSearchCache.clear();
  pendingAutocompleteSearches.clear();
}

export function normalizeAutocompleteQuery(query: string): string {
  return query.trim().toLowerCase();
}

export function foldAccentE(query: string): string {
  return query.replace(/[éèêë]/g, "e").replace(/[ÉÈÊË]/g, "E");
}

export function buildAutocompleteCacheKey(query: string, limit: number): string {
  return `${limit}:${normalizeAutocompleteQuery(query)}`;
}

export function pruneAutocompleteCache(now: number): void {
  for (const [key, entry] of autocompleteSearchCache.entries()) {
    if (entry.expiresAt <= now) {
      autocompleteSearchCache.delete(key);
    }
  }
  while (autocompleteSearchCache.size > AUTOCOMPLETE_CACHE_MAX_ENTRIES) {
    const oldestKey = autocompleteSearchCache.keys().next().value as
      | string
      | undefined;
    if (!oldestKey) break;
    autocompleteSearchCache.delete(oldestKey);
  }
}
