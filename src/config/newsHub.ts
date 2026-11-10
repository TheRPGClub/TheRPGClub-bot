import {
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

/**
 * Where News Items are posted: channel or thread ID -> the News Category a message there
 * takes. Null means no category (the Game News Archive, whose items staff sort in the
 * News Import). A channel that is not a key is not a place for news.
 */
export type NewsPlaces = ReadonlyMap<string, NewsCategoryKey | null>;

const CATEGORY_THREADS: readonly (readonly [string, NewsCategoryKey])[] = [
  [NEWS_ANNOUNCEMENTS_THREAD_ID, "announcements"],
  [NEWS_RELEASES_THREAD_ID, "releases"],
  [NEWS_EMULATION_THREAD_ID, "emulation"],
  [NEWS_INDUSTRY_THREAD_ID, "industry"],
  [NEWS_HARDWARE_THREAD_ID, "hardware"],
  [NEWS_RUMOURS_THREAD_ID, "rumours"],
  [NEWS_GENERAL_THREAD_ID, "general"],
];

/**
 * The seven News Category threads in the game news forum. A test-mode ID with no override
 * resolves to "", which is left out so it can never match a channel.
 */
export const NEWS_CATEGORY_THREADS: NewsPlaces = new Map(
  CATEGORY_THREADS.filter(([threadId]) => threadId !== ""),
);
