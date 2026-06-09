import {
  MessageFlags,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { renderCompletionPage, renderSelectionPage } from "./completion-list.service.js";
import { ContainerBuilder, TextDisplayBuilder } from "@discordjs/builders";
import Member from "../../classes/Member.js";
import { buildJournalView } from "../../functions/journalView.js";
import {
  ephemeralFlag,
  replyIfNotOwner,
  safeDeferReply,
  safeDeferUpdate,
  safeDeferUpdateOrBail,
  safeReply,
} from "../../functions/InteractionUtils.js";
import {
  buildComponentsV2Flags,
  buildTextReply,
  safeV2TextContent,
} from "../../functions/ComponentsV2Utils.js";

/**
 * Parses a year filter string into a number, "unknown", or null
 */
export function parseCompletionYearFilter(yearRaw: string): number | "unknown" | null {
  if (!yearRaw) return null;
  if (yearRaw.toLowerCase() === "unknown") return "unknown";
  const parsed = Number(yearRaw);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Handles page selection from dropdown menu for list, edit, or delete modes
 */
export async function handleCompletionPageSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const parts = interaction.customId.split(":");
  const ownerId = parts[1];
  const yearRaw = parts[2];
  const mode = parts[3] as "list" | "edit" | "delete";
  const query = parts.slice(4).join(":") || undefined;

  if (mode !== "list" && await replyIfNotOwner(interaction, ownerId)) return;

  const page = Number(interaction.values[0]);
  if (Number.isNaN(page)) return;
  const year = parseCompletionYearFilter(yearRaw);
  const ephemeral = interaction.message?.flags?.has(MessageFlags.Ephemeral) ?? true;

  if (!await safeDeferUpdateOrBail(interaction)) return;

  if (mode === "list") {
    await renderCompletionPage(
      interaction,
      ownerId,
      page,
      year,
      ephemeral,
      query,
    );
  } else {
    await renderSelectionPage(interaction, ownerId, page, mode, year, query);
  }
}

/**
 * Handles prev/next button clicks for list, edit, or delete pagination
 */
export async function handleCompletionPaging(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split(":");
  const mode = parts[0].split("-")[1] as "list" | "edit" | "delete";
  const ownerId = parts[1];
  const yearRaw = parts[2];
  const pageRaw = parts[3];
  const dir = parts[4];
  const query = parts.slice(5).join(":") || undefined;

  if (mode !== "list" && await replyIfNotOwner(interaction, ownerId)) return;
  const page = Number(pageRaw);
  if (Number.isNaN(page)) return;
  const nextPage = dir === "next" ? page + 1 : Math.max(page - 1, 0);
  const year = parseCompletionYearFilter(yearRaw);
  const ephemeral = interaction.message?.flags?.has(MessageFlags.Ephemeral) ?? true;

  if (!await safeDeferUpdateOrBail(interaction)) return;

  if (mode === "list") {
    await renderCompletionPage(
      interaction,
      ownerId,
      nextPage,
      year,
      ephemeral,
      query,
    );
  } else {
    await renderSelectionPage(interaction, ownerId, nextPage, mode, year, query);
  }
}

async function openCompletionJournalView(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  ownerId: string,
  gameId: number,
  page: number,
): Promise<void> {
  const statuses = await Member.getJournalStatusForGames(ownerId, [gameId]);
  const status = statuses[0];
  if ((status?.journalCount ?? 0) === 0) {
    await safeReply(interaction, buildTextReply("This game has no journal entries.", true));
    return;
  }
  const ephemeral = interaction.message?.flags?.has(MessageFlags.Ephemeral) ?? true;
  const payload = await buildJournalView({
    ownerId,
    viewerId: interaction.user.id,
    gameId,
    page,
    guildId: interaction.guildId,
    prevPageCustomId: (p) => `comp-journal-page:${ownerId}:${gameId}:prev:${p}`,
    nextPageCustomId: (p) => `comp-journal-page:${ownerId}:${gameId}:next:${p}`,
  });
  await safeReply(interaction, {
    components: payload.components,
    files: payload.files,
    flags: buildComponentsV2Flags(ephemeral),
    allowedMentions: payload.allowedMentions,
  });
}

/**
 * Handles journal select menu on the completion list - opens the journal for the selected game
 */
export async function handleCompletionJournalViewSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const parts = interaction.customId.split(":");
  const ownerId = parts[1];
  const gameId = Number(interaction.values[0]);
  if (!gameId) return;
  const firstPage = 1;
  await openCompletionJournalView(interaction, ownerId, gameId, firstPage);
}

/**
 * Handles prev/next page buttons inside a completion-list journal view
 */
export async function handleCompletionJournalPage(
  interaction: ButtonInteraction,
): Promise<void> {
  const [, ownerId, gameIdRaw, , pageRaw] = interaction.customId.split(":");
  const gameId = Number(gameIdRaw);
  const page = Number(pageRaw);
  if (!gameId || Number.isNaN(page)) return;
  await openCompletionJournalView(interaction, ownerId, gameId, page);
}

const COMPLETION_HELP_TEXT = [
  "## Game Completion Commands",
  "**/game-completion add**  -  Add a game completion",
  "**/game-completion edit**  -  Edit one of your completion records",
  "**/game-completion delete**  -  Delete one of your completion records",
  "**/game-completion export**  -  Export your completions to a CSV file",
  "**/game-completion import-completionator**  -  Import completions from a Completionator CSV",
  "**/game-completion common**  -  Show shared completions between two members",
].join("\n");

/**
 * Handles the header button click for the owner of a completion list
 */
export async function handleCompletionListHeader(
  interaction: ButtonInteraction,
): Promise<void> {
  const parts = interaction.customId.split(":");
  const ownerId = parts[1];
  if (interaction.user.id !== ownerId) {
    await safeDeferUpdate(interaction).catch(() => {});
    return;
  }
  await safeReply(interaction, {
    components: [
      new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(safeV2TextContent(COMPLETION_HELP_TEXT, 1000)),
      ),
    ],
    flags: buildComponentsV2Flags(true),
  });
}

/**
 * Handles the "Clear Filter" button that removes the active year filter
 */
export async function handleCompletionClearYearFilter(
  interaction: ButtonInteraction,
): Promise<void> {
  const parts = interaction.customId.split(":");
  const userId = parts[1];
  const ephemeral = interaction.message?.flags?.has(MessageFlags.Ephemeral) ?? true;

  if (!await safeDeferUpdateOrBail(interaction)) return;

  const firstPage = 0;
  const noYearFilter = null;
  await renderCompletionPage(interaction, userId, firstPage, noYearFilter, ephemeral);
}

/**
 * Handles year-jump select menu on the completion list
 */
export async function handleCompletionYearSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const parts = interaction.customId.split(":");
  const userId = parts[1];
  const selectedYear = interaction.values[0];
  const year = parseCompletionYearFilter(selectedYear);
  const ephemeral = interaction.message?.flags?.has(MessageFlags.Ephemeral) ?? true;

  if (!await safeDeferUpdateOrBail(interaction)) return;

  const firstPage = 0;
  await renderCompletionPage(interaction, userId, firstPage, year, ephemeral);
}

/**
 * Handles leaderboard member selection to view their completions
 */
export async function handleCompletionLeaderboardSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const parts = interaction.customId.split(":");
  const query = parts.slice(1).join(":") || undefined;
  const userId = interaction.values[0];
  const ephemeral = interaction.message?.flags?.has(MessageFlags.Ephemeral) ?? true;
  await safeDeferReply(interaction, { flags: ephemeralFlag(ephemeral) });
  const firstPage = 0;
  const noYearFilter = null;
  await renderCompletionPage(interaction, userId, firstPage, noYearFilter, ephemeral, query);
}
