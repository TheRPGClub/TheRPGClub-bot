import { channelMention } from "discord.js";
import type { Message } from "discord.js";
import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";
import { formatTimestampWithDay, resolveLogChannel } from "../utilities/DiscordLogUtils.js";
import { COLOR_INFO, COLOR_ERROR } from "../config/colors.js";
import { truncateWithEllipsis } from "../utilities/ValidationUtils.js";
import {
  buildContainerSend,
  buildMaskedLink,
  buildTitledContainer,
} from "../functions/ComponentsV2Utils.js";

const MAX_FIELD_LENGTH = 1000;
const MAX_DESCRIPTION_LENGTH = 3500;

function truncate(text: string, maxLength = MAX_FIELD_LENGTH): string {
  return truncateWithEllipsis(text, maxLength);
}

function formatMessageContent(message: Message): string {
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

@Discord()
export class MessageLog {
  @On()
  async messageDelete([message]: ArgsOf<"messageDelete">, client: Client): Promise<void> {
    // A deleted message cannot be fetched, so an uncached one has nothing left to log.
    if (message.partial) return;
    const resolved = message;
    if (!resolved.author || resolved.author.bot) return;

    const logChannel = await resolveLogChannel(client);
    if (!logChannel) return;

    const deletedChannelMention = channelMention(resolved.channelId);
    const body = truncate(formatMessageContent(resolved));
    const footer = resolved.author
      ? `ID: ${resolved.author.id} • ${formatTimestamp(resolved.createdTimestamp)}`
      : undefined;
    const container = buildTitledContainer(
      `Message deleted in ${deletedChannelMention}`,
      body,
      { color: COLOR_ERROR, footer },
    );

    await logChannel.send({ ...buildContainerSend(container) });
  }

  @On()
  async messageUpdate(
    [oldMessage, newMessage]: ArgsOf<"messageUpdate">,
    client: Client,
  ): Promise<void> {
    // An uncached edit has no old content: fetching it returns the edited text, never a diff.
    if (oldMessage.partial) return;
    const resolvedNew = newMessage.partial
      ? await newMessage.fetch().catch(() => null)
      : newMessage;
    if (!resolvedNew || !resolvedNew.author || resolvedNew.author.bot) return;
    const resolvedOld = oldMessage;

    const beforeText = resolvedOld.cleanContent ?? resolvedOld.content ?? "";
    const afterText = resolvedNew.cleanContent ?? resolvedNew.content ?? "";
    if (beforeText.trim() === afterText.trim()) {
      return;
    }

    const logChannel = await resolveLogChannel(client);
    if (!logChannel) return;

    const jumpUrl = resolvedNew.guildId
      ? `https://discord.com/channels/${resolvedNew.guildId}/${resolvedNew.channelId}/${resolvedNew.id}`
      : null;
    const channelName = (resolvedNew.channel as { name?: string } | null)?.name ?? "channel";
    const channelLabel = `#${channelName}`;
    const beforeValue = truncate(beforeText || "No text content.");
    const afterValue = truncate(afterText || "No text content.");
    const linkLine = jumpUrl ? buildMaskedLink(channelLabel, jumpUrl) : "";
    const description = `**Before:** ${beforeValue}\n**+After:** ${afterValue}`;
    const footer = `ID: ${resolvedNew.id} • ${formatTimestampWithDay(resolvedNew.editedTimestamp)}`;
    const container = buildTitledContainer(
      "Message edited",
      truncate(description, MAX_DESCRIPTION_LENGTH),
      { color: COLOR_INFO, footer, detail: linkLine || undefined },
    );

    await logChannel.send({ ...buildContainerSend(container) });
  }
}
