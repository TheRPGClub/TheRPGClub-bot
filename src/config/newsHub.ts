import {
  GAME_NEWS_CHANNEL_ID,
  NEWS_ANNOUNCEMENTS_THREAD_ID,
  NEWS_EMULATION_THREAD_ID,
  NEWS_GENERAL_THREAD_ID,
  NEWS_HARDWARE_THREAD_ID,
  NEWS_INDUSTRY_THREAD_ID,
  NEWS_RELEASES_THREAD_ID,
  NEWS_RUMOURS_THREAD_ID,
} from "./channels.js";

/**
 * The News Category keys, in the API's order (`GET /api/v1/news_categories`). The list is
 * fixed in code on both sides: adding or renaming a News Category is a release.
 */
export const NEWS_CATEGORY_KEYS = [
  "announcements",
  "releases",
  "emulation",
  "industry",
  "hardware",
  "rumours",
  "general",
] as const;

export type NewsCategoryKey = (typeof NEWS_CATEGORY_KEYS)[number];

/** Each News Category's name, as the API and the website show it. */
export const NEWS_CATEGORY_NAMES: Readonly<Record<NewsCategoryKey, string>> = {
  announcements: "Announcements & Trailers",
  releases: "Releases & Updates",
  emulation: "Emulation & Preservation",
  industry: "Industry",
  hardware: "Hardware & Platforms",
  rumours: "Rumours & Leaks",
  general: "General",
};

/**
 * Where News Items are posted: channel ID -> the News Category a message there takes, or
 * null when the bot picks it (the News Channel) or staff sort it (the News Import). A
 * channel that is not a key is not a place for news.
 */
export type NewsPlaces = ReadonlyMap<string, NewsCategoryKey | null>;

/**
 * The News Channel (spec api#367): the reopened game news channel, where members share news
 * and discuss it in threads on their messages. Its category is picked per message. A
 * test-mode ID with no override resolves to "", which is left out so it never matches.
 */
export const NEWS_CHANNEL_PLACES: NewsPlaces = new Map(
  GAME_NEWS_CHANNEL_ID === "" ? [] : [[GAME_NEWS_CHANNEL_ID, null]],
);

/** A News Category's thread in the game news forum, where only the bot posts News Copies. */
export interface INewsCategoryThread {
  threadId: string;
  /**
   * The emoji in the thread's name, which the bot reacts with on the original: a Unicode
   * emoji, or `name:id` for a custom one.
   */
  emoji: string;
}

export type NewsCategoryThreads = Readonly<Record<NewsCategoryKey, INewsCategoryThread>>;

// Each emoji matches the one in its category thread's name. Check them against the real
// thread names before the cutover (bot#1543).
export const NEWS_CATEGORY_THREADS: NewsCategoryThreads = {
  announcements: { threadId: NEWS_ANNOUNCEMENTS_THREAD_ID, emoji: "📢" },
  releases: { threadId: NEWS_RELEASES_THREAD_ID, emoji: "📦" },
  emulation: { threadId: NEWS_EMULATION_THREAD_ID, emoji: "💾" },
  industry: { threadId: NEWS_INDUSTRY_THREAD_ID, emoji: "🏢" },
  hardware: { threadId: NEWS_HARDWARE_THREAD_ID, emoji: "🎮" },
  rumours: { threadId: NEWS_RUMOURS_THREAD_ID, emoji: "🤫" },
  general: { threadId: NEWS_GENERAL_THREAD_ID, emoji: "📰" },
};

/** How long a new post waits for Discord's link preview before its category is picked. */
export const NEWS_PREVIEW_WAIT_MS = 10_000;
