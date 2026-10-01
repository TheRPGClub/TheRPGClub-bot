import { Role, userMention } from "discord.js";
import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";
import { formatTimestampWithDay } from "../utilities/DiscordLogUtils.js";
import { JOIN_LEAVE_LOG_CHANNEL_ID } from "../config/channels.js";
import { NEWCOMERS_ROLE_ID } from "../config/roles.js";
import { recordJoinedMember } from "../services/MemberEventWrites.js";
import { COLOR_SUCCESS } from "../config/colors.js";
import { toUnixTimestamp } from "../functions/DateFormatUtils.js";
import { logError } from "../utilities/LogUtils.js";
import {
  buildTitledContainer,
  buildContainerSend,
  buildFieldsText,
} from "../functions/ComponentsV2Utils.js";

function formatDiscordDateTime(date: Date): string {
  return `<t:${toUnixTimestamp(date)}:F>`;
}

async function resolveLogChannel(client: Client): Promise<any | null> {
  const channel = await client.channels.fetch(JOIN_LEAVE_LOG_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased()) return null;
  const sendable = channel as any;
  return typeof sendable.send === "function" ? sendable : null;
}

@Discord()
export class GuildMemberAdd {
  @On()
  async guildMemberAdd(
    [member]: ArgsOf<"guildMemberAdd">,
    _client: Client,
  ): Promise<void> {
    void _client;

    if (!member.user.bot) {
      const logChannel = await resolveLogChannel(_client);
      if (logChannel) {
        const username = member.user.tag ?? member.user.username ?? member.user.id;
        const body = buildFieldsText([
          { name: "User", value: `${userMention(member.user.id)}\n${username}` },
          { name: "Account Created On", value: formatDiscordDateTime(member.user.createdAt) },
        ]);
        const container = buildTitledContainer("User Joined", body, {
          color: COLOR_SUCCESS,
          footer: `ID: ${member.user.id} • ${formatTimestampWithDay(Date.now())}`,
        });

        try {
          await (logChannel as any).send({ ...buildContainerSend(container) });
        } catch (error) {
          logError("GuildMemberAdd", error);
        }
      }
    }

    if (!member.user.bot) {
      void recordJoinedMember(member);
    }

    // auto-role assignment on member join
    const role: Role | undefined = member.guild.roles.cache.get(NEWCOMERS_ROLE_ID);
    if (role && !member.user.bot) {
      try {
        await member.roles.add(role);
      } catch (error) {
        logError("GuildMemberAdd", error);
      }
    }
  }
}
