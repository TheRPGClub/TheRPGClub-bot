import {
  ActionRowBuilder,
  CommandInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
  userMention,
} from "discord.js";
import {
  ButtonComponent,
  Discord,
  SelectMenuComponent,
  Slash,
  SlashOption,
} from "discordx";
import Member, { type IMemberPlatformRecord } from "../classes/Member.js";
import {
  deferWithPrivateFlag,
  extractErrorMessage,
  replyIfNotOwner,
  safeDeferUpdate,
  safeReply,
  safeUpdate,
} from "../functions/InteractionUtils.js";
import { buildProfileViewPayload } from "./profile.command.js";
import {
  buildComponentsV2Flags,
  buildComponentsV2EditFlags,
  buildTextContainer,
  buildTextReply,
  buildTitledContainer,
  safeV2TextContent,
} from "../functions/ComponentsV2Utils.js";
import { buildDisabledPrevNextRow, buildPageFooterText } from "../functions/PaginationUtils.js";
import {
  GUILD_FETCH_CHUNK_SIZE,
  MP_INFO_PAGE_SIZE as PAGE_SIZE,
} from "../config/pagination.js";
import { parseCustomIdSegments } from "../utilities/CustomIdUtils.js";
import { DISCORD_SELECT_LABEL_MAX } from "../config/textLimits.js";
import { chunk } from "../utilities/ArrayUtils.js";
import { buildActionButton, buildButtonRow , buildSelectRow } from "../functions/uiComponents.js";

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

async function filterActiveGuildMembers(
  members: IMemberPlatformRecord[],
  guild: CommandInteraction["guild"],
): Promise<IMemberPlatformRecord[]> {
  if (!guild || members.length === 0) return members;

  const ids = members.map((member) => member.userId);
  const chunks = chunk(ids, GUILD_FETCH_CHUNK_SIZE);
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
  container: ReturnType<typeof buildTitledContainer>;
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
    return `${displayIndex}. ${userMention(member.userId)} - ${platforms}`;
  });

  const footer = totalPages > 1
    ? `Want to list your multiplayer info? Use /profile edit\n${buildPageFooterText(safePage, totalPages)}`
    : "Want to list your multiplayer info? Use /profile edit";

  const container = buildTitledContainer(
    "Member Multiplayer Info",
    lines.join("\n") || "No member platform data found.",
    { footer },
  );

  return { container, totalPages, safePage, pageMembers };
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
  components.push(buildSelectRow(select));

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

  const { container, totalPages, safePage, pageMembers } = buildSummaryEmbed(
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
      components: [container, ...components],
      attachments: [],
      flags: buildComponentsV2EditFlags(),
    });
  } else {
    await safeReply(interaction as any, {
      components: [container, ...components],
      flags: buildComponentsV2Flags(ephemeral),
    });
  }
}

@Discord()
export class MultiplayerInfoCommand {
  @Slash({ description: "Show members with multiplayer handles", name: "mp-info" })
  async mpInfo(
    @SlashOption({
      description: "Send reply privately (only visible to you).",
      name: "private",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    privateFlag: boolean | undefined,
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
    const ephemeral = privateFlag ?? false;
    await deferWithPrivateFlag(interaction, privateFlag);

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
    if (await replyIfNotOwner(interaction, ownerId)) return;

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
        const errContainer = buildTextContainer(safeV2TextContent(result.errorMessage, 1000));
        await safeReply(interaction, {
          components: [errContainer],
          flags: buildComponentsV2Flags(true),
        });
        return;
      }

      if (!result.payload) {
        const notFoundContainer = buildTextContainer(
        safeV2TextContent(
          result.notFoundMessage ?? `No profile data found for ${userMention(userId)}.`,
          1000,
            ),
          );
        await safeReply(interaction, {
          components: [notFoundContainer],
          flags: buildComponentsV2Flags(true),
        });
        return;
      }

      const backButton = buildActionButton({ customId: `mpinfo-back:${ownerId}:${filterKey}:${pageRaw}`, label: "Back to List", style: ButtonStyle.Secondary });
      const backRow = buildButtonRow(backButton);
      await safeUpdate(interaction, {
        components: [...result.payload.components, backRow],
        flags: buildComponentsV2Flags(false),
        content: null,
      });
    } catch (err: any) {
      const msg = extractErrorMessage(err);
      const errContainer = buildTextContainer(
      safeV2TextContent(`Could not load that profile: ${msg}`, 1000),
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
    if (await replyIfNotOwner(interaction, ownerId)) return;

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
    if (await replyIfNotOwner(interaction, ownerId)) return;

    const page = Number(pageRaw);
    if (Number.isNaN(page)) return;
    const nextPage = dir === "next" ? page + 1 : Math.max(page - 1, 0);

    const filters = decodeFilters(filterKey);
    await renderMpInfoPage(interaction, filters, ownerId, nextPage, true);
  }
}
