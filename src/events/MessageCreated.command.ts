import { Role } from "discord.js";
import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";
import { GAME_DEALS_CHANNEL_ID, GAME_NEWS_CHANNEL_ID } from "../config/channels.js";
import { MEMBER_ROLE_ID, NEWCOMERS_ROLE_ID } from "../config/roles.js";
import {
  buildLinkPreviewContainer,
  extractFirstUrl,
  fetchOpenGraphData,
} from "../functions/LinkPreviewEmbeds.js";
import { buildContainerSend } from "../functions/ComponentsV2Utils.js";
import { logError, logInfo } from "../utilities/LogUtils.js";

const LINK_PREVIEW_CHANNEL_IDS: readonly string[] = [
  GAME_NEWS_CHANNEL_ID,
  GAME_DEALS_CHANNEL_ID,
];
const EMBED_RENDER_WAIT_MS = 3000;

@Discord()
export class MessageCreated {
  @On()
  async messageCreate(
    [message]: ArgsOf<"messageCreate">,
    _client: Client,
  ): Promise<void> {
    void _client;
    const userName: string | undefined =
      message.member?.nickname?.length ? message.member?.nickname : message.member?.displayName;

    const hasMemberRole: boolean = message.member!.roles.cache.has(MEMBER_ROLE_ID);
    if (!hasMemberRole) {
      const membersRole: Role | undefined = message.member!.guild.roles.cache.get(MEMBER_ROLE_ID);
      const newcomersRole: Role | undefined =
        message.member!.guild.roles.cache.get(NEWCOMERS_ROLE_ID);
      if (membersRole) {
        logInfo("MessageCreated", `Granting member role to ${userName}`);
        message.member!.roles.add(membersRole);
      }
      if (newcomersRole) {
        logInfo("MessageCreated", `Removing newcomers role from ${userName}`);
        message.member!.roles.remove(newcomersRole);
      }
    }

    if (LINK_PREVIEW_CHANNEL_IDS.includes(message.channelId)) {
      void this.postFallbackLinkPreview(message.id, message.channel);
    }
  }

  private async postFallbackLinkPreview(
    messageId: string,
    channel: ArgsOf<"messageCreate">[0]["channel"],
  ): Promise<void> {
    try {
      await new Promise((resolve) => setTimeout(resolve, EMBED_RENDER_WAIT_MS));
      if (!("messages" in channel)) return;
      const refreshedMessage = await channel.messages.fetch(messageId);
      if (refreshedMessage.embeds.length > 0) return;

      const url = extractFirstUrl(refreshedMessage.content);
      if (!url) return;

      const ogData = await fetchOpenGraphData(url);
      if (!ogData) return;

      const { container, files } = await buildLinkPreviewContainer(ogData);
      const { components, flags } = buildContainerSend(container);
      await refreshedMessage.reply({ components, flags, files });
    } catch (error) {
      logError("MessageCreated", error);
    }
  }
}
