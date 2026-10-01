import { Options, type CacheFactory, type SweeperOptions } from "discord.js";

const SECONDS_PER_HOUR = 60 * 60;

// Messages kept per channel. The message log reads old content for edits and deletes from
// this cache, so it stays at the discord.js default rather than shrinking.
export const MESSAGE_CACHE_MAX_PER_CHANNEL = 200;

// Nothing reads guild.presences; the GuildPresences intent is only there because discord.js
// emits userUpdate from presence packets, and that path reads users.cache, not presences.
export const PRESENCE_CACHE_MAX_PER_GUILD = 0;

// A cached message older than this (by edit or creation time) is swept. Edits and deletes
// of older messages then log without the old content, as any uncached message does today.
export const MESSAGE_SWEEP_LIFETIME_SECONDS = 6 * SECONDS_PER_HOUR;
export const MESSAGE_SWEEP_INTERVAL_SECONDS = SECONDS_PER_HOUR;

// Archived threads are dropped from the cache this long after archiving.
export const THREAD_SWEEP_LIFETIME_SECONDS = 4 * SECONDS_PER_HOUR;
export const THREAD_SWEEP_INTERVAL_SECONDS = SECONDS_PER_HOUR;

export const CLIENT_MAKE_CACHE: CacheFactory = Options.cacheWithLimits({
  ...Options.DefaultMakeCacheSettings,
  MessageManager: MESSAGE_CACHE_MAX_PER_CHANNEL,
  PresenceManager: PRESENCE_CACHE_MAX_PER_GUILD,
});

export const CLIENT_SWEEPERS: SweeperOptions = {
  ...Options.DefaultSweeperSettings,
  messages: {
    interval: MESSAGE_SWEEP_INTERVAL_SECONDS,
    lifetime: MESSAGE_SWEEP_LIFETIME_SECONDS,
  },
  threads: {
    interval: THREAD_SWEEP_INTERVAL_SECONDS,
    lifetime: THREAD_SWEEP_LIFETIME_SECONDS,
  },
};
