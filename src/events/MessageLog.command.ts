import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";
import { formatTimestampWithDay, resolveLogChannel } from "../utilities/DiscordLogUtils.js";
import { COLOR_INFO, COLOR_ERROR } from "../config/colors.js";
import { truncateWithEllipsis } from "../utilities/ValidationUtils.js";
import { buildDeletedMessageLog, MAX_FIELD_LENGTH } from "../utilities/MessageLogUtils.js";
import {
  buildContainerSend,
  buildMaskedLink,
  buildTitledContainer,
} from "../functions/ComponentsV2Utils.js";

const MAX_DESCRIPTION_LENGTH = 3500;

function truncate(text: string, maxLength = MAX_FIELD_LENGTH): string {
  return truncateWithEllipsis(text, maxLength);
}

@Discord()
export class MessageLog {
  @On()
  async messageDelete([message]: ArgsOf<"messageDelete">, client: Client): Promise<void> {
    const entry = buildDeletedMessageLog(message);
    if (!entry) return;

    const logChannel = await resolveLogChannel(client);
    if (!logChannel) return;

    const container = buildTitledContainer(entry.title, entry.body, {
      color: COLOR_ERROR,
      footer: entry.footer,
    });

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
