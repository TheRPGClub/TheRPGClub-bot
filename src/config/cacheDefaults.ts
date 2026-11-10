// Shared TTL for in-memory autocomplete caches (game titles, platforms, companies).
export const AUTOCOMPLETE_CACHE_TTL_MS = 5 * 60 * 1000;

// How long a failed background refresh waits before retrying, serving the stale value.
export const AUTOCOMPLETE_CACHE_RETRY_DELAY_MS = 30 * 1000;

// How long the bot trusts a member's Feature access answer from the API (spec api#347).
export const FEATURE_ACCESS_CACHE_TTL_MS = 60 * 1000;

// How long an interaction waits for uncached Feature Flags before it runs ungated, and
// then, for a Feature in Preview, for the member's staff lookup before it is refused. Each
// read has its own wait, and together they stay inside Discord's 3 second reply window.
export const FEATURE_ACCESS_WAIT_MS = 1500;
export const FEATURE_STAFF_WAIT_MS = 1000;
