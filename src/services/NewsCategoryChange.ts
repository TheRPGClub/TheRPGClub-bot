import axios from "axios";
import type { Client } from "discord.js";
import { GAME_NEWS_CHANNEL_ID } from "../config/channels.js";
import {
  NEWS_CATEGORY_NAMES,
  NEWS_CATEGORY_THREADS,
  NEWS_CHANNEL_PLACES,
  type NewsCategoryKey,
  type NewsCategoryThreads,
  type NewsPlaces,
} from "../config/newsHub.js";
import { FEATURE_NOT_AVAILABLE_MESSAGE } from "../functions/FeatureGate.js";
import { NOT_A_NEWS_ITEM_MESSAGE } from "../functions/NewsCategoryChangePrompt.js";
import type { INewsCopySource } from "../functions/NewsCopy.js";
import { postedNewsItemFrom } from "../functions/NewsItem.js";
import {
  buildApiErrorMessage,
  buildDiscordErrorMessage,
} from "../utilities/ApiErrorUtils.js";
import { logError } from "../utilities/LogUtils.js";
import {
  discordNewsCopier,
  fetchNewsChannel,
  newsCopyImagesOf,
  newsCopySourceOf,
  postNewsCopy,
  type INewsCopyDiscord,
  type INewsPost,
} from "./NewsCopying.js";
import { NEWS_COPY_LANE, type NewsCopyLane } from "./NewsCopyLane.js";
import type { INewsImportMove } from "./NewsImportApi.js";
import {
  NEWS_ITEM_API,
  type INewsCopyLocation,
  type INewsFilingApi,
} from "./NewsItemApi.js";
import { apiPutOrThrow } from "./RpgClubApiClient.js";

// Correcting a News Item's category (spec api#367, bot#1541): the sharer or staff choose a
// new News Category from the "Change news category" message command. The API decides who
// may and records the change; the bot then moves the News Copy to the new category's thread
// and swaps its reaction on the original.

const LOG_CONTEXT = "NewsCategoryChange";

export const NEWS_CATEGORY_NOT_AUTHOR_MESSAGE =
  "Only the member who shared this news and staff can change its category.";

/**
 * The refusal while a history copy runs: it may hold a page listing the item under its old
 * category, and would post that into the old thread.
 */
export const NEWS_CATEGORY_HISTORY_COPY_MESSAGE =
  "A history copy is running; try again when it finishes.";

/** The parts of the API's NewsItem the move reads. */
export interface INewsItemRecord {
  message_id: string;
  origin: "live" | "import";
  category_key: NewsCategoryKey | null;
  comment: string | null;
  posted_at: string;
  link: { url: string } | null;
  author: { user_id: string };
  news_copy: INewsCopyLocation | null;
}

export interface INewsCategoryChangeResult {
  /** The News Item; its `news_copy` is still where it was before the change. */
  item: INewsItemRecord;
  /** False when the item already had that category: nothing was recorded. */
  changed: boolean;
  previousCategoryKey: NewsCategoryKey | null;
}

export interface INewsCategoryApi extends INewsFilingApi {
  /** PUT /api/v1/news_items/:message_id/category for the acting member. */
  changeCategory: (
    messageId: string,
    actingUserId: string,
    categoryKey: NewsCategoryKey,
  ) => Promise<INewsCategoryChangeResult>;
}

const newsCategoryPath = (messageId: string): string =>
  `/api/v1/news_items/${encodeURIComponent(messageId)}/category`;

/** The real News Item writes with the category change. */
export const NEWS_CATEGORY_API: INewsCategoryApi = {
  ...NEWS_ITEM_API,
  changeCategory: async (messageId, actingUserId, categoryKey) => {
    const payload = await apiPutOrThrow<{
      data: INewsItemRecord;
      meta: { changed: boolean; previous_category_key: NewsCategoryKey | null };
    }>(newsCategoryPath(messageId), {
      data: { acting_user_id: actingUserId, category_key: categoryKey },
    });
    return {
      item: payload.data,
      changed: payload.meta.changed,
      previousCategoryKey: payload.meta.previous_category_key,
    };
  },
};

/** A News Channel message as just read, with the emojis the bot has reacted with. */
export interface INewsFetchedPost {
  post: INewsPost;
  /** Unicode emojis, or `name:id` for custom ones, as in the category thread config. */
  ownReactions: readonly string[];
}

/** The Discord side of moving a News Copy. */
export interface INewsCategoryMoveDiscord extends INewsCopyDiscord {
  /** Reads a message fresh, so its image addresses have not expired. */
  fetchPost: (channelId: string, messageId: string) => Promise<INewsFetchedPost>;
  removeOwnReaction: (channelId: string, messageId: string, emoji: string) => Promise<void>;
}

export interface INewsCategoryMoveDeps {
  threads: NewsCategoryThreads;
  api: INewsFilingApi;
  discord: INewsCategoryMoveDiscord;
  /**
   * The copy lane: a move waits while a backfill copier runs, so the threads stay in date
   * order, and a correction is refused while a history copy runs. Absent: never waits.
   */
  lane?: Pick<NewsCopyLane, "historyRunning" | "idle">;
}

export interface INewsCategoryChangeDeps extends INewsCategoryMoveDeps {
  api: INewsCategoryApi;
}

async function tryDiscord(label: string, action: () => Promise<void>): Promise<boolean> {
  try {
    await action();
    return true;
  } catch (error: unknown) {
    logError(LOG_CONTEXT, buildDiscordErrorMessage(label, error));
    return false;
  }
}

/**
 * Swaps the bot's category reaction on the original for `categoryKey`'s emoji. A message
 * the bot never reacted to with a category emoji (history, imported items) is left bare.
 */
export async function swapCategoryReaction(
  fetched: INewsFetchedPost,
  categoryKey: NewsCategoryKey,
  deps: INewsCategoryMoveDeps,
): Promise<void> {
  const categoryEmojis = new Set(Object.values(deps.threads).map((thread) => thread.emoji));
  const own = fetched.ownReactions.filter((emoji) => categoryEmojis.has(emoji));
  if (!own.length) return;
  const { channelId, id } = fetched.post;
  const emoji = deps.threads[categoryKey].emoji;
  for (const old of own.filter((reacted) => reacted !== emoji)) {
    await tryDiscord(`Could not remove the ${old} reaction from News Item ${id}`,
      () => deps.discord.removeOwnReaction(channelId, id, old));
  }
  if (own.includes(emoji)) return;
  await tryDiscord(`Could not react to News Item ${id} with its ${categoryKey} emoji`,
    () => deps.discord.react(channelId, id, emoji));
}

/**
 * Moves News Item `messageId`'s copy to `categoryKey`'s thread, once no backfill copier is
 * running: deletes the old copy (a failure is logged and the move goes on, since the
 * category has already changed), posts the new one and reports it. When the new copy
 * cannot be posted or reported, the item is reported as having no copy, so catch-up posts
 * it in the new thread later. The new location, or null.
 */
export async function moveNewsCopy(
  messageId: string,
  categoryKey: NewsCategoryKey,
  oldCopy: INewsCopyLocation,
  source: INewsCopySource,
  deps: INewsCategoryMoveDeps,
): Promise<INewsCopyLocation | null> {
  await deps.lane?.idle();
  await tryDiscord(
    `Could not delete the old News Copy ${oldCopy.message_id} of News Item ${messageId} ` +
      `in thread ${oldCopy.thread_id}; delete it by hand`,
    () => deps.discord.deleteMessage(oldCopy.thread_id, oldCopy.message_id),
  );
  const moved = await postNewsCopy(messageId, categoryKey, source, deps);
  if (moved) return moved;
  try {
    await deps.api.reportCopy(messageId, null);
  } catch (error: unknown) {
    const label = `Could not report that News Item ${messageId} has no News Copy after its ` +
      "move failed";
    logError(LOG_CONTEXT, buildApiErrorMessage(label, error));
  }
  return null;
}

/** What the new copy of a corrected item shows: the API's item, the original's images. */
function correctedCopySource(post: INewsPost, item: INewsItemRecord): INewsCopySource {
  return {
    originalUrl: post.url,
    authorId: item.author.user_id,
    comment: item.comment,
    linkUrl: item.link?.url ?? null,
    images: newsCopyImagesOf(post),
    postedAt: item.origin === "import" ? new Date(item.posted_at) : null,
  };
}

export interface INewsCategoryChangeRequest {
  actingUserId: string;
  channelId: string;
  messageId: string;
  categoryKey: NewsCategoryKey;
}

/** The private reply; `failed` replies are shown as errors (with the dev ping allowed). */
export interface INewsCategoryChangeReply {
  text: string;
  failed: boolean;
}

/** The member-facing reason for an API refusal, or null when it is not one. */
function refusalText(status: number | undefined, code: unknown): string | null {
  if (status === 404) return NOT_A_NEWS_ITEM_MESSAGE;
  if (status !== 403) return null;
  return code === "feature_unavailable"
    ? FEATURE_NOT_AVAILABLE_MESSAGE
    : NEWS_CATEGORY_NOT_AUTHOR_MESSAGE;
}

function refusalReply(error: unknown): INewsCategoryChangeReply {
  if (axios.isAxiosError(error)) {
    const code = (error.response?.data as { error?: unknown } | undefined)?.error;
    const refusal = refusalText(error.response?.status, code);
    if (refusal) {
      return { text: buildApiErrorMessage(refusal, error, { devPing: false }), failed: false };
    }
  }
  return { text: buildApiErrorMessage("Could not change the news category", error), failed: true };
}

const bold = (key: NewsCategoryKey): string => `**${NEWS_CATEGORY_NAMES[key]}**`;

/**
 * "Change news category": asks the API to change the category for the acting member (it
 * refuses anyone but the author and staff, and follows the Feature Flag), then swaps the
 * reaction and moves the News Copy. Nothing is thrown; the reply says what happened.
 */
export async function changeNewsCategory(
  request: INewsCategoryChangeRequest,
  deps: INewsCategoryChangeDeps,
): Promise<INewsCategoryChangeReply> {
  const { messageId, categoryKey } = request;
  if (deps.lane?.historyRunning()) {
    return { text: NEWS_CATEGORY_HISTORY_COPY_MESSAGE, failed: false };
  }
  let result: INewsCategoryChangeResult;
  try {
    result = await deps.api.changeCategory(messageId, request.actingUserId, categoryKey);
  } catch (error: unknown) {
    return refusalReply(error);
  }
  if (!result.changed) {
    return { text: `This news is already in ${bold(categoryKey)}. Nothing changed.`, failed: false };
  }

  const was = result.previousCategoryKey ? ` (was ${bold(result.previousCategoryKey)})` : "";
  const changed = `Moved this news to ${bold(categoryKey)}${was}.`;
  const thread = `<#${deps.threads[categoryKey].threadId}>`;
  const oldCopy = result.item.news_copy;
  if (!oldCopy) {
    return { text: `${changed} Its copy will be posted in ${thread} later.`, failed: false };
  }
  const notMoved = {
    text: `${changed} Its copy could not be moved; it will be posted in ${thread} later.`,
    failed: false,
  };

  let fetched: INewsFetchedPost;
  try {
    fetched = await deps.discord.fetchPost(request.channelId, messageId);
  } catch (error: unknown) {
    const label = `Could not read News Item ${messageId} to move its News Copy`;
    logError(LOG_CONTEXT, buildDiscordErrorMessage(label, error));
    return { ...notMoved, text: `${changed} Its copy could not be moved.` };
  }
  await swapCategoryReaction(fetched, categoryKey, deps);
  const source = correctedCopySource(fetched.post, result.item);
  const moved = await moveNewsCopy(messageId, categoryKey, oldCopy, source, deps);
  if (!moved) return notMoved;
  return { text: `${changed} Its copy is now in ${thread}.`, failed: false };
}

export interface INewsCopyMovesDeps extends INewsCategoryMoveDeps {
  /** The News Channel, where the imported originals are. */
  channelId: string;
  places: NewsPlaces;
}

/**
 * `/news-import upload`: moves the News Copy of each item whose category the upload
 * changed, one after another. Each original is read again for its comment and images; one
 * that cannot be read keeps its copy where it is (logged). The number of copies moved.
 */
export async function moveNewsCopies(
  moves: readonly INewsImportMove[],
  deps: INewsCopyMovesDeps,
): Promise<number> {
  let moved = 0;
  for (const move of moves) {
    if (!move.copy) continue;
    // Read the original once the lane is free, so its image addresses are fresh.
    await deps.lane?.idle();
    let fetched: INewsFetchedPost;
    try {
      fetched = await deps.discord.fetchPost(deps.channelId, move.messageId);
    } catch (error: unknown) {
      const label = `Could not read News Item ${move.messageId} to move its News Copy to ` +
        `${move.categoryKey}; the copy stays in thread ${move.copy.thread_id}`;
      logError(LOG_CONTEXT, buildDiscordErrorMessage(label, error));
      continue;
    }
    const item = postedNewsItemFrom(fetched.post, deps.places);
    if (!item) {
      logError(LOG_CONTEXT, `News Item ${move.messageId} is no longer news; its News Copy ` +
        `stays in thread ${move.copy.thread_id}`);
      continue;
    }
    await swapCategoryReaction(fetched, move.categoryKey, deps);
    const postedAt = move.origin === "import" ? fetched.post.createdAt : null;
    const source = newsCopySourceOf(fetched.post, item, postedAt);
    if (await moveNewsCopy(move.messageId, move.categoryKey, move.copy, source, deps)) {
      moved += 1;
    }
  }
  return moved;
}

/** A custom emoji as `name:id`, a Unicode one as itself: the category thread config's form. */
function emojiKey(emoji: { id: string | null; name: string | null }): string {
  return emoji.id ? `${emoji.name ?? ""}:${emoji.id}` : emoji.name ?? "";
}

/** The real Discord side of moving a News Copy, through the bot's client. */
export function discordNewsCategoryMover(client: Client): INewsCategoryMoveDiscord {
  return {
    ...discordNewsCopier(client),
    fetchPost: async (channelId, messageId) => {
      const channel = await fetchNewsChannel(client, channelId);
      const post = await channel.messages.fetch({ message: messageId, force: true });
      const ownReactions = post.reactions.cache
        .filter((reacted) => reacted.me)
        .map((reacted) => emojiKey(reacted.emoji));
      return { post, ownReactions };
    },
    removeOwnReaction: async (channelId, messageId, emoji) => {
      const channel = await fetchNewsChannel(client, channelId);
      const post = await channel.messages.fetch(messageId);
      const key = emoji.includes(":") ? emoji.slice(emoji.lastIndexOf(":") + 1) : emoji;
      await post.reactions.resolve(key)?.users.remove();
    },
  };
}

/** The real dependencies of a category change and of the upload's copy moves. */
export function createNewsCategoryDeps(
  client: Client,
): INewsCategoryChangeDeps & INewsCopyMovesDeps {
  return {
    threads: NEWS_CATEGORY_THREADS,
    api: NEWS_CATEGORY_API,
    discord: discordNewsCategoryMover(client),
    channelId: GAME_NEWS_CHANNEL_ID,
    places: NEWS_CHANNEL_PLACES,
    lane: NEWS_COPY_LANE,
  };
}
