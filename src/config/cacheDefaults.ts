// Shared TTL for in-memory autocomplete caches (game titles, platforms, companies).
export const AUTOCOMPLETE_CACHE_TTL_MS = 5 * 60 * 1000;

// How long a failed background refresh waits before retrying, serving the stale value.
export const AUTOCOMPLETE_CACHE_RETRY_DELAY_MS = 30 * 1000;
