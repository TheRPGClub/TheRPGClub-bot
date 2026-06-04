import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

export function shouldRenderPrevNextButtons(
  prevDisabled: boolean,
  nextDisabled: boolean,
): boolean {
  return !(prevDisabled && nextDisabled);
}

export type PageDirection = "prev" | "next";

/**
 * Parses a page number and direction from customId parts.
 * Returns null if the page is not a valid integer or direction is unrecognized.
 */
export function parseDirAndPage(
  pageRaw: string,
  dir: string,
): { page: number; nextPage: number } | null {
  const page = Number(pageRaw);
  if (Number.isNaN(page)) return null;
  const delta = dir === "next" ? 1 : -1;
  const nextPage = Math.max(page + delta, 0);
  return { page, nextPage };
}

/**
 * Builds a Previous / Next button row for paginated embeds.
 * customIdBase should already include all session/owner segments; page and
 * direction are appended as `:${page}:prev` / `:${page}:next`.
 */
export function buildPrevNextRow(
  customIdBase: string,
  page: number,
  totalPages: number,
): ActionRowBuilder<ButtonBuilder> {
  const prevDisabled = page <= 0;
  const nextDisabled = page >= totalPages - 1;
  const prevButton = new ButtonBuilder()
    .setCustomId(`${customIdBase}:${page}:prev`)
    .setLabel("Previous")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(prevDisabled);
  const nextButton = new ButtonBuilder()
    .setCustomId(`${customIdBase}:${page}:next`)
    .setLabel("Next")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(nextDisabled);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(prevButton, nextButton);
}
