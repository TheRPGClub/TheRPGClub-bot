import { userMention } from "discord.js";
import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";
import { formatTimestampWithDay } from "../utilities/DiscordLogUtils.js";
import { BAN_LOG_CHANNEL_ID, UNBAN_LOG_CHANNEL_ID } from "../config/channels.js";
import { buildIdTimestampFooter } from "../functions/InteractionUtils.js";
import { toUnixTimestamp } from "../functions/DateFormatUtils.js";
import { COLOR_INFO, COLOR_ERROR } from "../config/colors.js";
import {
  buildTitledContainer,
  buildContainerSend,
  buildFieldsText,
} from "../functions/ComponentsV2Utils.js";

async function resolveLogChannel(client: Client, channelId: string): Promise<any | null> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return null;
  const sendable = channel as any;
  return typeof sendable.send === "function" ? sendable : null;
}

function formatAccountCreated(date: Date): string {
  return `<t:${toUnixTimestamp(date)}:F>`;
}

function buildBanContainer(
  title: string,
  userId: string,
  username: string,
  createdAt: Date,
  color: number,
) {
  const body = buildFieldsText([
    { name: "User", value: `${userMention(userId)}\n${username}` },
    { name: "Account Created On", value: formatAccountCreated(createdAt) },
  ]);
  return buildTitledContainer(title, body, {
    color,
    footer: buildIdTimestampFooter(userId, formatTimestampWithDay(Date.now())),
  });
}

@Discord()
export class GuildBanLog {
  @On()
  async guildBanAdd([ban]: ArgsOf<"guildBanAdd">, client: Client): Promise<void> {
    const user = ban.user;
    if (!user || user.bot) return;

    const logChannel = await resolveLogChannel(client, BAN_LOG_CHANNEL_ID);
    if (!logChannel) return;

    const username = user.tag ?? user.username ?? user.id;
    const container = buildBanContainer(
      "User Banned",
      user.id,
      username,
      user.createdAt ?? new Date(),
      COLOR_ERROR,
    );

    await (logChannel as any).send({ ...buildContainerSend(container) });
  }

  @On()
  async guildBanRemove([ban]: ArgsOf<"guildBanRemove">, client: Client): Promise<void> {
    const user = ban.user;
    if (!user || user.bot) return;

    const logChannel = await resolveLogChannel(client, UNBAN_LOG_CHANNEL_ID);
    if (!logChannel) return;

    const username = user.tag ?? user.username ?? user.id;
    const container = buildBanContainer(
      "User Unbanned",
      user.id,
      username,
      user.createdAt ?? new Date(),
      COLOR_INFO,
    );

    await (logChannel as any).send({ ...buildContainerSend(container) });
  }
}
