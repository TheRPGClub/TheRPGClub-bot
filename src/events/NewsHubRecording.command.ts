import type { ArgsOf } from "discordx";
import { Discord, On } from "discordx";
import { NEWS_CATEGORY_THREADS } from "../config/newsHub.js";
import {
  onNewsMessageCreated,
  onNewsMessageEdited,
  onNewsMessagesDeleted,
} from "../services/NewsHubRecording.js";

/**
 * Records News Items from the News Category threads (spec api#355). Edits and deletes in
 * threads discord.js has not cached arrive through `registerUncachedNewsListeners`.
 */
@Discord()
export class NewsHubRecordingEvents {
  @On({ event: "messageCreate" })
  async recordNewsMessage([message]: ArgsOf<"messageCreate">): Promise<void> {
    await onNewsMessageCreated(message);
  }

  @On({ event: "messageUpdate" })
  async recordEditedNewsMessage([, newMessage]: ArgsOf<"messageUpdate">): Promise<void> {
    if (!NEWS_CATEGORY_THREADS.has(newMessage.channelId)) return;
    // An uncached message arrives partial; a failed fetch means it was deleted meanwhile,
    // and its delete event removes the News Item.
    const message = newMessage.partial
      ? await newMessage.fetch().catch(() => null)
      : newMessage;
    if (message) await onNewsMessageEdited(message);
  }

  @On({ event: "messageDelete" })
  async removeDeletedNewsMessage([message]: ArgsOf<"messageDelete">): Promise<void> {
    await onNewsMessagesDeleted(message.channelId, [message.id]);
  }

  @On({ event: "messageDeleteBulk" })
  async removeBulkDeletedNewsMessages(
    [messages, channel]: ArgsOf<"messageDeleteBulk">,
  ): Promise<void> {
    await onNewsMessagesDeleted(channel.id, [...messages.keys()]);
  }
}
