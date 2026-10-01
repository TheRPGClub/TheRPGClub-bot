import { channelMention } from "discord.js";
import type { Message, PartialMessage } from "discord.js";
import { DISCORD_LOG_CHANNEL_ID } from "../config/channels.js";
import { truncateWithEllipsis } from "./ValidationUtils.js";

export const MAX_FIELD_LENGTH = 1000;

export const UNCACHED_DELETE_BODY =
  "Content unavailable: the message was not cached before it was deleted.";

export type DeletedMessageLog = {
  title: string;
  body: string;
  footer: string;
};

export function formatMessageContent(message: Message): string {
  const content = message.cleanContent?.trim() ?? message.content?.trim() ?? "";
  if (content) return content;
  if (message.attachments.size) {
    const urls = [...message.attachments.values()].map((attachment) => attachment.url);
    return urls.length ? `Attachments:\n${urls.join("\n")}` : "Attachments only.";
  }
  return "No text content.";
}

function formatTimestamp(timestamp: number | null | undefined): string {
  const unixSeconds = Math.floor((timestamp ?? Date.now()) / 1000);
  return `<t:${unixSeconds}:F>`;
}

// A deleted message cannot be fetched (always 10008), so an uncached one is logged from
// what the gateway event carries: channel, message ID, and the ID's creation time.
export function buildDeletedMessageLog(
  message: Message | PartialMessage,
): DeletedMessageLog | null {
  // Deleting a log entry must not post another log entry about it.
  if (message.channelId === DISCORD_LOG_CHANNEL_ID) return null;
  const title = `Message deleted in ${channelMention(message.channelId)}`;
  const created = formatTimestamp(message.createdTimestamp);

  if (message.partial) {
    return {
      title,
      body: UNCACHED_DELETE_BODY,
      footer: `Message ID: ${message.id} • ${created}`,
    };
  }
  if (!message.author || message.author.bot) return null;
  return {
    title,
    body: truncateWithEllipsis(formatMessageContent(message), MAX_FIELD_LENGTH),
    footer: `ID: ${message.author.id} • ${created}`,
  };
}
