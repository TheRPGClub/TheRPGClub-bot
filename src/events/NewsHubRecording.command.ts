import type { ArgsOf } from "discordx";
import { Discord, On } from "discordx";
import { NEWS_CHANNEL_PLACES } from "../config/newsHub.js";
import {
  createNewsRecordingDeps,
  onNewsMessageCreated,
  onNewsMessageEdited,
  onNewsMessagesDeleted,
} from "../services/NewsHubRecording.js";

/**
 * Files News Items from the News Channel (spec api#367). Edits and deletes discord.js
 * dropped for an uncached channel arrive through `registerUncachedNewsListeners`.
 */
@Discord()
export class NewsHubRecordingEvents {
  @On({ event: "messageCreate" })
  async recordNewsMessage([message]: ArgsOf<"messageCreate">): Promise<void> {
    if (!NEWS_CHANNEL_PLACES.has(message.channelId)) return;
    await onNewsMessageCreated(message, createNewsRecordingDeps(message.client));
  }

  @On({ event: "messageUpdate" })
  async recordEditedNewsMessage([, newMessage]: ArgsOf<"messageUpdate">): Promise<void> {
    if (!NEWS_CHANNEL_PLACES.has(newMessage.channelId)) return;
    // An uncached message arrives partial; a failed fetch means it was deleted meanwhile,
    // and its delete event removes the News Item.
    const message = newMessage.partial
      ? await newMessage.fetch().catch(() => null)
      : newMessage;
    if (message) await onNewsMessageEdited(message, createNewsRecordingDeps(message.client));
  }

  @On({ event: "messageDelete" })
  async removeDeletedNewsMessage([message]: ArgsOf<"messageDelete">): Promise<void> {
    if (!NEWS_CHANNEL_PLACES.has(message.channelId)) return;
    await onNewsMessagesDeleted(
      message.channelId,
      [message.id],
      createNewsRecordingDeps(message.client),
    );
  }

  @On({ event: "messageDeleteBulk" })
  async removeBulkDeletedNewsMessages(
    [messages, channel]: ArgsOf<"messageDeleteBulk">,
  ): Promise<void> {
    if (!NEWS_CHANNEL_PLACES.has(channel.id)) return;
    await onNewsMessagesDeleted(
      channel.id,
      [...messages.keys()],
      createNewsRecordingDeps(channel.client),
    );
  }
}
