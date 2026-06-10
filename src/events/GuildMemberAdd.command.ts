import { EmbedBuilder, Role, userMention } from "discord.js";
import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";
import { formatTimestampWithDay } from "../utilities/DiscordLogUtils.js";
import { JOIN_LEAVE_LOG_CHANNEL_ID } from "../config/channels.js";
import { recordCurrentAvatarIfNew } from "../utilities/AvatarLogUtils.js";
import { COLOR_SUCCESS } from "../config/colors.js";
import { logError } from "../utilities/LogUtils.js";

function formatDiscordDateTime(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:F>`;
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
        const embed = new EmbedBuilder()
          .setTitle("User Joined")
          .setColor(COLOR_SUCCESS)
          .addFields(
            { name: "User", value: `${userMention(member.user.id)}\n${username}` },
            {
              name: "Account Created On",
              value: formatDiscordDateTime(member.user.createdAt),
            },
          )
          .setFooter({
            text: `ID: ${member.user.id} • ${formatTimestampWithDay(Date.now())}`,
          })
          .setThumbnail(member.user.displayAvatarURL());

        await (logChannel as any).send({ embeds: [embed] });
      }
    }

    if (!member.user.bot) {
      recordCurrentAvatarIfNew(member).catch((err: any) => {
        logError("GuildMemberAdd.recordAvatar", err?.message ?? err);
      });
    }

    // auto-role assignment on member join
    const role: Role | undefined = member.guild.roles.cache.find((r) => r.name === "newcomers");
    if (role) {
      member.roles.add(role);
    }
  }
}
