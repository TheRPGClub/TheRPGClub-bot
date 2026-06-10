import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { buildActionButton, buildButtonRow } from "./uiComponents.js";

export function buildPageFooterText(page: number, totalPages: number, suffix?: string): string {
  const base = `Page ${page + 1}/${totalPages}`;
  return suffix ? `${base} • ${suffix}` : base;
}

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
    buttons.push(buildActionButton({ customId: `${customIdBase}:${page}:prev`, label: "Previous", style: ButtonStyle.Secondary }));
  }
  if (page < totalPages - 1) {
    buttons.push(buildActionButton({ customId: `${customIdBase}:${page}:next`, label: "Next", style: ButtonStyle.Secondary }));
  }
  if (!buttons.length) return null;
  return buildButtonRow(...buttons);
}

/**
 * Builds a Previous / Next button row using explicit customIds, omitting
 * whichever buttons are disabled. Returns null when there is only one page
 * or neither button would be shown.
 */
export function buildOptionalPrevNextRowWithIds(
  prevCustomId: string,
  nextCustomId: string,
  page: number,
  totalPages: number,
  labels?: { prev?: string; next?: string },
): ActionRowBuilder<ButtonBuilder> | null {
  if (totalPages <= 1) return null;
  const buttons: ButtonBuilder[] = [];
  if (page > 0) {
    buttons.push(buildActionButton({ customId: prevCustomId, label: labels?.prev ?? "Previous", style: ButtonStyle.Secondary }));
  }
  if (page < totalPages - 1) {
    buttons.push(buildActionButton({ customId: nextCustomId, label: labels?.next ?? "Next", style: ButtonStyle.Secondary }));
  }
  if (!buttons.length) return null;
  return buildButtonRow(...buttons);
}

/**
 * Builds a Previous / Next button row where both buttons are always included
 * but disabled at the boundary pages. Uses the customIdBase+`:${page}:prev|next`
 * suffix convention. Returns null when there is only one page.
 */
export function buildDisabledPrevNextRow(
  customIdBase: string,
  page: number,
  totalPages: number,
  labels?: { prev?: string; next?: string },
): ActionRowBuilder<ButtonBuilder> | null {
  if (totalPages <= 1) return null;
  const prevDisabled = page <= 0;
  const nextDisabled = page >= totalPages - 1;
  if (!shouldRenderPrevNextButtons(prevDisabled, nextDisabled)) return null;
  return buildButtonRow(
    buildActionButton({ customId: `${customIdBase}:${page}:prev`, label: labels?.prev ?? "Previous", style: ButtonStyle.Secondary }).setDisabled(prevDisabled),
    buildActionButton({ customId: `${customIdBase}:${page}:next`, label: labels?.next ?? "Next", style: ButtonStyle.Secondary }).setDisabled(nextDisabled),
  );
}

/**
 * Builds a Previous / Next button row using explicit customIds where both
 * buttons are always included but disabled at the boundary pages. Returns null
 * when there is only one page.
 */
export function buildDisabledPrevNextRowWithIds(
  prevCustomId: string,
  nextCustomId: string,
  page: number,
  totalPages: number,
  options?: {
    labels?: { prev?: string; next?: string };
    styles?: { prev?: ButtonStyle; next?: ButtonStyle };
  },
): ActionRowBuilder<ButtonBuilder> | null {
  if (totalPages <= 1) return null;
  const prevDisabled = page <= 0;
  const nextDisabled = page >= totalPages - 1;
  if (!shouldRenderPrevNextButtons(prevDisabled, nextDisabled)) return null;
  return buildButtonRow(
    buildActionButton({ customId: prevCustomId, label: options?.labels?.prev ?? "Previous", style: options?.styles?.prev ?? ButtonStyle.Secondary }).setDisabled(prevDisabled),
    buildActionButton({ customId: nextCustomId, label: options?.labels?.next ?? "Next", style: options?.styles?.next ?? ButtonStyle.Secondary }).setDisabled(nextDisabled),
  );
}
