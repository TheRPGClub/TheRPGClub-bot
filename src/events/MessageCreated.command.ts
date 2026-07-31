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

    const { schedule, sweepStuckReplies } = decideLinkPreviewRepair({
      authorId: message.author.id,
      content: message.content,
    });
    if (schedule) {
      void this.postFallbackLinkPreview(message.id, message.channel, sweepStuckReplies);
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
