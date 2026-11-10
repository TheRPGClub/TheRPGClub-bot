import {
  AUTOCOMPLETE_CACHE_RETRY_DELAY_MS,
  FEATURE_ACCESS_CACHE_TTL_MS,
} from "../config/cacheDefaults.js";
import { createTtlCache, type ITtlCache } from "../functions/TtlCache.js";
import type {
  FeatureState,
  IFeatureAccess,
  IFeatureAccessEntry,
  IFeatureFlag,
  IFeatureFlagSource,
  IFeatureGateSource,
} from "../functions/FeatureGate.js";
import { apiGetOrThrow } from "./RpgClubApiClient.js";

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
    // The lookup answers 200 for every Discord user; a 404 (an API that predates it) is
    // thrown as is, so the log shows the full request and response.
    const path = `/api/v1/users/${encodeURIComponent(userId)}/feature_access`;
    return toFeatureAccess(await apiGetOrThrow<FeatureAccessPayload>(path));
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
   * Starts reading the flags again at once (after `/flag set` or `feature_flag_changed`).
   * Reads keep getting the last flags until the new ones land, and keep them if the read
   * fails, so a refresh never leaves the gate with nothing to go on.
   */
  refresh(): void;
}

/**
 * The club-wide Feature Flags: one stale-while-revalidate TtlCache for the whole bot. Only
 * the first read waits; after that every read is answered at once while a refresh runs in
 * the background past the TTL (or after refresh()). The API has no club-wide read for the
 * service token, so the states come from the access lookup for `lookupUserId()` (the
 * bot's own user): a Feature's state does not depend on who asks. Rejects while there is
 * no lookup user (the bot is not logged in yet). While there are no flags yet, a failed
 * read is not retried for `retryDelayMs` (reads reject at once instead), so an API outage
 * does not make every interaction wait on a read of its own.
 */
export function createFeatureFlagCache(
  lookupUserId: () => string | null,
  api: IFeatureAccessApi = FEATURE_ACCESS_API,
  ttlMs: number = FEATURE_ACCESS_CACHE_TTL_MS,
  retryDelayMs: number = AUTOCOMPLETE_CACHE_RETRY_DELAY_MS,
): IFeatureFlagCache {
  let loaded = false;
  let failure: { until: number; err: unknown } | null = null;
  const cache = createTtlCache<readonly IFeatureFlag[]>(
    "featureFlags",
    async () => {
      try {
        const userId = lookupUserId();
        if (!userId) throw new Error("Feature Flags cannot be read before the bot logs in.");
        const access = await api.fetchFeatureAccess(userId);
        loaded = true;
        failure = null;
        return access.features.map(({ key, name, state }) => ({ key, name, state }));
      } catch (err) {
        if (!loaded) failure = { until: Date.now() + retryDelayMs, err };
        throw err;
      }
    },
    ttlMs,
    retryDelayMs,
  );
  return {
    flags(): Promise<readonly IFeatureFlag[]> {
      if (failure && Date.now() < failure.until) return Promise.reject(failure.err);
      return cache.get();
    },
    refresh(): void {
      failure = null;
      if (lookupUserId()) void cache.refresh();
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
  featureFlagCache.refresh();
}

/** Re-reads the club-wide Feature Flags, e.g. right after a flag changed. */
export function refreshFeatureFlagCache(): void {
  featureFlagCache.refresh();
}
