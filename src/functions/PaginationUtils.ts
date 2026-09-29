import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { ContainerBuilder } from "@discordjs/builders";
import { buildActionButton, buildButtonRow, buildUserHeaderContainer } from "./uiComponents.js";
import { buildTextContainer, safeV2TextContent } from "./ComponentsV2Utils.js";
import {
  encodeVisibility,
  decodeVisibility,
  parseCustomIdSegments,
} from "../utilities/CustomIdUtils.js";

export const PAGE_PREV_LABEL = "Previous";
export const PAGE_NEXT_LABEL = "Next";

export type PrevNextLabels = { prev?: string; next?: string };

export function buildPageFooterText(page: number, totalPages: number, suffix?: string): string {
  const base = `Page ${page + 1}/${totalPages}`;
  return suffix ? `${base} • ${suffix}` : base;
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
  return buildOptionalPrevNextRowWithIds(
    `${customIdBase}:${page}:prev`,
    `${customIdBase}:${page}:next`,
    page,
    totalPages,
  );
}

/**
 * Builds the Previous / Next buttons for a page, omitting whichever would be
 * disabled. Returns an empty array when there is only one page. Use this when
 * the buttons share a row with other controls.
 */
export function buildPrevNextButtons(
  prevCustomId: string,
  nextCustomId: string,
  page: number,
  totalPages: number,
  labels?: PrevNextLabels,
): ButtonBuilder[] {
  if (totalPages <= 1) return [];
  const buttons: ButtonBuilder[] = [];
  if (page > 0) {
    buttons.push(buildActionButton({
      customId: prevCustomId,
      label: labels?.prev ?? PAGE_PREV_LABEL,
      style: ButtonStyle.Secondary,
    }));
  }
  if (page < totalPages - 1) {
    buttons.push(buildActionButton({
      customId: nextCustomId,
      label: labels?.next ?? PAGE_NEXT_LABEL,
      style: ButtonStyle.Secondary,
    }));
  }
  return buttons;
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
  labels?: PrevNextLabels,
): ActionRowBuilder<ButtonBuilder> | null {
  const buttons = buildPrevNextButtons(prevCustomId, nextCustomId, page, totalPages, labels);
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
  labels?: PrevNextLabels,
): ActionRowBuilder<ButtonBuilder> | null {
  return buildDisabledPrevNextRowWithIds(
    `${customIdBase}:${page}:prev`,
    `${customIdBase}:${page}:next`,
    page,
    totalPages,
    { labels },
  );
}

export function buildUserListNavId(
  prefix: string,
  params: {
    viewerUserId: string;
    targetUserId: string;
    page: number;
    isEphemeral: boolean;
    direction: "prev" | "next";
  },
): string {
  return [
    prefix,
    params.viewerUserId,
    params.targetUserId,
    String(params.page),
    encodeVisibility(params.isEphemeral),
    params.direction,
  ].join(":");
}

export function parseUserListNavId(
  prefix: string,
  customId: string,
): {
  viewerUserId: string;
  targetUserId: string;
  page: number;
  isEphemeral: boolean;
  direction: "prev" | "next";
} | null {
  if (!customId.startsWith(`${prefix}:`)) return null;
  const segs = parseCustomIdSegments(customId, 5);
  if (!segs) return null;
  const [viewerUserId, targetUserId, pageStr, visibility, direction] = segs;
  const page = Number(pageStr);
  if (!Number.isInteger(page) || page < 0) return null;
  const isEphemeral = decodeVisibility(visibility);
  if (isEphemeral === null) return null;
  if (direction !== "prev" && direction !== "next") return null;
  return { viewerUserId, targetUserId, page, isEphemeral, direction: direction as "prev" | "next" };
}

type DisabledPrevNextOptions = {
  labels?: PrevNextLabels;
  styles?: { prev?: ButtonStyle; next?: ButtonStyle };
};

/**
 * Builds the Previous / Next buttons for a page, keeping both and disabling
 * whichever is at a boundary. Returns an empty array when there is only one
 * page. Use this when the buttons share a row with other controls.
 */
export function buildDisabledPrevNextButtons(
  prevCustomId: string,
  nextCustomId: string,
  page: number,
  totalPages: number,
  options?: DisabledPrevNextOptions,
): ButtonBuilder[] {
  if (totalPages <= 1) return [];
  const prevDisabled = page <= 0;
  const nextDisabled = page >= totalPages - 1;
  return [
    buildActionButton({
      customId: prevCustomId,
      label: options?.labels?.prev ?? PAGE_PREV_LABEL,
      style: options?.styles?.prev ?? ButtonStyle.Secondary,
    }).setDisabled(prevDisabled),
    buildActionButton({
      customId: nextCustomId,
      label: options?.labels?.next ?? PAGE_NEXT_LABEL,
      style: options?.styles?.next ?? ButtonStyle.Secondary,
    }).setDisabled(nextDisabled),
  ];
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
  options?: DisabledPrevNextOptions,
): ActionRowBuilder<ButtonBuilder> | null {
  const buttons = buildDisabledPrevNextButtons(
    prevCustomId,
    nextCustomId,
    page,
    totalPages,
    options,
  );
  if (!buttons.length) return null;
  return buildButtonRow(...buttons);
}

export function buildPaginatedUserListResponse(params: {
  headerUserId: string;
  headerLabel: string;
  headerTitle: string;
  bodyText: string;
  footerParts: string[];
  prevCustomId: string;
  nextCustomId: string;
  page: number;
  pageCount: number;
  extraButtons?: ButtonBuilder[];
}): Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>> {
  const components: Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>> = [];
  components.push(
    buildUserHeaderContainer(params.headerUserId, params.headerLabel, params.headerTitle),
  );
  components.push(buildTextContainer(safeV2TextContent(params.bodyText, 3500)));
  components.push(buildTextContainer(safeV2TextContent(`-# ${params.footerParts.join(" | ")}`, 1000)));
  const row = buildDisabledPrevNextRowWithIds(
    params.prevCustomId,
    params.nextCustomId,
    params.page,
    params.pageCount,
  ) ?? buildButtonRow();
  if (params.extraButtons?.length) {
    row.addComponents(...params.extraButtons);
  }
  components.push(row);
  return components;
}
