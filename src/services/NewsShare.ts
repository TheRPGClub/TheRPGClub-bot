import type { Client } from "discord.js";
import {
  NEWS_CATEGORY_NAMES,
  NEWS_CATEGORY_THREADS,
  type NewsCategoryKey,
} from "../config/newsHub.js";
import { GAME_NEWS_CHANNEL_ID } from "../config/channels.js";
import { IS_TEST_MODE } from "../config/testMode.js";
import { pickNewsCategory } from "../functions/NewsCategoryPicker.js";
import {
  isImageAttachment,
  isWebAddress,
  sharedNewsItemFrom,
  type INewsShareOrigin,
} from "../functions/NewsItem.js";
import { sharedStateCommandRefusal } from "../functions/SharedStateCommandGuard.js";
import {
  buildApiErrorMessage,
  buildDiscordErrorMessage,
} from "../utilities/ApiErrorUtils.js";
import { logError } from "../utilities/LogUtils.js";
import {
  fileNewsItem,
  newsCopySourceOf,
  type INewsCopyDeps,
  type INewsPost,
} from "./NewsCopying.js";
import { createNewsRecordingDeps, type INewsRecordingDeps } from "./NewsHubRecording.js";
import type { INewsFilingApi } from "./NewsItemApi.js";

// `/news share` (spec api#367): a member shares news through the bot, choosing its category
// or leaving it to the picker. The bot posts it in the News Channel crediting the member,
// then files it like a member's post: records it as the member's, reacts and copies it.
// The News Channel listener ignores the bot's own messages, so only this records the post.

const LOG_CONTEXT = "NewsShare";

export const NEWS_COMMAND = "news";
export const NEWS_SHARE_SUBCOMMAND = "share";

/** The image a member attached to `/news share`. */
export interface INewsShareImage {
  url: string;
  name: string;
  contentType: string | null;
}

/** What a member shares: the command's options, and who they are. */
export interface INewsShare extends INewsShareOrigin {
  /** The category the member chose, or null for the bot to pick. */
  categoryKey: NewsCategoryKey | null;
  image: INewsShareImage | null;
}

/** The bot's post in the News Channel, as discord.js message options for `channel.send`. */
export interface INewsShareMessage {
  content: string;
  files: { attachment: string; name: string }[];
  allowedMentions: { parse: [] };
}

export interface INewsShareDeps extends INewsCopyDeps {
  /** A PR preview shares the production API, so test mode refuses the command. */
  testMode: boolean;
  newsChannelId: string;
  /** Posts the share in the News Channel; the posted message. */
  postShare: (channelId: string, message: INewsShareMessage) => Promise<INewsPost>;
  waitForPreview: INewsRecordingDeps["waitForPreview"];
  /** Messages being filed, shared with the listener: a delete takes the post out. */
  filing: INewsRecordingDeps["filing"];
}

/** The private reply; `failed` replies are shown as errors. */
export interface INewsShareReply {
  text: string;
  failed: boolean;
}

const COMMAND_LABEL = `/${NEWS_COMMAND} ${NEWS_SHARE_SUBCOMMAND}`;

/** The post crediting the member (no ping), with their comment, the link and the image. */
export function buildNewsShare(share: INewsShare): INewsShareMessage {
  const lines = [`<@${share.sharer.id}> shared`, share.comment, share.link]
    .filter((line): line is string => line !== null);
  return {
    content: lines.join("\n"),
    files: share.image ? [{ attachment: share.image.url, name: share.image.name }] : [],
    allowedMentions: { parse: [] },
  };
}

/** Why the share cannot go out as given, or null when it can. */
function shareRefusal(share: INewsShare, testMode: boolean): string | null {
  const testRefusal = sharedStateCommandRefusal(COMMAND_LABEL, testMode);
  if (testRefusal) return testRefusal;
  if (/\s/.test(share.link) || !isWebAddress(share.link)) {
    return "The link must be a web address starting with http:// or https://.";
  }
  if (share.image && !isImageAttachment(share.image)) {
    return "The attachment must be an image (PNG, JPEG, GIF, WebP and the like).";
  }
  return null;
}

/** The filing API, keeping the error a failed record throws so the reply can show it. */
function recordErrorKeeper(api: INewsFilingApi): {
  api: INewsFilingApi;
  error: () => unknown;
} {
  let recordError: unknown = null;
  return {
    api: {
      ...api,
      record: async (messageId, body) => {
        try {
          return await api.record(messageId, body);
        } catch (error: unknown) {
          recordError = error;
          throw error;
        }
      },
    },
    error: () => recordError,
  };
}

function confirmation(
  post: INewsPost,
  categoryKey: NewsCategoryKey,
  picked: boolean,
  copied: boolean,
): string {
  const how = picked ? "The bot filed it under" : "Filed under";
  const lines = [
    `Shared in the News Channel: ${post.url}`,
    `${how} **${NEWS_CATEGORY_NAMES[categoryKey]}**.`,
  ];
  if (!copied) {
    lines.push("Its copy in the category thread could not be posted yet; it will be retried.");
  }
  return lines.join("\n");
}

/**
 * `/news share`: posts the member's news in the News Channel, waits for Discord's link
 * preview, picks the category when the member chose none, then records it as the member's,
 * reacts and copies it (see {@link fileNewsItem}). Returns the private reply. Every failure
 * is answered with its full request and response; a post that cannot be recorded is
 * deleted again, since nothing else would record a message the bot posted.
 */
export async function shareNewsReply(
  share: INewsShare,
  deps: INewsShareDeps,
): Promise<INewsShareReply> {
  const refusal = shareRefusal(share, deps.testMode);
  if (refusal) return { text: refusal, failed: true };

  let post: INewsPost;
  try {
    post = await deps.postShare(deps.newsChannelId, buildNewsShare(share));
  } catch (error: unknown) {
    const label = "Could not post your news in the News Channel";
    return { text: buildDiscordErrorMessage(label, error), failed: true };
  }

  deps.filing.set(post.id, null);
  try {
    post = await deps.waitForPreview(post);
    if (!deps.filing.has(post.id)) {
      return { text: "Your news was deleted before it could be filed.", failed: true };
    }
    const item = sharedNewsItemFrom(post, share);
    const categoryKey = share.categoryKey ?? pickNewsCategory(item);
    const keeper = recordErrorKeeper(deps.api);
    const outcome = await fileNewsItem({
      item,
      categoryKey,
      pickedCategoryKey: share.categoryKey ? null : categoryKey,
      copy: newsCopySourceOf(post, item),
      react: true,
    }, { ...deps, api: keeper.api });
    if (!outcome.recorded) {
      await deleteUnrecorded(post, deps);
      const label = "Could not record your news, so its post was removed again";
      return { text: buildApiErrorMessage(label, keeper.error()), failed: true };
    }
    return {
      text: confirmation(post, categoryKey, share.categoryKey === null, outcome.copy !== null),
      failed: false,
    };
  } finally {
    deps.filing.delete(post.id);
  }
}

async function deleteUnrecorded(post: INewsPost, deps: INewsShareDeps): Promise<void> {
  try {
    await deps.discord.deleteMessage(post.channelId, post.id);
  } catch (error: unknown) {
    const label = `Could not delete the unrecorded /news share post ${post.id}`;
    logError(LOG_CONTEXT, buildDiscordErrorMessage(label, error));
  }
}

/** The share's real dependencies for this bot's client. */
export function createNewsShareDeps(client: Client): INewsShareDeps {
  const recording = createNewsRecordingDeps(client);
  return {
    testMode: IS_TEST_MODE,
    newsChannelId: GAME_NEWS_CHANNEL_ID,
    threads: NEWS_CATEGORY_THREADS,
    api: recording.api,
    discord: recording.discord,
    waitForPreview: recording.waitForPreview,
    filing: recording.filing,
    postShare: async (channelId, message) => {
      const channel = await client.channels.fetch(channelId);
      if (!channel?.isSendable()) {
        throw new Error(`Channel ${channelId} is missing or the bot cannot post in it.`);
      }
      return channel.send(message);
    },
  };
}
