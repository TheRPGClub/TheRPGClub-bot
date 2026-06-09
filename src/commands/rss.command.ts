import type { CommandInteraction } from "discord.js";
import { ApplicationCommandOptionType, MessageFlags, type Channel } from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import {
  extractErrorMessage,
  safeDeferReply,
  safeReply,
  sanitizeUserInput,
} from "../functions/InteractionUtils.js";
import { buildTextReply } from "../functions/ComponentsV2Utils.js";
import { isAdmin } from "./admin/admin-auth.utils.js";
import { addFeed, listFeeds, removeFeed, updateFeed } from "../classes/RssFeed.js";
import { buildRssHelpResponse } from "./help.command.js";

function normalizeList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

@Discord()
@SlashGroup({ description: "Manage RSS feed relays", name: "rss" })
@SlashGroup("rss")
export class RssCommand {
  @Slash({ description: "Show help for RSS commands", name: "help" })
  async help(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const ok = await isAdmin(interaction);
    if (!ok) return;

    const response = buildRssHelpResponse();
    await safeReply(interaction, { ...response, flags: MessageFlags.Ephemeral });
  }

  @Slash({ description: "Add an RSS feed relay", name: "add" })
  async add(
    @SlashOption({
      description: "RSS feed URL",
      name: "url",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    url: string,
    @SlashOption({
      description: "Channel to post URLs into",
      name: "channel",
      required: true,
      type: ApplicationCommandOptionType.Channel,
    })
    channel: Channel,
    @SlashOption({
      description: "Optional friendly name",
      name: "name",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    feedName: string | undefined,
    @SlashOption({
      description: "Comma-separated include keywords (optional)",
      name: "include",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    include: string | undefined,
    @SlashOption({
      description: "Comma-separated exclude keywords (optional)",
      name: "exclude",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    exclude: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const ok = await isAdmin(interaction);
    if (!ok) return;

    try {
      url = sanitizeUserInput(url, { preserveNewlines: false });
      const sanitizedName = feedName
        ? sanitizeUserInput(feedName, { preserveNewlines: false })
        : undefined;
      const includeKeywords = normalizeList(
        include ? sanitizeUserInput(include, { preserveNewlines: false }) : undefined,
      );
      const excludeKeywords = normalizeList(
        exclude ? sanitizeUserInput(exclude, { preserveNewlines: false }) : undefined,
      );
      const channelId = channel.id;
      const id = await addFeed(
        sanitizedName ?? null,
        url,
        channelId,
        includeKeywords,
        excludeKeywords,
      );
      const addedMsg =
        `Added feed #${id} (${sanitizedName ?? "unnamed"}) -> <#${channelId}> (url=${url}).`;
      await safeReply(interaction, buildTextReply(addedMsg, true));
    } catch (err: any) {
      const msg = extractErrorMessage(err);
      await safeReply(interaction, buildTextReply(`Failed to add feed: ${msg}`, true));
    }
  }

  @Slash({ description: "Remove an RSS feed relay", name: "remove" })
  async remove(
    @SlashOption({
      description: "Feed id (see /rss list)",
      name: "id",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    feedId: number,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const ok = await isAdmin(interaction);
    if (!ok) return;

    try {
      const removed = await removeFeed(feedId);
      const removeMsg = removed ? `Removed feed #${feedId}.` : `Feed #${feedId} not found.`;
      await safeReply(interaction, buildTextReply(removeMsg, true));
    } catch (err: any) {
      const msg = extractErrorMessage(err);
      await safeReply(interaction, buildTextReply(`Failed to remove feed: ${msg}`, true));
    }
  }

  @Slash({ description: "Edit an RSS feed relay", name: "edit" })
  async edit(
    @SlashOption({
      description: "Feed id (see /rss list)",
      name: "id",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    feedId: number,
    @SlashOption({
      description: "New RSS feed URL (optional)",
      name: "url",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    url: string | undefined,
    @SlashOption({
      description: "New friendly name (optional)",
      name: "name",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    feedName: string | undefined,
    @SlashOption({
      description: "New channel to post URLs into (optional)",
      name: "channel",
      required: false,
      type: ApplicationCommandOptionType.Channel,
    })
    channel: Channel | undefined,
    @SlashOption({
      description: "Comma-separated include keywords (optional)",
      name: "include",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    include: string | undefined,
    @SlashOption({
      description: "Comma-separated exclude keywords (optional)",
      name: "exclude",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    exclude: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const ok = await isAdmin(interaction);
    if (!ok) return;

    if (
      url === undefined &&
      feedName === undefined &&
      channel === undefined &&
      include === undefined &&
      exclude === undefined
    ) {
      await safeReply(
        interaction,
        buildTextReply(
          "Nothing to update. Provide at least one field (url/channel/include/exclude).",
          true,
        ),
      );
      return;
    }

    try {
      const sanitizedUrl = url ? sanitizeUserInput(url, { preserveNewlines: false }) : undefined;
      const sanitizedName = feedName
        ? sanitizeUserInput(feedName, { preserveNewlines: false })
        : undefined;
      const includeKeywords = include === undefined
        ? undefined
        : normalizeList(sanitizeUserInput(include, { preserveNewlines: false }));
      const excludeKeywords = exclude === undefined
        ? undefined
        : normalizeList(sanitizeUserInput(exclude, { preserveNewlines: false }));
      const channelId = channel ? channel.id : undefined;
      const updated = await updateFeed(feedId, {
        feedUrl: sanitizedUrl,
        channelId: channelId,
        includeKeywords,
        excludeKeywords,
        feedName: sanitizedName ?? undefined,
      });

      const editMsg = updated
        ? `Updated feed #${feedId}.`
        : `Feed #${feedId} not found or no changes applied.`;
      await safeReply(interaction, buildTextReply(editMsg, true));
    } catch (err: any) {
      const msg = extractErrorMessage(err);
      await safeReply(interaction, buildTextReply(`Failed to edit feed: ${msg}`, true));
    }
  }

  @Slash({ description: "List RSS feed relays", name: "list" })
  async list(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const ok = await isAdmin(interaction);
    if (!ok) return;

    try {
      const feeds = await listFeeds();
      if (!feeds.length) {
        await safeReply(interaction, buildTextReply("No feeds configured.", true));
        return;
      }

      const lines = feeds.map(
        (f) =>
          `#${f.feedId}: ${f.feedName ?? "(no name)"} ${f.feedUrl} -> <#${f.channelId}>` +
          (f.includeKeywords.length ? ` include=[${f.includeKeywords.join(", ")}]` : "") +
          (f.excludeKeywords.length ? ` exclude=[${f.excludeKeywords.join(", ")}]` : ""),
      );

      await safeReply(interaction, buildTextReply(lines.join("\n"), true));
    } catch (err: any) {
      const msg = extractErrorMessage(err);
      await safeReply(interaction, buildTextReply(`Failed to list feeds: ${msg}`, true));
    }
  }
}
