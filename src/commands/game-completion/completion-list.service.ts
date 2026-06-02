import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type CommandInteraction,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
  type User,
} from "discord.js";
import { ContainerBuilder, TextDisplayBuilder } from "@discordjs/builders";
import Member from "../../classes/Member.js";
import Game from "../../classes/Game.js";
import { COMPLETION_PAGE_SIZE, formatDiscordTimestamp, formatTableDate } from "../profile.command.js";
import { formatPlatformDisplayName } from "../../functions/PlatformDisplay.js";
import { safeReply } from "../../functions/InteractionUtils.js";
import { renderUsernameWithEmoji } from "../../services/UserEmojiService.js";
import { COMPONENTS_V2_FLAG } from "../../config/flags.js";
import { buildUserHeaderContainer } from "../../functions/uiComponents.js";

function buildCompletionV2Flags(ephemeral: boolean): number {
  return (ephemeral ? MessageFlags.Ephemeral : 0) | COMPONENTS_V2_FLAG;
}

/**
 * Renders a leaderboard showing all members with completions, optionally filtered by game title
 */
export async function renderCompletionLeaderboard(
  interaction: CommandInteraction,
  ephemeral: boolean,
  query?: string,
): Promise<void> {
  const leaderboard = await Member.getCompletionLeaderboard(25, query);
  if (!leaderboard.length) {
    const text = query
      ? `No completions found matching "${query}".`
      : "No completions recorded yet.";
    await safeReply(interaction, {
      components: [
        new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent(text),
        ),
      ],
      flags: buildCompletionV2Flags(ephemeral),
    });
    return;
  }

  const lines = leaderboard.map((m, idx) => {
    const name = m.globalName ?? m.username ?? m.userId;
    const suffix = m.count === 1 ? "completion" : "completions";
    return `${idx + 1}. **${renderUsernameWithEmoji(m.userId, name)}**: ${m.count} ${suffix}`;
  });

  const trimmedQuery = query?.trim();
  const contentParts = ["## Game Completion Leaderboard", lines.join("\n")];
  if (trimmedQuery) {
    contentParts.push(`-# Filter: "${trimmedQuery}"`);
  }

  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(contentParts.join("\n")),
  );

  const options = leaderboard.map((m) => ({
    label: (m.globalName ?? m.username ?? m.userId).slice(0, 100),
    value: m.userId,
    description: `${m.count} ${m.count === 1 ? "completion" : "completions"}`,
  }));

  const select = new StringSelectMenuBuilder()
    .setCustomId(
      `comp-leaderboard-select${trimmedQuery ? `:${trimmedQuery.slice(0, 50)}` : ""}`,
    )
    .setPlaceholder("View completions for a member")
    .addOptions(options);

  await safeReply(interaction, {
    components: [
      container,
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
    ],
    flags: buildCompletionV2Flags(ephemeral),
  });
}

/**
 * Renders a paginated list of a user's game completions
 */
export async function renderCompletionPage(
  interaction:
    | CommandInteraction
    | ButtonInteraction
    | StringSelectMenuInteraction
    | ModalSubmitInteraction,
  userId: string,
  page: number,
  year: number | "unknown" | null,
  ephemeral: boolean,
  query?: string,
): Promise<void> {
  const user =
    interaction.user.id === userId
      ? interaction.user
      : await interaction.client.users.fetch(userId).catch(() => interaction.user);

  const result = await buildCompletionComponents(userId, page, year, user, query);

  if (!result) {
    if (year === "unknown") {
      await safeReply(interaction as any, {
        components: [
          new ContainerBuilder().addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              "You have no recorded completions with unknown dates.",
            ),
          ),
        ],
        flags: buildCompletionV2Flags(ephemeral),
      });
      return;
    }
    const text = year
      ? `You have no recorded completions for ${year}.`
      : "You have no recorded completions yet.";
    await safeReply(interaction as any, {
      components: [
        new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent(text),
        ),
      ],
      flags: buildCompletionV2Flags(ephemeral),
    });
    return;
  }

  const { containers, totalPages, safePage, sortedYears, yearCounts } = result;
  const yearPart = year == null ? "" : String(year);
  const queryPart = query ? `:${query.slice(0, 50)}` : "";
  const paginationRows = buildPaginationRows(
    totalPages,
    safePage,
    `comp-list-page:${userId}:${yearPart}:${safePage}:prev${queryPart}`,
    `comp-list-page:${userId}:${yearPart}:${safePage}:next${queryPart}`,
  );

  const yearJumpRow = buildYearJumpRow(userId, year, query, totalPages, sortedYears, yearCounts);
  const displayName = user.displayName ?? user.username ?? user.id;
  const header = buildUserHeaderContainer(userId, displayName, "Completed Games");

  await safeReply(interaction as any, {
    components: [
      header,
      ...containers,
      ...(yearJumpRow ? [yearJumpRow] : []),
      ...paginationRows,
    ],
    flags: buildCompletionV2Flags(ephemeral),
  });
}

/**
 * Renders a paginated list of completions with selection menu for editing or deleting
 */
export async function renderSelectionPage(
  interaction: CommandInteraction | ButtonInteraction | StringSelectMenuInteraction,
  userId: string,
  page: number,
  mode: "edit" | "delete",
  year: number | "unknown" | null = null,
  query?: string,
): Promise<void> {
  const user =
    interaction.user.id === userId
      ? interaction.user
      : await interaction.client.users.fetch(userId).catch(() => interaction.user);

  const result = await buildCompletionComponents(userId, page, year, user, query);

  if (!result) {
    const msg =
      mode === "edit"
        ? "You have no completions to edit matching your filters."
        : "You have no completions to delete matching your filters.";
    if (interaction.isMessageComponent() && !interaction.deferred && !interaction.replied) {
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    } else {
      await safeReply(interaction, { content: msg, flags: MessageFlags.Ephemeral });
    }
    return;
  }

  const { containers, totalPages, safePage, pageCompletions } = result;

  const selectOptions = pageCompletions.map((c) => ({
    label: c.title.slice(0, 100),
    value: String(c.completionId),
    description: `${c.completionType} (${
      c.completedAt ? formatDiscordTimestamp(c.completedAt) : "No date"
    })`.slice(0, 100),
  }));

  const selectId = mode === "edit" ? "comp-edit-menu" : "comp-del-menu";
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${selectId}:${userId}`)
    .setPlaceholder(`Select a completion to ${mode}`)
    .addOptions(selectOptions);

  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  const yearPart = year == null ? "" : String(year);
  const queryPart = query ? `:${query.slice(0, 50)}` : "";
  const paginationRows = buildPaginationRows(
    totalPages,
    safePage,
    `comp-${mode}-page:${userId}:${yearPart}:${safePage}:prev${queryPart}`,
    `comp-${mode}-page:${userId}:${yearPart}:${safePage}:next${queryPart}`,
  );

  const displayName = user.displayName ?? user.username ?? user.id;
  const header = buildUserHeaderContainer(userId, displayName, "Completed Games");
  const allComponents = [header, ...containers, selectRow, ...paginationRows];

  if (interaction.isMessageComponent()) {
    if (interaction.deferred || interaction.replied) {
      await (interaction as any).editReply({ components: allComponents, flags: COMPONENTS_V2_FLAG });
    } else {
      await (interaction as any).update({ components: allComponents, flags: COMPONENTS_V2_FLAG });
    }
  } else {
    await safeReply(interaction, {
      components: allComponents,
      flags: MessageFlags.Ephemeral | COMPONENTS_V2_FLAG,
    });
  }
}

function buildYearJumpRow(
  userId: string,
  activeYear: number | "unknown" | null,
  query: string | undefined,
  totalPages: number,
  sortedYears: string[],
  yearCounts: Record<string, number>,
): ActionRowBuilder<StringSelectMenuBuilder> | null {
  if (activeYear !== null || query || totalPages <= 5 || sortedYears.length <= 3) return null;

  const options = sortedYears.slice(0, 25).map((yr) => {
    const count = yearCounts[yr] ?? 0;
    const label = yr === "Unknown" ? "Unknown Date" : yr;
    const gameWord = count === 1 ? "game" : "games";
    return { label, value: yr === "Unknown" ? "unknown" : yr, description: `${count} ${gameWord}` };
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId(`comp-year-select:${userId}`)
    .setPlaceholder("Jump to year")
    .addOptions(options);

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

function buildPaginationRows(
  totalPages: number,
  safePage: number,
  prevCustomId: string,
  nextCustomId: string,
): ActionRowBuilder<ButtonBuilder>[] {
  if (totalPages <= 1) return [];

  const showPrev = safePage > 0;
  const showNext = safePage < totalPages - 1;
  if (!showPrev && !showNext) return [];

  const buttons: ButtonBuilder[] = [];
  if (showPrev) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(prevCustomId)
        .setLabel("Previous Page")
        .setStyle(ButtonStyle.Secondary),
    );
  }
  if (showNext) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(nextCustomId)
        .setLabel("Next Page")
        .setStyle(ButtonStyle.Secondary),
    );
  }
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons)];
}

const CHUNK_LIMIT = 1500;

async function buildCompletionComponents(
  userId: string,
  page: number,
  year: number | "unknown" | null,
  interactionUser: User,
  query?: string,
): Promise<{
  containers: ContainerBuilder[];
  total: number;
  totalPages: number;
  safePage: number;
  pageCompletions: any[];
  sortedYears: string[];
  yearCounts: Record<string, number>;
} | null> {
  const total = await Member.countCompletions(userId, year, query);
  if (total === 0) return null;

  const totalPages = Math.max(1, Math.ceil(total / COMPLETION_PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const offset = safePage * COMPLETION_PAGE_SIZE;

  const allCompletions = await Member.getCompletions({
    userId,
    limit: 1000,
    offset: 0,
    year,
    title: query,
  });
  const platforms = await Game.getAllPlatforms();
  const platformMap = new Map(
    platforms.map((platform) => [platform.id, platform.abbreviation ?? platform.name]),
  );

  allCompletions.sort((a, b) => {
    const yearA = a.completedAt ? a.completedAt.getFullYear() : null;
    const yearB = b.completedAt ? b.completedAt.getFullYear() : null;

    if (yearA == null && yearB == null) return a.title.localeCompare(b.title);
    if (yearA == null) return 1;
    if (yearB == null) return -1;
    if (yearA !== yearB) return yearB - yearA;

    const dateA = a.completedAt ? a.completedAt.getTime() : 0;
    const dateB = b.completedAt ? b.completedAt.getTime() : 0;
    return dateA - dateB;
  });

  if (!allCompletions.length) return null;

  const pageCompletions = allCompletions.slice(offset, offset + COMPLETION_PAGE_SIZE);

  const buildEntryLine = (c: (typeof pageCompletions)[number], num: number): string => {
    const typeAbbrev =
      c.completionType === "Main Story"
        ? "M"
        : c.completionType === "Main Story + Side Content"
          ? "M+S"
          : "C";
    const rawPlatformName =
      c.platformId == null ? null : platformMap.get(c.platformId) ?? "Unknown Platform";
    const platformName = formatPlatformDisplayName(rawPlatformName);
    const platformLabel = platformName ? ` [${platformName}]` : "";
    const dateLabel = c.completedAt ? ` · ${formatTableDate(c.completedAt)}` : "";
    const hoursLabel = c.finalPlaytimeHours != null ? ` · ${c.finalPlaytimeHours} hrs` : "";
    return `${num}. **${c.title}**${platformLabel} (${typeAbbrev})${dateLabel}${hoursLabel}`;
  };

  const pushChunked = (containers: ContainerBuilder[], lines: string[]): void => {
    let buffer = "";
    for (const line of lines) {
      const next = buffer ? `${buffer}\n${line}` : line;
      if (next.length > CHUNK_LIMIT) {
        containers.push(
          new ContainerBuilder().addTextDisplayComponents(
            new TextDisplayBuilder().setContent(buffer),
          ),
        );
        buffer = line;
      } else {
        buffer = next;
      }
    }
    if (buffer) {
      containers.push(
        new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent(buffer),
        ),
      );
    }
  };

  const queryLabel = query?.trim();
  const containers: ContainerBuilder[] = [];

  const knownYears = allCompletions
    .map((c) => c.completedAt?.getFullYear())
    .filter((y): y is number => y != null);
  const minYear = knownYears.length ? Math.min(...knownYears) : null;
  const maxYear = knownYears.length ? Math.max(...knownYears) : null;

  const footerLines = [
    "-# M = Main Story • M+S = Main Story + Side Content • C = Completionist",
  ];
  if (totalPages > 1) {
    let resultsText = `${total} results`;
    if (minYear !== null && maxYear !== null) {
      resultsText +=
        minYear === maxYear
          ? ` recorded in ${minYear}`
          : ` recorded between ${minYear}-${maxYear}`;
    }
    footerLines.push(`-# ${resultsText}. Page ${safePage + 1} of ${totalPages}.`);
  }

  let sortedYears: string[] = [];
  const yearCounts: Record<string, number> = {};

  if (queryLabel) {
    containers.push(
      new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# Query: "${queryLabel}"`),
      ),
    );
    const lines = pageCompletions.map((c, i) => buildEntryLine(c, offset + i + 1));
    pushChunked(containers, lines);
  } else {
    const yearIndices = new Map<number, number>();
    for (const c of allCompletions) {
      const yr = c.completedAt ? String(c.completedAt.getFullYear()) : "Unknown";
      yearCounts[yr] = (yearCounts[yr] ?? 0) + 1;
      yearIndices.set(c.completionId, yearCounts[yr]);
    }

    const grouped = pageCompletions.reduce<Record<string, string[]>>((acc, c) => {
      const yr = c.completedAt ? String(c.completedAt.getFullYear()) : "Unknown";
      acc[yr] = acc[yr] || [];
      acc[yr].push(buildEntryLine(c, yearIndices.get(c.completionId)!));
      return acc;
    }, {});

    sortedYears = Object.keys(yearCounts).sort((a, b) => {
      if (a === "Unknown") return 1;
      if (b === "Unknown") return -1;
      return Number(b) - Number(a);
    });

    for (const yr of sortedYears) {
      if (!grouped[yr]) continue;
      const displayYear = yr === "Unknown" ? "Unknown Date" : yr;
      const count = yearCounts[yr] ?? 0;
      const gameWord = count === 1 ? "Game" : "Games";
      const heading = `### ${displayYear} (${count} ${gameWord} Completed)`;
      pushChunked(containers, [heading, ...(grouped[yr] ?? [])]);
    }
  }

  containers.push(
    new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(footerLines.join("\n")),
    ),
  );

  return { containers, total, totalPages, safePage, pageCompletions, sortedYears, yearCounts };
}
