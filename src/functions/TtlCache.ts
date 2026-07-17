export interface ITtlCache<T> {
  get(): Promise<T>;
  clear(): void;
}

/**
 * In-flight fetches are shared so concurrent callers during a refresh don't
 * trigger duplicate upstream requests.
 */
export function createTtlCache<T>(fetcher: () => Promise<T>, ttlMs: number): ITtlCache<T> {
  let cache: { expiresAt: number; value: T } | null = null;
  let pending: Promise<T> | null = null;

  return {
    async get(): Promise<T> {
      const now = Date.now();
      if (cache && cache.expiresAt > now) {
        return cache.value;
      }
      if (pending) {
        return pending;
      }
      pending = fetcher()
        .then((value) => {
          cache = { expiresAt: Date.now() + ttlMs, value };
          return value;
        })
        .finally(() => {
          pending = null;
        });
      return pending;
    },
    clear(): void {
      cache = null;
      pending = null;
    },
  };
}
