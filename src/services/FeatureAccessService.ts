import { FEATURE_ACCESS_CACHE_TTL_MS } from "../config/cacheDefaults.js";
import { createTtlCache, type ITtlCache } from "../functions/TtlCache.js";
import type {
  FeatureState,
  IFeatureAccess,
  IFeatureAccessEntry,
} from "../functions/FeatureGate.js";
import { apiGet } from "./RpgClubApiClient.js";

type FeatureAccessEntryPayload = {
  key: string;
  name: string;
  state: FeatureState;
  can_use: boolean;
  preview: boolean;
};

export type FeatureAccessPayload = {
  data: { user_id: string; staff: boolean; features: FeatureAccessEntryPayload[] };
};

/** Maps the API's `GET /api/v1/users/:user_id/feature_access` body. */
export function toFeatureAccess(payload: FeatureAccessPayload): IFeatureAccess {
  const { data } = payload;
  return {
    userId: data.user_id,
    staff: data.staff,
    features: data.features.map((entry): IFeatureAccessEntry => ({
      key: entry.key,
      name: entry.name,
      state: entry.state,
      canUse: entry.can_use,
      preview: entry.preview,
    })),
  };
}

export interface IFeatureAccessApi {
  fetchFeatureAccess(userId: string): Promise<IFeatureAccess>;
}

export const FEATURE_ACCESS_API: IFeatureAccessApi = {
  async fetchFeatureAccess(userId: string): Promise<IFeatureAccess> {
    const path = `/api/v1/users/${encodeURIComponent(userId)}/feature_access`;
    const payload = await apiGet<FeatureAccessPayload>(path);
    // The lookup answers 200 for every Discord user, so a 404 means the API predates it.
    if (!payload) throw new Error(`GET ${path} returned 404`);
    return toFeatureAccess(payload);
  },
};

export interface IFeatureAccessCache {
  /** The user's Feature access, from the cache when it is fresh enough. */
  get(userId: string): Promise<IFeatureAccess>;
  /** Forgets every user's answer, so the next use asks the API (after `/flag set`). */
  clear(): void;
}

type CacheEntry = { cache: ITtlCache<IFeatureAccess>; usedAt: number };

/**
 * One stale-while-revalidate TtlCache per Discord user. A user active within the TTL gets
 * the cached answer at once while it refreshes in the background, so a flag change shows
 * within about two TTLs. A user idle for longer than the TTL starts over and waits for a
 * fresh answer, which also keeps the map from growing with every member who ever ran a
 * command.
 */
export function createFeatureAccessCache(
  api: IFeatureAccessApi = FEATURE_ACCESS_API,
  ttlMs: number = FEATURE_ACCESS_CACHE_TTL_MS,
): IFeatureAccessCache {
  const entries = new Map<string, CacheEntry>();

  const dropIdle = (now: number): void => {
    for (const [userId, entry] of entries) {
      if (now - entry.usedAt > ttlMs) entries.delete(userId);
    }
  };

  return {
    get(userId: string): Promise<IFeatureAccess> {
      const now = Date.now();
      let entry = entries.get(userId);
      if (!entry || now - entry.usedAt > ttlMs) {
        dropIdle(now);
        const cache = createTtlCache(
          `featureAccess:${userId}`,
          () => api.fetchFeatureAccess(userId),
          ttlMs,
        );
        entry = { cache, usedAt: now };
        entries.set(userId, entry);
      }
      entry.usedAt = now;
      return entry.cache.get();
    },
    clear(): void {
      entries.clear();
    },
  };
}

/** The bot's shared Feature access cache. */
export const featureAccessCache: IFeatureAccessCache = createFeatureAccessCache();

/** Drops every cached Feature access answer, e.g. right after `/flag set` changes a flag. */
export function clearFeatureAccessCache(): void {
  featureAccessCache.clear();
}
