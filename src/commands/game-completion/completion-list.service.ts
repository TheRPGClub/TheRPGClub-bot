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
import { shouldRenderPrevNextButtons } from "../../functions/PaginationUtils.js";
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

  const { containers, totalPages, safePage } = result;
  const yearPart = year == null ? "" : String(year);
  const queryPart = query ? `:${query.slice(0, 50)}` : "";
  const paginationRows = buildPaginationRows(
    totalPages,
    safePage,
    `comp-page-select:${userId}:${yearPart}:list${queryPart}`,
    `comp-list-page:${userId}:${yearPart}:${safePage}:prev${queryPart}`,
    `comp-list-page:${userId}:${yearPart}:${safePage}:next${queryPart}`,
  );

  const displayName = user.displayName ?? user.username ?? user.id;
  const header = buildUserHeaderContainer(userId, displayName, "Completed Games");

  await safeReply(interaction as any, {
    components: [header, ...containers, ...paginationRows],
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
    `comp-page-select:${userId}:${yearPart}:${mode}${queryPart}`,
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

type PaginationRow =
  | ActionRowBuilder<StringSelectMenuBuilder>
  | ActionRowBuilder<ButtonBuilder>;

function buildPaginationRows(
  totalPages: number,
  safePage: number,
  selectCustomId: string,
  prevCustomId: string,
  nextCustomId: string,
): PaginationRow[] {
  if (totalPages <= 1) return [];

  const maxOptions = 25;
  let startPage = 0;
  let endPage = totalPages - 1;

  if (totalPages > maxOptions) {
    const half = Math.floor(maxOptions / 2);
    startPage = Math.max(0, safePage - half);
    endPage = Math.min(totalPages - 1, startPage + maxOptions - 1);
    startPage = Math.max(0, endPage - maxOptions + 1);
  }

  const options: { label: string; value: string; default: boolean }[] = [];
  for (let i = startPage; i <= endPage; i++) {
    options.push({ label: `Page ${i + 1}`, value: String(i), default: i === safePage });
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(selectCustomId)
    .setPlaceholder(`Page ${safePage + 1} of ${totalPages}`)
    .addOptions(options);

  const rows: PaginationRow[] = [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
  ];

  const prevDisabled = safePage <= 0;
  const nextDisabled = safePage >= totalPages - 1;

  if (shouldRenderPrevNextButtons(prevDisabled, nextDisabled)) {
    const prev = new ButtonBuilder()
      .setCustomId(prevCustomId)
      .setLabel("Previous")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(prevDisabled);
    const next = new ButtonBuilder()
      .setCustomId(nextCustomId)
      .setLabel("Next")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(nextDisabled);
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(prev, next));
  }

  return rows;
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

  const yearCounts: Record<string, number> = {};
  const yearIndices = new Map<number, number>();

  for (const c of allCompletions) {
    const yr = c.completedAt ? String(c.completedAt.getFullYear()) : "Unknown";
    yearCounts[yr] = (yearCounts[yr] ?? 0) + 1;
    yearIndices.set(c.completionId, yearCounts[yr]);
  }

  const pageCompletions = allCompletions.slice(offset, offset + COMPLETION_PAGE_SIZE);
  const dateWidth = 10;
  const maxIndexLabelLength =
    String(Math.max(...pageCompletions.map((c) => yearIndices.get(c.completionId) ?? 0)))
      .length + 1;

  const grouped = pageCompletions.reduce<Record<string, string[]>>((acc, c) => {
    const yr = c.completedAt ? String(c.completedAt.getFullYear()) : "Unknown";
    acc[yr] = acc[yr] || [];

    const yearIdx = yearIndices.get(c.completionId)!;
    const idxLabelRaw = `${yearIdx}.`;
    const idxLabel = idxLabelRaw.padStart(maxIndexLabelLength, " ");
    const dateLabel = c.completedAt
      ? formatTableDate(c.completedAt).padStart(dateWidth, " ")
      : "";

    const typeAbbrev =
      c.completionType === "Main Story"
        ? "M"
        : c.completionType === "Main Story + Side Content"
          ? "M+S"
          : "C";

    const idxBlock = `\`${idxLabel}\``;
    const dateBlock = dateLabel ? `\`${dateLabel}\`` : "";
    const rawPlatformName =
      c.platformId == null ? null : platformMap.get(c.platformId) ?? "Unknown Platform";
    const platformName = formatPlatformDisplayName(rawPlatformName);
    const platformLabel = platformName ? ` [${platformName}]` : "";
    const line = `${idxBlock} ${dateBlock} **${c.title}**${platformLabel} (${typeAbbrev})`.replace(
      /\s{2,}/g,
      " ",
    );
    acc[yr].push(line);
    if (c.note) {
      acc[yr].push(`> ${c.note}`);
    }
    return acc;
  }, {});

  const sortedYears = Object.keys(grouped).sort((a, b) => {
    if (a === "Unknown") return 1;
    if (b === "Unknown") return -1;
    return Number(b) - Number(a);
  });

  const containers: ContainerBuilder[] = [];

  const queryLabel = query?.trim();
  if (queryLabel) {
    containers.push(
      new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# Filter: "${queryLabel}"`),
      ),
    );
  }

  for (const yr of sortedYears) {
    const displayYear = yr === "Unknown" ? "Unknown Date" : yr;
    const count = yearCounts[yr] ?? 0;
    const lines = grouped[yr] ?? [];

    let buffer = `### ${displayYear} (${count})`;
    for (const line of lines) {
      const next = `${buffer}\n${line}`;
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
  }

  const footerLines = [
    "-# M = Main Story • M+S = Main Story + Side Content • C = Completionist",
  ];
  if (totalPages > 1) {
    footerLines.push(`-# ${total} results. Page ${safePage + 1} of ${totalPages}.`);
  }
  containers.push(
    new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(footerLines.join("\n")),
    ),
  );

  return { containers, total, totalPages, safePage, pageCompletions };
}
