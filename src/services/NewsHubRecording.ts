import { GatewayDispatchEvents, type Client } from "discord.js";
import { NEWS_HUB_FEATURE_KEY } from "../config/featureGate.js";
import { NEWS_CATEGORY_THREADS, type NewsPlaces } from "../config/newsHub.js";
import { IS_TEST_MODE } from "../config/testMode.js";
import type { FeatureState } from "../functions/FeatureGate.js";
import {
  newsItemFrom,
  type INewsItemPayload,
  type INewsMessage,
} from "../functions/NewsItem.js";
import {
  buildApiErrorMessage,
  buildDiscordErrorMessage,
} from "../utilities/ApiErrorUtils.js";
import { logError } from "../utilities/LogUtils.js";
import { getFeatureState } from "./FeaturePostRouting.js";
import { apiDelete, apiPutOrThrow } from "./RpgClubApiClient.js";

// Recording (spec api#355): the bot pushes every new, edited and deleted message in the
// News Category threads to the API. It never posts in the threads.

const LOG_CONTEXT = "NewsHubRecording";
const NEWS_ITEMS_PATH = "/api/v1/news_items";

/** The PUT body: the path carries the message ID, so the body leaves it out. */
export type NewsItemRecordBody = { data: Omit<INewsItemPayload, "message_id"> };

/** The service-only News Item writes. Both are idempotent by message ID. */
export interface INewsItemApi {
  /** Creates or replaces the News Item (every field is replaced, so send it whole). */
  record: (messageId: string, body: NewsItemRecordBody) => Promise<unknown>;
  /** Removes it; 204 whether or not it was recorded. */
  remove: (messageId: string) => Promise<unknown>;
}

export interface INewsRecordingDeps {
  /** A PR preview shares the production API, so test mode sends nothing. */
  testMode: boolean;
  /** The category threads, each with its News Category. */
  places: NewsPlaces;
  /** The News Hub's state. Only Off stops recording; null (unreadable) records. */
  featureState: () => Promise<FeatureState | null>;
  api: INewsItemApi;
}

const newsItemPath = (messageId: string): string =>
  `${NEWS_ITEMS_PATH}/${encodeURIComponent(messageId)}`;

export const NEWS_ITEM_API: INewsItemApi = {
  record: (messageId, body) => apiPutOrThrow(newsItemPath(messageId), body),
  remove: (messageId) => apiDelete(newsItemPath(messageId)),
};

export const DEFAULT_NEWS_RECORDING_DEPS: INewsRecordingDeps = {
  testMode: IS_TEST_MODE,
  places: NEWS_CATEGORY_THREADS,
  featureState: () => getFeatureState(NEWS_HUB_FEATURE_KEY),
  api: NEWS_ITEM_API,
};

/** The PUT body for a News Item, for any caller that records one. */
export function newsItemRecordBody(item: INewsItemPayload): NewsItemRecordBody {
  const { message_id: _id, ...data } = item;
  return { data };
}

async function send(label: string, request: () => Promise<unknown>): Promise<void> {
  try {
    await request();
  } catch (error: unknown) {
    logError(LOG_CONTEXT, buildApiErrorMessage(label, error));
  }
}

/** Whether a change in this channel is recorded now: a category thread, not test mode, not Off. */
async function isRecording(channelId: string, deps: INewsRecordingDeps): Promise<boolean> {
  if (deps.testMode || !deps.places.has(channelId)) return false;
  return (await deps.featureState()) !== "off";
}

async function record(item: INewsItemPayload, deps: INewsRecordingDeps): Promise<void> {
  await send(
    `Could not record News Item ${item.message_id}`,
    () => deps.api.record(item.message_id, newsItemRecordBody(item)),
  );
}

/**
 * messageCreate: records the message if it is a News Item. Event handlers have no caller
 * to report to, so a failure is logged with the full request and response, never thrown.
 */
export async function onNewsMessageCreated(
  message: INewsMessage,
  deps: INewsRecordingDeps = DEFAULT_NEWS_RECORDING_DEPS,
): Promise<void> {
  if (!(await isRecording(message.channelId, deps))) return;
  const item = newsItemFrom(message, deps.places);
  if (item) await record(item, deps);
}

async function recordOrRemove(message: INewsMessage, deps: INewsRecordingDeps): Promise<void> {
  const item = newsItemFrom(message, deps.places);
  if (item) {
    await record(item, deps);
    return;
  }
  await send(
    `Could not remove News Item ${message.id} after an edit`,
    () => deps.api.remove(message.id),
  );
}

/**
 * messageUpdate: records the message again on every edit, including Discord adding the
 * link's preview (which leaves the text alone), or removes the News Item when the edit
 * leaves no link and no image.
 */
export async function onNewsMessageEdited(
  message: INewsMessage,
  deps: INewsRecordingDeps = DEFAULT_NEWS_RECORDING_DEPS,
): Promise<void> {
  if (!(await isRecording(message.channelId, deps))) return;
  await recordOrRemove(message, deps);
}

/** messageDelete and messageDeleteBulk: removes the deleted messages' News Items by ID. */
export async function onNewsMessagesDeleted(
  channelId: string,
  messageIds: readonly string[],
  deps: INewsRecordingDeps = DEFAULT_NEWS_RECORDING_DEPS,
): Promise<void> {
  if (!(await isRecording(channelId, deps))) return;
  for (const messageId of messageIds) {
    await send(
      `Could not remove News Item ${messageId} for a deleted message`,
      () => deps.api.remove(messageId),
    );
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
  let message: INewsMessage | null = null;
  try {
    const channel = await client.channels.fetch(packet.channel_id);
    if (channel?.isTextBased()) message = await channel.messages.fetch(packet.id);
  } catch (error: unknown) {
    const label = `Could not fetch edited message ${packet.id} in News thread ${packet.channel_id}`;
    logError(LOG_CONTEXT, buildDiscordErrorMessage(label, error));
    return;
  }
  if (message) await recordOrRemove(message, deps);
}

/**
 * discord.js drops edits and deletes in a thread it has not cached (an archived thread
 * after a restart): it cannot build the thread from the packet. `client.ws` emits each
 * dispatch before discord.js handles it, so a packet for an uncached category thread is
 * handled here and one for a cached thread is left to the message events.
 */
export function registerUncachedNewsListeners(
  client: Client,
  deps: INewsRecordingDeps = DEFAULT_NEWS_RECORDING_DEPS,
): void {
  const isUncachedNewsThread = (channelId: string): boolean =>
    deps.places.has(channelId) && !client.channels.cache.has(channelId);

  client.ws.on(GatewayDispatchEvents.MessageUpdate, (packet: MessagePacket) => {
    if (isUncachedNewsThread(packet.channel_id)) void onUncachedEdit(client, packet, deps);
  });
  client.ws.on(GatewayDispatchEvents.MessageDelete, (packet: MessagePacket) => {
    if (!isUncachedNewsThread(packet.channel_id)) return;
    void onNewsMessagesDeleted(packet.channel_id, [packet.id], deps);
  });
  client.ws.on(GatewayDispatchEvents.MessageDeleteBulk, (packet: BulkDeletePacket) => {
    if (!isUncachedNewsThread(packet.channel_id)) return;
    void onNewsMessagesDeleted(packet.channel_id, packet.ids, deps);
  });
}
