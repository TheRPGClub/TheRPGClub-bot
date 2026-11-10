import { FEATURE_ACCESS_CACHE_TTL_MS } from "../config/cacheDefaults.js";
import { createTtlCache, type ITtlCache } from "../functions/TtlCache.js";
import type {
  FeatureState,
  IFeatureAccess,
  IFeatureAccessEntry,
  IFeatureFlag,
  IFeatureFlagSource,
  IFeatureGateSource,
} from "../functions/FeatureGate.js";
import { logError } from "../utilities/LogUtils.js";
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
}

type CacheEntry = { cache: ITtlCache<IFeatureAccess>; usedAt: number };

/**
 * One stale-while-revalidate TtlCache per Discord user, read for the user's staff bit (the
 * gate asks only for a Feature in Preview). A user active within the TTL gets the cached
 * answer at once while it refreshes in the background. A user idle for longer than the TTL
 * starts over and waits for a fresh answer, which also keeps the map from growing with
 * every member who ever ran a command.
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
  };
}

export interface IFeatureFlagCache extends IFeatureFlagSource {
  /**
   * Forgets the flags and starts reading them again at once, so the next use waits for
   * the new answer instead of the old one (after `/flag set` or `feature_flag_changed`).
   */
  clear(): void;
}

/**
 * The club-wide Feature Flags: one stale-while-revalidate TtlCache for the whole bot. Only
 * the first read (or the first after clear()) waits; after that every read is answered at
 * once while a refresh runs in the background past the TTL. The API has no club-wide read
 * for the service token, so the states come from the access lookup for `lookupUserId()`
 * (the bot's own user): a Feature's state does not depend on who asks. Rejects while
 * there is no lookup user (the bot is not logged in yet).
 */
export function createFeatureFlagCache(
  lookupUserId: () => string | null,
  api: IFeatureAccessApi = FEATURE_ACCESS_API,
  ttlMs: number = FEATURE_ACCESS_CACHE_TTL_MS,
): IFeatureFlagCache {
  const cache = createTtlCache<readonly IFeatureFlag[]>(
    "featureFlags",
    async () => {
      const userId = lookupUserId();
      if (!userId) throw new Error("Feature Flags cannot be read before the bot logs in.");
      const access = await api.fetchFeatureAccess(userId);
      return access.features.map(({ key, name, state }) => ({ key, name, state }));
    },
    ttlMs,
  );
  return {
    flags: () => cache.get(),
    clear(): void {
      cache.clear();
      if (lookupUserId()) {
        cache.get().catch((err: unknown) => {
          logError("FeatureAccessService: reloading the Feature Flags failed", err);
        });
      }
    },
  };
}

let botUserId: string | null = null;

/** The bot's shared club-wide Feature Flags. */
export const featureFlagCache: IFeatureFlagCache = createFeatureFlagCache(() => botUserId);

/** The bot's shared per-user access lookups, read for the staff bit. */
export const featureAccessCache: IFeatureAccessCache = createFeatureAccessCache();

/** What the feature gate reads: club-wide flags, and a user's staff bit in Preview. */
export const featureGateSource: IFeatureGateSource = {
  flags: () => featureFlagCache.flags(),
  isStaff: async (userId) => (await featureAccessCache.get(userId)).staff,
};

/**
 * Names the bot's own user for the club-wide flag read and loads the flags in the
 * background, so the first command after a restart need not wait for them.
 */
export function startFeatureFlagCache(userId: string): void {
  botUserId = userId;
  featureFlagCache.clear();
}

/** Re-reads the club-wide Feature Flags, e.g. right after a flag changed. */
export function clearFeatureFlagCache(): void {
  featureFlagCache.clear();
}
