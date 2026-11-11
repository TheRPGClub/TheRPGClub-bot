import axios from "axios";
import { RESTJSONErrorCodes, type Client } from "discord.js";
import type { NewsPlaces } from "../config/newsHub.js";
import { buildNewsCopy, type INewsCopyMessage } from "../functions/NewsCopy.js";
import { newsItemFrom } from "../functions/NewsItem.js";
import {
  buildApiErrorMessage,
  buildDiscordErrorMessage,
} from "../utilities/ApiErrorUtils.js";
import { logError } from "../utilities/LogUtils.js";
import {
  fetchNewsChannel,
  newsCopySourceOf,
  type INewsCopyDeps,
  type INewsCopyDiscord,
  type INewsPost,
} from "./NewsCopying.js";
import {
  newsItemRecordBody,
  recordedNewsItemOf,
  type INewsCopyLocation,
  type INewsItemApi,
  type INewsSyncApi,
} from "./NewsItemApi.js";

// Keeping a News Copy in sync (spec api#367): an edit of the original updates the News Item
// and edits its News Copy; an edit leaving no link and no image, or a delete, removes the
// News Item and deletes its copy. A copy that was never posted or is already gone is not an
// error. Nothing is thrown: every failure is logged with the full request and response.

const LOG_CONTEXT = "NewsCopySync";

/** Discord writes for filing, plus editing a News Copy in place. */
export interface INewsSyncDiscord extends INewsCopyDiscord {
  /** Replaces a News Copy's text and images with `copy`. */
  editCopy: (threadId: string, messageId: string, copy: INewsCopyMessage) => Promise<void>;
}

export interface INewsSyncDeps extends INewsCopyDeps {
  /** The News Channel, whose messages are News Items. */
  places: NewsPlaces;
  api: INewsSyncApi;
  discord: INewsSyncDiscord;
}

function discordErrorCode(error: unknown): number | undefined {
  const failure = error as { code?: unknown; rawError?: { code?: unknown } } | null;
  const code = failure?.rawError?.code ?? failure?.code;
  return typeof code === "number" ? code : undefined;
}

/** Discord's answer for a message that is not there: the copy is already gone. */
function isUnknownMessage(error: unknown): boolean {
  return discordErrorCode(error) === RESTJSONErrorCodes.UnknownMessage;
}

/** Discord's answer for a message, or the channel it was in, that is not there. */
export function isGone(error: unknown): boolean {
  return isUnknownMessage(error) ||
    discordErrorCode(error) === RESTJSONErrorCodes.UnknownChannel;
}

/**
 * Whether the API refused to record an edit because the message was never recorded (posted
 * while the News Hub was Off, say): a new live News Item needs a category an edit does not
 * send. Catch-up records missed posts, so such an edit is left alone.
 */
async function wasNeverRecorded(
  messageId: string,
  error: unknown,
  deps: INewsSyncDeps,
): Promise<boolean> {
  if (!axios.isAxiosError(error) || error.response?.status !== 422) return false;
  try {
    return (await deps.api.find(messageId)) === null;
  } catch {
    return false;
  }
}

/**
 * Records an edited News Channel message again and edits its News Copy to match. The
 * category is not sent, so the stored one (maybe a correction) is kept. Discord adding a
 * preview leaves `editedAt` unset and changes nothing the copy shows, so only a member's
 * edit touches the copy. An edit leaving no link and no image removes the item and copy.
 */
export async function syncEditedNewsMessage(
  message: INewsPost,
  deps: INewsSyncDeps,
): Promise<void> {
  const item = newsItemFrom(message, deps.places);
  if (!item) {
    await removeNewsItem(message.id, "after an edit", deps);
    return;
  }
  let response: unknown;
  try {
    response = await deps.api.record(item.message_id, newsItemRecordBody(item));
  } catch (error: unknown) {
    if (await wasNeverRecorded(item.message_id, error, deps)) return;
    logError(LOG_CONTEXT, buildApiErrorMessage(
      `Could not record News Item ${item.message_id} after an edit`,
      error,
    ));
    return;
  }
  const recorded = recordedNewsItemOf(response);
  const copy = recorded?.news_copy ?? null;
  if (!recorded || !copy || message.editedAt === null) return;
  const postedAt = recorded.origin === "import" ? new Date(recorded.posted_at) : null;
  try {
    await deps.discord.editCopy(
      copy.thread_id,
      copy.message_id,
      buildNewsCopy(newsCopySourceOf(message, item, postedAt)),
    );
  } catch (error: unknown) {
    if (isUnknownMessage(error)) return;
    const label = `Could not edit the News Copy ${copy.message_id} of News Item ` +
      `${item.message_id} in thread ${copy.thread_id}`;
    logError(LOG_CONTEXT, buildDiscordErrorMessage(label, error));
  }
}

/**
 * Deletes the News Copy at `location` of News Item `messageId`, which is gone or no longer
 * news. A copy already gone is not an error; any other failure is logged.
 */
export async function deleteNewsCopy(
  messageId: string,
  location: INewsCopyLocation,
  discord: Pick<INewsCopyDiscord, "deleteMessage">,
): Promise<void> {
  try {
    await discord.deleteMessage(location.thread_id, location.message_id);
  } catch (error: unknown) {
    if (isUnknownMessage(error)) return;
    const label = `Could not delete the News Copy ${location.message_id} of removed News ` +
      `Item ${messageId} in thread ${location.thread_id}`;
    logError(LOG_CONTEXT, buildDiscordErrorMessage(label, error));
  }
}

/**
 * Removes the News Item of `messageId` and deletes its News Copy, where the removal says it
 * lived. An item the API keeps keeps its copy too.
 */
export async function removeNewsItem(
  messageId: string,
  why: "after an edit" | "for a deleted message",
  deps: { api: INewsItemApi; discord: Pick<INewsCopyDiscord, "deleteMessage"> },
): Promise<void> {
  let location: INewsCopyLocation | null;
  try {
    location = (await deps.api.remove(messageId)).newsCopy;
  } catch (error: unknown) {
    logError(LOG_CONTEXT, buildApiErrorMessage(
      `Could not remove News Item ${messageId} ${why}`,
      error,
    ));
    return;
  }
  if (location) await deleteNewsCopy(messageId, location, deps.discord);
}

/** The real News Copy edit, through the bot's client. */
export function discordNewsCopyEditor(client: Client): Pick<INewsSyncDiscord, "editCopy"> {
  return {
    editCopy: async (threadId, messageId, copy) => {
      const thread = await fetchNewsChannel(client, threadId);
      // The copy's files replace the old ones: discord.js sends them as the only attachments.
      await thread.messages.edit(messageId, copy);
    },
  };
}
