import {
  ChannelType,
  PermissionsBitField,
  type GuildChannel,
  type GuildEmoji,
  type Role,
  channelMention,
} from "discord.js";
import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";
import { formatTimestampWithDay, resolveLogChannel } from "../utilities/DiscordLogUtils.js";
import { COLOR_INFO, COLOR_ERROR } from "../config/colors.js";
import {
  buildTitledContainer,
  buildContainerSend,
} from "../functions/ComponentsV2Utils.js";

function buildBaseContainer(title: string, body: string, color = COLOR_INFO) {
  return buildTitledContainer(title, body, { color, footer: formatTimestampWithDay(Date.now()) });
}

function isGuildChannel(channel: any): channel is GuildChannel {
  if (!channel) return false;
  if (typeof channel.isDMBased === "function" && channel.isDMBased()) return false;
  return "guild" in channel;
}

function channelLabel(channel: GuildChannel): string {
  if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) {
    return channelMention(channel.id);
  }
  return `${channel.name ?? channel.id}`;
}

function roleLabel(role: Role): string {
  return `<@&${role.id}>`;
}

function emojiLabel(emoji: GuildEmoji): string {
  const name = emoji.name ?? "emoji";
  return `<${emoji.animated ? "a" : ""}:${name}:${emoji.id}>`;
}

function formatPermissions(role: Role): string {
  const perms = new PermissionsBitField(role.permissions.bitfield);
  const names = perms.toArray();
  return names.length ? names.join(", ") : "None";
}

function diffLines(label: string, before: string | null, after: string | null): string | null {
  if ((before ?? "") === (after ?? "")) return null;
  return `**${label}:** ${before ?? "None"} -> ${after ?? "None"}`;
}

@Discord()
export class ServerChangeLog {
  @On()
  async channelCreate([channel]: ArgsOf<"channelCreate">, client: Client): Promise<void> {
    if (!isGuildChannel(channel)) return;
    const logChannel = await resolveLogChannel(client);
    if (!logChannel) return;

    const container = buildBaseContainer(
      "Channel created",
      `${channelLabel(channel)} (${channel.id})`,
    );
    await logChannel.send({ ...buildContainerSend(container) });
  }

  @On()
  async channelDelete([channel]: ArgsOf<"channelDelete">, client: Client): Promise<void> {
    if (!isGuildChannel(channel)) return;
    const logChannel = await resolveLogChannel(client);
    if (!logChannel) return;

    const container = buildBaseContainer(
      "Channel deleted",
      `${channel.name ?? channel.id} (${channel.id})`,
      COLOR_ERROR,
    );
    await logChannel.send({ ...buildContainerSend(container) });
  }

  @On()
  async channelUpdate(
    [oldChannel, newChannel]: ArgsOf<"channelUpdate">,
    client: Client,
  ): Promise<void> {
    if (!isGuildChannel(oldChannel) || !isGuildChannel(newChannel)) return;
    const logChannel = await resolveLogChannel(client);
    if (!logChannel) return;

    const changes: string[] = [];
    changes.push(
      diffLines("Name", oldChannel.name ?? null, newChannel.name ?? null) ?? "",
    );
    if ("topic" in oldChannel && "topic" in newChannel) {
      changes.push(diffLines("Topic", oldChannel.topic ?? null, newChannel.topic ?? null) ?? "");
    }
    if ("nsfw" in oldChannel && "nsfw" in newChannel) {
      changes.push(diffLines("NSFW", String(oldChannel.nsfw), String(newChannel.nsfw)) ?? "");
    }
    if ("rateLimitPerUser" in oldChannel && "rateLimitPerUser" in newChannel) {
      changes.push(
        diffLines(
          "Slowmode",
          String(oldChannel.rateLimitPerUser ?? 0),
          String(newChannel.rateLimitPerUser ?? 0),
        ) ?? "",
      );
    }
    changes.push(
      diffLines("Parent", oldChannel.parentId ?? null, newChannel.parentId ?? null) ?? "",
    );

    const filtered = changes.filter((line) => line);
    if (!filtered.length) return;

    const body = `${channelLabel(newChannel)} (${newChannel.id})\n${filtered.join("\n")}`;
    const container = buildBaseContainer("Channel updated", body);
    await logChannel.send({ ...buildContainerSend(container) });
  }

  @On()
  async roleCreate([role]: ArgsOf<"roleCreate">, client: Client): Promise<void> {
    if (!role || !role.guild) return;
    const logChannel = await resolveLogChannel(client);
    if (!logChannel) return;

    const container = buildBaseContainer("Role created", `${roleLabel(role)} (${role.id})`);
    await logChannel.send({ ...buildContainerSend(container) });
  }

  @On()
  async roleDelete([role]: ArgsOf<"roleDelete">, client: Client): Promise<void> {
    if (!role || !role.guild) return;
    const logChannel = await resolveLogChannel(client);
    if (!logChannel) return;

    const container = buildBaseContainer(
      "Role deleted",
      `${role.name ?? role.id} (${role.id})`,
      COLOR_ERROR,
    );
    await logChannel.send({ ...buildContainerSend(container) });
  }

  @On()
  async roleUpdate([oldRole, newRole]: ArgsOf<"roleUpdate">, client: Client): Promise<void> {
    if (!newRole || !newRole.guild) return;
    const logChannel = await resolveLogChannel(client);
    if (!logChannel) return;

    const changes: string[] = [];
    changes.push(diffLines("Name", oldRole.name ?? null, newRole.name ?? null) ?? "");
    changes.push(diffLines("Color", String(oldRole.color), String(newRole.color)) ?? "");
    changes.push(diffLines("Hoist", String(oldRole.hoist), String(newRole.hoist)) ?? "");
    changes.push(
      diffLines("Mentionable", String(oldRole.mentionable), String(newRole.mentionable)) ?? "",
    );
    changes.push(
      diffLines("Permissions", formatPermissions(oldRole), formatPermissions(newRole)) ?? "",
    );
    const filtered = changes.filter((line) => line);
    if (!filtered.length) return;

    const body = `${roleLabel(newRole)} (${newRole.id})\n${filtered.join("\n")}`;
    const container = buildBaseContainer("Role updated", body);
    await logChannel.send({ ...buildContainerSend(container) });
  }

  @On()
  async emojiCreate([emoji]: ArgsOf<"emojiCreate">, client: Client): Promise<void> {
    const logChannel = await resolveLogChannel(client);
    if (!logChannel) return;

    const container = buildBaseContainer("Emoji created", `${emojiLabel(emoji)} (${emoji.id})`);
    await logChannel.send({ ...buildContainerSend(container) });
  }

  @On()
  async emojiDelete([emoji]: ArgsOf<"emojiDelete">, client: Client): Promise<void> {
    const logChannel = await resolveLogChannel(client);
    if (!logChannel) return;

    const container = buildBaseContainer(
      "Emoji deleted",
      `${emoji.name ?? "emoji"} (${emoji.id})`,
      COLOR_ERROR,
    );
    await logChannel.send({ ...buildContainerSend(container) });
  }

  @On()
  async emojiUpdate(
    [oldEmoji, newEmoji]: ArgsOf<"emojiUpdate">,
    client: Client,
  ): Promise<void> {
    const logChannel = await resolveLogChannel(client);
    if (!logChannel) return;

    const changes: string[] = [];
    changes.push(diffLines("Name", oldEmoji.name ?? null, newEmoji.name ?? null) ?? "");
    changes.push(
      diffLines("Animated", String(oldEmoji.animated), String(newEmoji.animated)) ?? "",
    );
    changes.push(
      diffLines("Available", String(oldEmoji.available), String(newEmoji.available)) ?? "",
    );
    const filtered = changes.filter((line) => line);
    if (!filtered.length) return;

    const body = `${emojiLabel(newEmoji)} (${newEmoji.id})\n${filtered.join("\n")}`;
    const container = buildBaseContainer("Emoji updated", body);
    await logChannel.send({ ...buildContainerSend(container) });
  }

  @On()
  async guildUpdate([oldGuild, newGuild]: ArgsOf<"guildUpdate">, client: Client): Promise<void> {
    const logChannel = await resolveLogChannel(client);
    if (!logChannel) return;

    const changes: string[] = [];
    changes.push(diffLines("Name", oldGuild.name ?? null, newGuild.name ?? null) ?? "");
    changes.push(
      diffLines("Description", oldGuild.description ?? null, newGuild.description ?? null) ?? "",
    );
    changes.push(
      diffLines("Locale", oldGuild.preferredLocale ?? null, newGuild.preferredLocale ?? null) ?? "",
    );
    const oldIcon = oldGuild.iconURL({ size: 128, extension: "png" }) ?? null;
    const newIcon = newGuild.iconURL({ size: 128, extension: "png" }) ?? null;
    changes.push(diffLines("Icon", oldIcon, newIcon) ?? "");
    const oldBanner = oldGuild.bannerURL({ size: 128, extension: "png" }) ?? null;
    const newBanner = newGuild.bannerURL({ size: 128, extension: "png" }) ?? null;
    changes.push(diffLines("Banner", oldBanner, newBanner) ?? "");

    const filtered = changes.filter((line) => line);
    if (!filtered.length) return;

    const body = `${newGuild.name ?? newGuild.id}\n${filtered.join("\n")}`;
    const container = buildBaseContainer("Server updated", body);
    await logChannel.send({ ...buildContainerSend(container) });
  }
}
