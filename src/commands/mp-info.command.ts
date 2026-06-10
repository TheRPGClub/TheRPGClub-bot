import {
  ActionRowBuilder,
  CommandInteraction,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
} from "discord.js";
import {
  ContainerBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import {
  ButtonComponent,
  Discord,
  SelectMenuComponent,
  Slash,
  SlashOption,
} from "discordx";
import Member, { type IMemberPlatformRecord } from "../classes/Member.js";
import {
  deferWithShowInChat,
  ephemeralFlag,
  extractErrorMessage,
  safeDeferUpdate,
  safeReply,
  safeUpdate,
} from "../functions/InteractionUtils.js";
import { buildProfileViewPayload } from "./profile.command.js";
import {
  buildComponentsV2Flags,
  buildTextReply,
  safeV2TextContent,
} from "../functions/ComponentsV2Utils.js";
import { buildDisabledPrevNextRow, buildPageFooterText } from "../functions/PaginationUtils.js";
import {
  GUILD_FETCH_CHUNK_SIZE,
  MP_INFO_PAGE_SIZE as PAGE_SIZE,
} from "../config/pagination.js";
import { parseCustomIdSegments } from "../utilities/CustomIdUtils.js";
import { DISCORD_SELECT_LABEL_MAX } from "../config/textLimits.js";

const MAX_OPTIONS = 25;

type PlatformFilters = {
  steam: boolean;
  xbl: boolean;
  psn: boolean;
  nsw: boolean;
};

function hasAnyPlatform(record: IMemberPlatformRecord, filters: PlatformFilters): boolean {
  if (filters.steam && record.steamUrl) return true;
  if (filters.xbl && record.xblUsername) return true;
  if (filters.psn && record.psnUsername) return true;
  if (filters.nsw && record.nswFriendCode) return true;
  return false;
}

function formatPlatforms(record: IMemberPlatformRecord, filters: PlatformFilters): string {
  const platforms: string[] = [];

  if (filters.steam && record.steamUrl) platforms.push("Steam");
  if (filters.xbl && record.xblUsername) platforms.push("Xbox Live");
  if (filters.psn && record.psnUsername) platforms.push("PSN");
  if (filters.nsw && record.nswFriendCode) platforms.push("Switch");

  return platforms.join(", ");
}

function encodeFilters(filters: PlatformFilters): string {
  return [
    filters.steam ? "1" : "0",
    filters.xbl ? "1" : "0",
    filters.psn ? "1" : "0",
    filters.nsw ? "1" : "0",
  ].join("");
}

function decodeFilters(key: string): PlatformFilters {
  const chars = key.split("");
  return {
    steam: chars[0] === "1",
    xbl: chars[1] === "1",
    psn: chars[2] === "1",
    nsw: chars[3] === "1",
  };
}

function chunkIds(ids: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}

async function filterActiveGuildMembers(
  members: IMemberPlatformRecord[],
  guild: CommandInteraction["guild"],
): Promise<IMemberPlatformRecord[]> {
  if (!guild || members.length === 0) return members;

  const ids = members.map((member) => member.userId);
  const chunks = chunkIds(ids, GUILD_FETCH_CHUNK_SIZE);
  const present = new Set<string>();

  for (const chunk of chunks) {
    try {
      const fetched = await guild.members.fetch({ user: chunk });
      fetched.forEach((member) => present.add(member.id));
    } catch {
      // ignore fetch errors and fall back to cached entries
      chunk.forEach((id) => {
        if (guild.members.cache.has(id)) {
          present.add(id);
        }
      });
    }
  }

  return members.filter((member) => present.has(member.userId));
}

function buildSummaryEmbed(
  members: IMemberPlatformRecord[],
  filters: PlatformFilters,
  page: number,
): {
  embed: EmbedBuilder;
  totalPages: number;
  safePage: number;
  pageMembers: IMemberPlatformRecord[];
} {
  const totalPages = Math.max(1, Math.ceil(members.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const offset = safePage * PAGE_SIZE;
  const pageMembers = members.slice(offset, offset + PAGE_SIZE);

  const lines = pageMembers.map((member, idx) => {
    const displayIndex = offset + idx + 1;
    const platforms = formatPlatforms(member, filters);
    return `${displayIndex}. <@${member.userId}> - ${platforms}`;
  });

  const embed = new EmbedBuilder()
    .setTitle("Member Multiplayer Info")
    .setDescription(lines.join("\n") || "No member platform data found.")
    .setFooter({ text: "Want to list your multiplayer info? Use /profile edit" });

  if (totalPages > 1) {
    const footerText = [
      "Want to list your multiplayer info? Use /profile edit",
      buildPageFooterText(safePage, totalPages),
    ].join("\n");
    embed.setFooter({ text: footerText });
  }

  return { embed, totalPages, safePage, pageMembers };
}

function buildPageComponents(
  members: IMemberPlatformRecord[],
  filters: PlatformFilters,
  ownerId: string,
  page: number,
  totalPages: number,
  pageMembers: IMemberPlatformRecord[],
): ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] {
  const filterKey = encodeFilters(filters);
  const options = pageMembers.slice(0, MAX_OPTIONS).map((member) => {
    const name = member.globalName ?? member.username ?? "Unknown member";
    const platforms = formatPlatforms(member, filters) || "Platforms not listed";
    return {
      label: name.slice(0, DISCORD_SELECT_LABEL_MAX),
      value: member.userId,
      description: platforms.slice(0, DISCORD_SELECT_LABEL_MAX),
    };
  });

  const components: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [];

  const select = new StringSelectMenuBuilder()
    .setCustomId(`mpinfo-select:${ownerId}:${filterKey}:${page}`)
    .setPlaceholder("Select a member to view their profile")
    .addOptions(options)
    .setMinValues(1)
    .setMaxValues(1);
  components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));

  const navRow = buildDisabledPrevNextRow(
    `mpinfo-page:${ownerId}:${filterKey}`,
    page,
    totalPages,
    { prev: "Previous Page", next: "Next Page" },
  );
  if (navRow) {
    components.push(navRow);
  }

  return components;
}

async function renderMpInfoPage(
  interaction: CommandInteraction | ButtonInteraction | StringSelectMenuInteraction,
  filters: PlatformFilters,
  ownerId: string,
  page: number,
  ephemeral: boolean,
): Promise<void> {
  const members = await Member.getMembersWithPlatforms();
  const filtered = members.filter((member) => hasAnyPlatform(member, filters));
  const activeMembers = await filterActiveGuildMembers(filtered, interaction.guild);

  if (!activeMembers.length) {
    await safeReply(interaction as any, buildTextReply("No members match the selected platforms.", ephemeral));
    return;
  }

  const { embed, totalPages, safePage, pageMembers } = buildSummaryEmbed(
    activeMembers,
    filters,
    page,
  );
  const components = buildPageComponents(
    activeMembers,
    filters,
    ownerId,
    safePage,
    totalPages,
    pageMembers,
  );

  if (interaction.isMessageComponent()) {
    await safeUpdate(interaction as any, {
      embeds: [embed],
      components,
      attachments: [],
    });
  } else {
    await safeReply(interaction as any, {
      embeds: [embed],
      components,
      flags: ephemeralFlag(ephemeral),
    });
  }
}

@Discord()
export class MultiplayerInfoCommand {
  @Slash({ description: "Show members with multiplayer handles", name: "mp-info" })
  async mpInfo(
    @SlashOption({
      description: "If true, post in channel instead of ephemerally.",
      name: "showinchat",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showInChat: boolean | undefined,
    @SlashOption({
      description: "Include Steam users.",
      name: "steam",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    steam: boolean | undefined,
    @SlashOption({
      description: "Include Xbox Live users.",
      name: "xbl",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    xbl: boolean | undefined,
    @SlashOption({
      description: "Include PlayStation Network users.",
      name: "psn",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    psn: boolean | undefined,
    @SlashOption({
      description: "Include Nintendo Switch users.",
      name: "switch",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    nsw: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const anyExplicitTrue = [steam, xbl, psn, nsw].some((val) => val === true);
    const filters: PlatformFilters = anyExplicitTrue
      ? {
          steam: steam === true,
          xbl: xbl === true,
          psn: psn === true,
          nsw: nsw === true,
        }
      : {
          steam: steam ?? true,
          xbl: xbl ?? true,
          psn: psn ?? true,
          nsw: nsw ?? true,
        };
    const ephemeral = !showInChat;
    await deferWithShowInChat(interaction, showInChat);

    const anyIncluded = filters.steam || filters.xbl || filters.psn || filters.nsw;
    if (!anyIncluded) {
      await safeReply(interaction, buildTextReply("Please enable at least one platform filter.", ephemeral));
      return;
    }

    await renderMpInfoPage(interaction, filters, interaction.user.id, 0, ephemeral);
  }

  @SelectMenuComponent({ id: /^mpinfo-select:\d+:[01]{4}:\d+$/ })
  async handleProfileSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const segments = parseCustomIdSegments(interaction.customId, 3);
    if (!segments) return;
    const [ownerId, filterKey, pageRaw] = segments;
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("This menu isn't for you.", true));
      return;
    }

    const userId = interaction.values?.[0];
    if (!userId) {
      await safeReply(interaction, buildTextReply("Could not determine which member to load.", true));
      return;
    }
    await safeDeferUpdate(interaction);

    try {
      const user = await interaction.client.users.fetch(userId);
      const result = await buildProfileViewPayload(user);

      if (result.errorMessage) {
        const errContainer = new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent(safeV2TextContent(result.errorMessage, 1000)),
        );
        await safeReply(interaction, {
          components: [errContainer],
          flags: buildComponentsV2Flags(true),
        });
        return;
      }

      if (!result.payload) {
        const notFoundContainer = new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            safeV2TextContent(
              result.notFoundMessage ?? `No profile data found for <@${userId}>.`,
              1000,
            ),
          ),
        );
        await safeReply(interaction, {
          components: [notFoundContainer],
          flags: buildComponentsV2Flags(true),
        });
        return;
      }

      const backButton = new ButtonBuilder()
        .setCustomId(`mpinfo-back:${ownerId}:${filterKey}:${pageRaw}`)
        .setLabel("Back to List")
        .setStyle(ButtonStyle.Secondary);
      const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(backButton);
      await safeUpdate(interaction, {
        components: [...result.payload.components, backRow],
        flags: buildComponentsV2Flags(false),
        content: null,
        embeds: [],
      });
    } catch (err: any) {
      const msg = extractErrorMessage(err);
      const errContainer = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          safeV2TextContent(`Could not load that profile: ${msg}`, 1000),
        ),
      );
      await safeReply(interaction, {
        components: [errContainer],
        flags: buildComponentsV2Flags(true),
      });
    }
  }

  @ButtonComponent({ id: /^mpinfo-back:\d+:[01]{4}:\d+$/ })
  async handleBackToList(interaction: ButtonInteraction): Promise<void> {
    const segments = parseCustomIdSegments(interaction.customId, 3);
    if (!segments) return;
    const [ownerId, filterKey, pageRaw] = segments;
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("This menu isn't for you.", true));
      return;
    }

    const page = Number(pageRaw);
    if (Number.isNaN(page)) return;

    const filters = decodeFilters(filterKey);
    await renderMpInfoPage(interaction, filters, ownerId, page, true);
  }

  @ButtonComponent({ id: /^mpinfo-page:\d+:[01]{4}:\d+:(prev|next)$/ })
  async handlePageButton(interaction: ButtonInteraction): Promise<void> {
    const segments = parseCustomIdSegments(interaction.customId, 4);
    if (!segments) return;
    const [ownerId, filterKey, pageRaw, dir] = segments;
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("This menu isn't for you.", true));
      return;
    }

    const page = Number(pageRaw);
    if (Number.isNaN(page)) return;
    const nextPage = dir === "next" ? page + 1 : Math.max(page - 1, 0);

    const filters = decodeFilters(filterKey);
    await renderMpInfoPage(interaction, filters, ownerId, nextPage, true);
  }
}
