import { Role } from "discord.js";
import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";
import { MEMBER_ROLE_ID, NEWCOMERS_ROLE_ID } from "../config/roles.js";
import { logError, logInfo } from "../utilities/LogUtils.js";

export interface IRoleSyncTrigger {
  authorIsBot: boolean;
  isSystem: boolean;
  webhookId: string | null;
}

/**
 * Only a human's own post graduates them. System messages are skipped because
 * the join notice is authored by the joining user, and webhooks are not members.
 */
export function shouldSyncMemberRoles(message: IRoleSyncTrigger): boolean {
  return !message.authorIsBot && !message.isSystem && !message.webhookId;
}

@Discord()
export class MessageCreated {
  @On()
  async messageCreate(
    [message]: ArgsOf<"messageCreate">,
    _client: Client,
  ): Promise<void> {
    void _client;
    void this.syncMemberRoles(message);
  }

  private async syncMemberRoles(message: ArgsOf<"messageCreate">[0]): Promise<void> {
    const member = message.member;
    if (!member) return;
    const trigger: IRoleSyncTrigger = {
      authorIsBot: message.author.bot,
      isSystem: message.system,
      webhookId: message.webhookId,
    };
    if (!shouldSyncMemberRoles(trigger)) return;
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
}
