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
 * Builds a Previous / Next button row, omitting whichever buttons are disabled.
 * Returns null when neither button would be enabled (i.e. single page).
 * customIdBase should include all session/owner segments; page and direction
 * are appended as `:${page}:prev` / `:${page}:next`.
 */
export function buildOptionalPrevNextRow(
  customIdBase: string,
  page: number,
  totalPages: number,
): ActionRowBuilder<ButtonBuilder> | null {
  const buttons: ButtonBuilder[] = [];
  if (page > 0) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`${customIdBase}:${page}:prev`)
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary),
    );
  }
  if (page < totalPages - 1) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`${customIdBase}:${page}:next`)
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary),
    );
  }
  if (!buttons.length) return null;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
}
