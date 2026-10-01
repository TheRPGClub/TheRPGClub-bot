import { Role } from "discord.js";
import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";
import { MEMBER_ROLE_ID, NEWCOMERS_ROLE_ID } from "../config/roles.js";
import { LINK_RELAY_BOT_USER_ID } from "../config/users.js";
import { extractFirstUrl } from "../functions/LinkPreviewEmbeds.js";
import { renderLinkPreviewForMessage } from "../services/LinkPreviewRecoveryService.js";
import { logError, logInfo } from "../utilities/LogUtils.js";

const EMBED_RENDER_WAIT_MS = 3000;

export interface ILinkPreviewTrigger {
  authorId: string;
  content: string;
}

export interface ILinkPreviewDecision {
  schedule: boolean;
  sweepStuckReplies: boolean;
}

/**
 * Repair runs in every readable channel, so the decision comes from the message
 * itself. Link relay bot messages always schedule, even without a URL in their
 * content, so their stuck interstitial replies still get swept.
 */
export function decideLinkPreviewRepair(message: ILinkPreviewTrigger): ILinkPreviewDecision {
  const sweepStuckReplies: boolean = message.authorId === LINK_RELAY_BOT_USER_ID;
  return {
    schedule: sweepStuckReplies || extractFirstUrl(message.content) !== undefined,
    sweepStuckReplies,
  };
}

export interface IRoleSyncTrigger {
  hasMember: boolean;
  authorIsBot: boolean;
  webhookId: string | null;
}

/**
 * Webhook and DM messages have no guild member, and bots never graduate from
 * newcomers, so only a human member's message syncs roles.
 */
export function shouldSyncMemberRoles(message: IRoleSyncTrigger): boolean {
  return message.hasMember && !message.authorIsBot && !message.webhookId;
}

@Discord()
export class MessageCreated {
  @On()
  async messageCreate(
    [message]: ArgsOf<"messageCreate">,
    _client: Client,
  ): Promise<void> {
    void _client;
    await this.syncMemberRoles(message);

    const { schedule, sweepStuckReplies } = decideLinkPreviewRepair({
      authorId: message.author.id,
      content: message.content,
    });
    if (schedule) {
      void this.postFallbackLinkPreview(message.id, message.channel, sweepStuckReplies);
    }
  }

  private async syncMemberRoles(message: ArgsOf<"messageCreate">[0]): Promise<void> {
    const member = message.member;
    const trigger: IRoleSyncTrigger = {
      hasMember: member !== null,
      authorIsBot: message.author.bot,
      webhookId: message.webhookId,
    };
    if (!member || !shouldSyncMemberRoles(trigger)) return;
    if (member.roles.cache.has(MEMBER_ROLE_ID)) return;

    const userName: string = member.nickname?.length ? member.nickname : member.displayName;
    const membersRole: Role | undefined = member.guild.roles.cache.get(MEMBER_ROLE_ID);
    const newcomersRole: Role | undefined = member.guild.roles.cache.get(NEWCOMERS_ROLE_ID);
    try {
      if (membersRole) {
        logInfo("MessageCreated", `Granting member role to ${userName}`);
        await member.roles.add(membersRole);
      }
      if (newcomersRole) {
        logInfo("MessageCreated", `Removing newcomers role from ${userName}`);
        await member.roles.remove(newcomersRole);
      }
    } catch (error) {
      logError("MessageCreated", error);
    }
  }

  private async postFallbackLinkPreview(
    messageId: string,
    channel: ArgsOf<"messageCreate">[0]["channel"],
    sweepStuckReplies: boolean,
  ): Promise<void> {
    try {
      await new Promise((resolve) => setTimeout(resolve, EMBED_RENDER_WAIT_MS));
      if (!("messages" in channel)) return;
      const refreshedMessage = await channel.messages.fetch(messageId);

      await renderLinkPreviewForMessage(refreshedMessage, {
        skipWhenEmbedded: true,
        sweepStuckReplies,
      });
    } catch (error) {
      logError("MessageCreated", error);
    }
  }
}
