import type { Client } from "discord.js";
import type { NewsCategoryKey, NewsCategoryThreads } from "../config/newsHub.js";
import {
  buildNewsCopy,
  type INewsCopyMessage,
  type INewsCopySource,
} from "../functions/NewsCopy.js";
import {
  newsImageAttachments,
  type INewsItemPayload,
  type INewsMessage,
} from "../functions/NewsItem.js";
import {
  buildApiErrorMessage,
  buildDiscordErrorMessage,
} from "../utilities/ApiErrorUtils.js";
import { logError } from "../utilities/LogUtils.js";
import {
  newsItemRecordBody,
  type INewsCopyLocation,
  type INewsFilingApi,
} from "./NewsItemApi.js";

// Filing a News Item (spec api#367): record it with its category, react to the original
// with the category's emoji, post its News Copy in the category's thread and report where
// the copy lives. Live posts, catch-up, the history copy, corrections and /news share all
// go through here. Nothing is thrown: every failure is logged with the full request and
// response (console.error reaches the console log channel).

const LOG_CONTEXT = "NewsCopying";

/** The narrow slice of Discord that filing writes to. */
export interface INewsCopyDiscord {
  /** Adds the bot's reaction to a message. */
  react: (channelId: string, messageId: string, emoji: string) => Promise<void>;
  /** Posts a News Copy in a category thread; the copy's message ID. */
  postCopy: (threadId: string, copy: INewsCopyMessage) => Promise<{ messageId: string }>;
  deleteMessage: (channelId: string, messageId: string) => Promise<void>;
}

export interface INewsCopyDeps {
  /** Each News Category's thread and emoji. */
  threads: NewsCategoryThreads;
  api: INewsFilingApi;
  discord: INewsCopyDiscord;
}

/** A message the News Copy can link back to: discord.js's Message has its jump `url`. */
export type INewsPost = INewsMessage & { url: string };

/**
 * What the News Copy of `item` shows, read from its original message `post`: fetch the
 * message first when it is old, so its image addresses have not expired. `postedAt` is the
 * original date, given for an imported item only.
 */
export function newsCopySourceOf(
  post: INewsPost,
  item: INewsItemPayload,
  postedAt: Date | null = null,
): INewsCopySource {
  return {
    originalUrl: post.url,
    authorId: item.author_id,
    comment: item.comment,
    linkUrl: item.link?.url ?? null,
    images: newsImageAttachments(post).map(({ url, name }) => ({ url, name })),
    postedAt,
  };
}

/**
 * Posts the News Copy of News Item `messageId` in `categoryKey`'s thread and reports where
 * it lives. Returns that location, or null when there is no copy: posting failed (the item
 * stays uncopied, for catch-up to retry), or reporting failed (the copy is deleted again,
 * so a retry does not leave two).
 */
export async function postNewsCopy(
  messageId: string,
  categoryKey: NewsCategoryKey,
  source: INewsCopySource,
  deps: INewsCopyDeps,
): Promise<INewsCopyLocation | null> {
  const threadId = deps.threads[categoryKey].threadId;
  let copyId: string;
  try {
    copyId = (await deps.discord.postCopy(threadId, buildNewsCopy(source))).messageId;
  } catch (error: unknown) {
    const label = `Could not post the News Copy of News Item ${messageId} in the ` +
      `${categoryKey} thread ${threadId}; catch-up will retry it`;
    logError(LOG_CONTEXT, buildDiscordErrorMessage(label, error));
    return null;
  }
  const location = { message_id: copyId, thread_id: threadId };
  try {
    await deps.api.reportCopy(messageId, location);
    return location;
  } catch (error: unknown) {
    const label = `Could not report the News Copy ${copyId} of News Item ${messageId}; ` +
      "deleting the copy so catch-up can post it again";
    logError(LOG_CONTEXT, buildApiErrorMessage(label, error));
  }
  try {
    await deps.discord.deleteMessage(threadId, copyId);
  } catch (error: unknown) {
    const label = `Could not delete the unreported News Copy ${copyId} in thread ${threadId}`;
    logError(LOG_CONTEXT, buildDiscordErrorMessage(label, error));
  }
  return null;
}

/** A News Item to file, with its category and what its copy shows. */
export interface INewsFiling {
  item: INewsItemPayload;
  categoryKey: NewsCategoryKey;
  /** The category the bot picked; null when a member chose it (/news share). */
  pickedCategoryKey: NewsCategoryKey | null;
  copy: INewsCopySource;
  /** Whether to react to the original: live posts only, never history. */
  react: boolean;
}

export interface INewsFilingOutcome {
  recorded: boolean;
  /** Where the News Copy lives, or null when it could not be posted or reported. */
  copy: INewsCopyLocation | null;
}

/**
 * Records the News Item with its category and pick, reacts to the original with the
 * category's emoji, posts the News Copy and reports where it lives. An item the API does
 * not record is neither reacted to nor copied; a failed reaction does not stop the copy.
 */
export async function fileNewsItem(
  filing: INewsFiling,
  deps: INewsCopyDeps,
): Promise<INewsFilingOutcome> {
  const { item, categoryKey } = filing;
  const body = newsItemRecordBody({ ...item, category_key: categoryKey });
  try {
    await deps.api.record(item.message_id, {
      data: { ...body.data, picked_category_key: filing.pickedCategoryKey },
    });
  } catch (error: unknown) {
    logError(LOG_CONTEXT, buildApiErrorMessage(`Could not record News Item ${item.message_id}`,
      error));
    return { recorded: false, copy: null };
  }
  if (filing.react) {
    try {
      await deps.discord.react(item.channel_id, item.message_id, deps.threads[categoryKey].emoji);
    } catch (error: unknown) {
      const label = `Could not react to News Item ${item.message_id} with its ` +
        `${categoryKey} emoji`;
      logError(LOG_CONTEXT, buildDiscordErrorMessage(label, error));
    }
  }
  const copy = await postNewsCopy(item.message_id, categoryKey, filing.copy, deps);
  return { recorded: true, copy };
}

async function messageChannel(client: Client, channelId: string) {
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isSendable()) {
    throw new Error(`Channel ${channelId} is missing or the bot cannot post in it.`);
  }
  return channel;
}

/** The real Discord writes, through the bot's client. */
export function discordNewsCopier(client: Client): INewsCopyDiscord {
  return {
    react: async (channelId, messageId, emoji) => {
      await (await messageChannel(client, channelId)).messages.react(messageId, emoji);
    },
    postCopy: async (threadId, copy) => {
      const posted = await (await messageChannel(client, threadId)).send(copy);
      return { messageId: posted.id };
    },
    deleteMessage: async (channelId, messageId) => {
      await (await messageChannel(client, channelId)).messages.delete(messageId);
    },
  };
}
