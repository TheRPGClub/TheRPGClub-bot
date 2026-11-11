import { Events, GatewayDispatchEvents, type Client } from "discord.js";
import { NEWS_HUB_FEATURE_KEY } from "../config/featureGate.js";
import {
  NEWS_CATEGORY_THREADS,
  NEWS_CHANNEL_PLACES,
  NEWS_PREVIEW_WAIT_MS,
  type NewsPlaces,
} from "../config/newsHub.js";
import { IS_TEST_MODE } from "../config/testMode.js";
import type { FeatureState } from "../functions/FeatureGate.js";
import { pickNewsCategory } from "../functions/NewsCategoryPicker.js";
import { newsItemFrom } from "../functions/NewsItem.js";
import { buildDiscordErrorMessage } from "../utilities/ApiErrorUtils.js";
import { logError } from "../utilities/LogUtils.js";
import { getFeatureState } from "./FeaturePostRouting.js";
import {
  discordNewsCopier,
  fileNewsItem,
  newsCopySourceOf,
  type INewsFilingOutcome,
  type INewsPost,
} from "./NewsCopying.js";
import {
  discordNewsCopyEditor,
  removeNewsItem,
  syncEditedNewsMessage,
  type INewsSyncDeps,
} from "./NewsCopySync.js";
import { NEWS_COPY_LANE } from "./NewsCopyLane.js";
import { NEWS_ITEM_API } from "./NewsItemApi.js";

// Recording (spec api#367): members share news in the News Channel. A new post is filed:
// its category picked, recorded, reacted to and copied into the category's thread. Edits
// and deletes reach the API and the News Copy (NewsCopySync). Only the bot posts in the
// category threads.

const LOG_CONTEXT = "NewsHubRecording";

export interface INewsRecordingDeps extends INewsSyncDeps {
  /** A PR preview shares the production API, so test mode sends nothing. */
  testMode: boolean;
  /** The News Channel, whose messages have no category until the bot picks one. */
  places: NewsPlaces;
  /** The News Hub's state. Only Off stops recording; null (unreadable) records. */
  featureState: () => Promise<FeatureState | null>;
  /**
   * The message once Discord has added a link preview, or as it is when none came within
   * {@link NEWS_PREVIEW_WAIT_MS}.
   */
  waitForPreview: (message: INewsPost) => Promise<INewsPost>;
  /**
   * Messages being filed now, each with its latest edit made meanwhile (null for none).
   * The filing records that edit once it ends; an edit during the preview wait (Discord
   * adding the preview) is already in what it files. A delete takes the message out, which
   * stops the filing after the preview wait, or removes the item and its copy once filed.
   */
  filing: Map<string, INewsPost | null>;
}

/** Messages being filed, shared by every handler of this bot's client. */
const FILING = new Map<string, INewsPost | null>();

/**
 * Waits for the messageUpdate that gives `message` a link preview. discord.js patches the
 * cached message in place, so a preview that came before the listener is seen at once.
 */
function previewWaiter(client: Client): (message: INewsPost) => Promise<INewsPost> {
  return (message) => new Promise((resolve) => {
    const done = (result: INewsPost): void => {
      clearTimeout(timer);
      client.off(Events.MessageUpdate, onUpdate);
      resolve(result);
    };
    const onUpdate = (_old: unknown, updated: INewsPost): void => {
      if (updated.id === message.id && updated.embeds.length > 0) done(updated);
    };
    const timer = setTimeout(() => done(message), NEWS_PREVIEW_WAIT_MS);
    client.on(Events.MessageUpdate, onUpdate);
    if (message.embeds.length > 0) done(message);
  });
}

/** The recording's real dependencies for this bot's client. */
export function createNewsRecordingDeps(client: Client): INewsRecordingDeps {
  return {
    testMode: IS_TEST_MODE,
    places: NEWS_CHANNEL_PLACES,
    threads: NEWS_CATEGORY_THREADS,
    featureState: () => getFeatureState(NEWS_HUB_FEATURE_KEY),
    api: NEWS_ITEM_API,
    discord: { ...discordNewsCopier(client), ...discordNewsCopyEditor(client) },
    waitForPreview: previewWaiter(client),
    filing: FILING,
    copyWaits: () => NEWS_COPY_LANE.copyWaits(),
  };
}

/** Whether a change in this channel is recorded now: the News Channel, not test mode, not Off. */
async function isRecording(channelId: string, deps: INewsRecordingDeps): Promise<boolean> {
  if (deps.testMode || !deps.places.has(channelId)) return false;
  return (await deps.featureState()) !== "off";
}

/** A link Discord has not previewed yet: worth waiting for, since the picker reads it. */
function awaitsPreview(message: INewsPost, linked: boolean): boolean {
  return linked && message.embeds.length === 0;
}

/**
 * Files a News Channel message that is a News Item: waits for the link preview when there
 * is none yet, picks the category, then records, reacts, copies and reports the copy
 * (see {@link fileNewsItem}). Null when the message is not a News Item, or was deleted
 * while waiting. Does not check the Feature or test mode; the caller does. `postCopy: false`
 * files it without its News Copy (catch-up copies afterwards).
 */
export async function fileNewsMessage(
  message: INewsPost,
  deps: INewsRecordingDeps,
  options: { postCopy?: boolean } = {},
): Promise<INewsFilingOutcome | null> {
  let post = message;
  let item = newsItemFrom(post, deps.places);
  if (!item) return null;
  deps.filing.set(post.id, null);
  let outcome: INewsFilingOutcome | null = null;
  try {
    if (awaitsPreview(post, item.link !== null)) {
      post = await deps.waitForPreview(post);
      if (!deps.filing.has(post.id)) return null;
      deps.filing.set(post.id, null);
      item = newsItemFrom(post, deps.places);
      if (!item) return null;
    }
    const categoryKey = pickNewsCategory(item);
    outcome = await fileNewsItem({
      item,
      categoryKey,
      pickedCategoryKey: categoryKey,
      copy: newsCopySourceOf(post, item),
      react: true,
      postCopy: options.postCopy,
    }, deps);
    return outcome;
  } finally {
    const deleted = !deps.filing.has(message.id);
    const edited = deps.filing.get(message.id) ?? null;
    deps.filing.delete(message.id);
    if (outcome?.recorded && deleted) {
      await removeNewsItem(message.id, "for a deleted message", deps);
    } else if (outcome?.recorded && edited) {
      await recordOrRemove(edited, deps);
    }
  }
}

/**
 * messageCreate: files the message if it is a News Item in the News Channel. Event handlers
 * have no caller to report to, so a failure is logged with the full request and response.
 */
export async function onNewsMessageCreated(
  message: INewsPost,
  deps: INewsRecordingDeps,
): Promise<void> {
  if (!(await isRecording(message.channelId, deps))) return;
  await fileNewsMessage(message, deps);
}

/**
 * Records an edited message again, or removes its News Item when it is no longer one. A
 * bot's message is never a member's News Item and is left alone: the bot's own `/news share`
 * post is recorded by the command, and the edit that adds its link preview must not remove it.
 */
async function recordOrRemove(message: INewsPost, deps: INewsRecordingDeps): Promise<void> {
  if (message.author.bot) return;
  if (deps.filing.has(message.id)) {
    deps.filing.set(message.id, message);
    return;
  }
  await syncEditedNewsMessage(message, deps);
}

/**
 * messageUpdate: records the message again on every edit, including Discord adding the
 * link's preview after the filing stopped waiting, and edits its News Copy to match; or
 * removes the News Item and its copy when the edit leaves no link and no image. The
 * category is not sent, so the stored one is kept. A message never recorded is left alone.
 */
export async function onNewsMessageEdited(
  message: INewsPost,
  deps: INewsRecordingDeps,
): Promise<void> {
  if (!(await isRecording(message.channelId, deps))) return;
  await recordOrRemove(message, deps);
}

/**
 * messageDelete and messageDeleteBulk: removes the deleted messages' News Items and deletes
 * their News Copies. A message still being filed is left to its filing, which stops or
 * removes what it filed.
 */
export async function onNewsMessagesDeleted(
  channelId: string,
  messageIds: readonly string[],
  deps: INewsRecordingDeps,
): Promise<void> {
  if (!(await isRecording(channelId, deps))) return;
  for (const messageId of messageIds) {
    if (deps.filing.delete(messageId)) continue;
    await removeNewsItem(messageId, "for a deleted message", deps);
  }
}

type MessagePacket = { id: string; channel_id: string };
type BulkDeletePacket = { ids: string[]; channel_id: string };

/** An edit discord.js dropped: the message is fetched, then recorded or removed. */
async function onUncachedEdit(
  client: Client,
  packet: MessagePacket,
  deps: INewsRecordingDeps,
): Promise<void> {
  if (!(await isRecording(packet.channel_id, deps))) return;
  let message: INewsPost | null = null;
  try {
    const channel = await client.channels.fetch(packet.channel_id);
    if (channel?.isTextBased()) message = await channel.messages.fetch(packet.id);
  } catch (error: unknown) {
    const label = `Could not fetch edited message ${packet.id} in the News Channel ` +
      packet.channel_id;
    logError(LOG_CONTEXT, buildDiscordErrorMessage(label, error));
    return;
  }
  if (message) await recordOrRemove(message, deps);
}

/**
 * discord.js drops edits and deletes in a channel it has not cached: it cannot build the
 * channel from the packet. `client.ws` emits each dispatch before discord.js handles it, so
 * a packet for an uncached News Channel is handled here and one for a cached channel is left
 * to the message events.
 */
export function registerUncachedNewsListeners(
  client: Client,
  deps: INewsRecordingDeps = createNewsRecordingDeps(client),
): void {
  const isUncachedNewsChannel = (channelId: string): boolean =>
    deps.places.has(channelId) && !client.channels.cache.has(channelId);

  client.ws.on(GatewayDispatchEvents.MessageUpdate, (packet: MessagePacket) => {
    if (isUncachedNewsChannel(packet.channel_id)) void onUncachedEdit(client, packet, deps);
  });
  client.ws.on(GatewayDispatchEvents.MessageDelete, (packet: MessagePacket) => {
    if (!isUncachedNewsChannel(packet.channel_id)) return;
    void onNewsMessagesDeleted(packet.channel_id, [packet.id], deps);
  });
  client.ws.on(GatewayDispatchEvents.MessageDeleteBulk, (packet: BulkDeletePacket) => {
    if (!isUncachedNewsChannel(packet.channel_id)) return;
    void onNewsMessagesDeleted(packet.channel_id, packet.ids, deps);
  });
}
