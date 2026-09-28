export interface ITtlCache<T> {
  get(): Promise<T>;
  /**
   * Starts a fresh background reload, superseding any fetch already in flight.
   * Callers keep getting the previous value until it lands. Never rejects.
   */
  refresh(): Promise<void>;
  clear(): void;
}

/**
 * Stale-while-revalidate cache. Only the very first load (or a load after clear())
 * blocks callers; once a value exists, an expired entry is served immediately while
 * a single background fetch replaces it. Autocomplete depends on this: a blocking
 * reload of the full game list took long enough to leave Discord's list empty.
 *
 * In-flight fetches are shared so concurrent callers during a refresh don't
 * trigger duplicate upstream requests.
 */
export function createTtlCache<T>(fetcher: () => Promise<T>, ttlMs: number): ITtlCache<T> {
  let cache: { expiresAt: number; value: T } | null = null;
  let pending: Promise<T> | null = null;
  let generation = 0;

  const load = (): Promise<T> => {
    if (pending) {
      return pending;
    }
    const loadGeneration = generation;
    const request = fetcher()
      .then((value) => {
        if (loadGeneration === generation) {
          cache = { expiresAt: Date.now() + ttlMs, value };
        }
        return value;
      })
      .finally(() => {
        if (pending === request) {
          pending = null;
        }
      });
    pending = request;
    return request;
  };

  const loadInBackground = (): Promise<void> =>
    load().then(
      () => undefined,
      (err: unknown) => {
        console.error("[TtlCache] Background refresh failed; serving stale value.", err);
      },
    );

  return {
    async get(): Promise<T> {
      if (!cache) {
        return load();
      }
      if (cache.expiresAt <= Date.now()) {
        void loadInBackground();
      }
      return cache.value;
    },
    refresh(): Promise<void> {
      generation++;
      pending = null;
      return loadInBackground();
    },
    clear(): void {
      generation++;
      cache = null;
      pending = null;
    },
  };
}
