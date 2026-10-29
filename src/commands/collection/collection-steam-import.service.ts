import axios from "axios";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import type { ISteamImportIgdbCandidate } from "../../classes/SteamCollectionImport.js";
import { buildActionButton, buildButtonRow } from "../../functions/uiComponents.js";
import { buildImportReasonSummary } from "./collection-import-ui.utils.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";
import { parseCustomIdSegments } from "../../utilities/CustomIdUtils.js";
import { truncateLabel } from "../../config/textLimits.js";
import { isOpenImportConflict } from "../../utilities/ApiErrorUtils.js";
import type { IgdbSelectOption } from "../../services/IGDB/IgdbSelectService.js";

export type CollectionSteamImportButtonAction = "skip" | "remap" | "game-id" | "pause";

/**
 * Each advance call auto-applies up to 25 exact matches, so a very large library needs
 * many calls before the first item that needs a person. Past this many calls the review
 * stops and asks the member to resume.
 */
export const STEAM_IMPORT_MAX_ADVANCE_CALLS = 40;

const STEAM_IMPORT_ERROR_MESSAGES: Record<string, string> = {
  invalid_identifier:
    "That is not a Steam profile. Use a profile URL, a vanity name, or a SteamID64.",
  private_profile:
    "That Steam profile or its game details are private. Make them public and try again.",
  api_unavailable: "Steam could not be reached. Try again in a few minutes.",
  api_unauthorized: "Steam rejected the server's request. Try again later.",
  api_rate_limited: "Steam is rate limiting requests. Wait a few minutes and try again.",
  steam_not_configured: "Steam imports are not set up on the server yet.",
  import_not_active: "This Steam import is no longer active.",
  item_not_pending: "This import row is no longer pending.",
  game_not_found: "Could not find that game in GameDB.",
  igdb_game_not_found: "Could not find that game on IGDB.",
  game_id_or_igdb_id_required: "Enter a GameDB or IGDB ID.",
  invalid_igdb_id: "That is not a valid IGDB ID.",
  igdb_not_configured: "IGDB lookups are not set up on the server yet.",
  igdb_request_failed: "IGDB could not be reached. Try again in a few minutes.",
  title_required: "Enter a title to search for.",
};

const STEAM_IMPORT_OPEN_IMPORT_MESSAGE =
  "You already have an open Steam import. " +
  "Use action:resume, action:status, action:pause, or action:cancel.";

/** The `error` code the API puts in a failed response body, if there is one. */
export function getSteamImportErrorCode(error: unknown): string | null {
  if (!axios.isAxiosError(error)) return null;
  const code = (error.response?.data as { error?: unknown } | undefined)?.error;
  return typeof code === "string" && code.trim() ? code.trim() : null;
}

/**
 * A short reason for an API failure the member can act on, or null for anything
 * unexpected. The one-open-import-per-kind rule has no error code, only message text.
 */
export function describeSteamImportError(error: unknown): string | null {
  const code = getSteamImportErrorCode(error);
  if (code && STEAM_IMPORT_ERROR_MESSAGES[code]) return STEAM_IMPORT_ERROR_MESSAGES[code];
  if (isOpenImportConflict(error)) return STEAM_IMPORT_OPEN_IMPORT_MESSAGE;
  return null;
}

export function buildSteamHeaderImageUrl(steamAppId: number): string {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${steamAppId}/header.jpg`;
}

export function buildSteamIgdbSelectOptions(
  candidates: ISteamImportIgdbCandidate[],
): IgdbSelectOption[] {
  return candidates.slice(0, 50).map((candidate) => {
    const year = candidate.firstReleaseDate
      ? candidate.firstReleaseDate.getFullYear()
      : "TBD";
    const summary = (candidate.summary ?? "No summary").replace(/\s+/g, " ").trim();
    return {
      id: candidate.igdbId,
      label: truncateLabel(`${candidate.name} (${year})`),
      description: truncateLabel(summary),
    };
  });
}

export const STEAM_IMPORT_ACTION_PREFIX = "collection-steam-import-v1";
export const STEAM_CHOOSE_PREFIX = "collection-steam-choose-v1";
export const STEAM_REMAP_MODAL_PREFIX = "collection-steam-remap-v1";
export const STEAM_REMAP_INPUT_ID = "collection-steam-remap-title";
export const STEAM_GAME_ID_MODAL_PREFIX = "collection-steam-game-id-v1";
export const STEAM_GAME_ID_INPUT_ID = "collection-steam-game-id";

export const STEAM_IMPORT_REASON_LABELS: Record<string, string> = {
  DUPLICATE: "duplicate",
  MANUAL_SKIP: "manual-skip",
  SKIP_MAPPED: "mapped-skip",
  ADD_FAILED: "add-failed",
  PLATFORM_UNRESOLVED: "platform-unresolved",
  NO_CANDIDATE: "no-candidate",
};

export function buildCollectionSteamImportActionId(params: {
  ownerId: string;
  importId: number;
  itemId: number;
  action: CollectionSteamImportButtonAction;
}): string {
  const actionCode = params.action === "skip"
    ? "s"
    : params.action === "remap"
      ? "r"
      : params.action === "game-id"
        ? "i"
      : "p";
  return [
    STEAM_IMPORT_ACTION_PREFIX,
    params.ownerId,
    String(params.importId),
    String(params.itemId),
    actionCode,
  ].join(":");
}

export function parseCollectionSteamImportActionId(customId: string): {
  ownerId: string;
  importId: number;
  itemId: number;
  action: CollectionSteamImportButtonAction;
} | null {
  if (!customId.startsWith(`${STEAM_IMPORT_ACTION_PREFIX}:`)) return null;
  const segs = parseCustomIdSegments(customId, 4);
  if (!segs) return null;
  const [ownerId, importIdStr, itemIdStr, actionCode] = segs;

  const importId = Number(importIdStr);
  const itemId = Number(itemIdStr);
  if (!isPositiveInt(importId)) return null;
  if (!isPositiveInt(itemId)) return null;

  const action = actionCode === "s"
    ? "skip"
    : actionCode === "r"
      ? "remap"
      : actionCode === "i"
        ? "game-id"
      : actionCode === "p"
        ? "pause"
        : null;
  if (!action) return null;

  return { ownerId, importId, itemId, action };
}

export function buildCollectionSteamChooseId(params: {
  ownerId: string;
  importId: number;
  itemId: number;
  gameId: number;
}): string {
  return [
    STEAM_CHOOSE_PREFIX,
    params.ownerId,
    String(params.importId),
    String(params.itemId),
    String(params.gameId),
  ].join(":");
}

export function parseCollectionSteamChooseId(customId: string): {
  ownerId: string;
  importId: number;
  itemId: number;
  gameId: number;
} | null {
  if (!customId.startsWith(`${STEAM_CHOOSE_PREFIX}:`)) return null;
  const segs = parseCustomIdSegments(customId, 4);
  if (!segs) return null;
  const [ownerId, importIdStr, itemIdStr, gameIdStr] = segs;
  const importId = Number(importIdStr);
  const itemId = Number(itemIdStr);
  const gameId = Number(gameIdStr);
  if (!isPositiveInt(importId)) return null;
  if (!isPositiveInt(itemId)) return null;
  if (!isPositiveInt(gameId)) return null;
  return { ownerId, importId, itemId, gameId };
}

export function buildCollectionSteamRemapModalId(params: {
  ownerId: string;
  importId: number;
  itemId: number;
}): string {
  return [
    STEAM_REMAP_MODAL_PREFIX,
    params.ownerId,
    String(params.importId),
    String(params.itemId),
  ].join(":");
}

export function parseCollectionSteamRemapModalId(customId: string): {
  ownerId: string;
  importId: number;
  itemId: number;
} | null {
  if (!customId.startsWith(`${STEAM_REMAP_MODAL_PREFIX}:`)) return null;
  const segs = parseCustomIdSegments(customId, 3);
  if (!segs) return null;
  const [ownerId, importIdStr, itemIdStr] = segs;
  const importId = Number(importIdStr);
  const itemId = Number(itemIdStr);
  if (!isPositiveInt(importId)) return null;
  if (!isPositiveInt(itemId)) return null;

  return { ownerId, importId, itemId };
}

export function buildCollectionSteamGameIdModalId(params: {
  ownerId: string;
  importId: number;
  itemId: number;
}): string {
  return [
    STEAM_GAME_ID_MODAL_PREFIX,
    params.ownerId,
    String(params.importId),
    String(params.itemId),
  ].join(":");
}

export function parseCollectionSteamGameIdModalId(customId: string): {
  ownerId: string;
  importId: number;
  itemId: number;
} | null {
  if (!customId.startsWith(`${STEAM_GAME_ID_MODAL_PREFIX}:`)) return null;
  const segs = parseCustomIdSegments(customId, 3);
  if (!segs) return null;
  const [ownerId, importIdStr, itemIdStr] = segs;
  const importId = Number(importIdStr);
  const itemId = Number(itemIdStr);
  if (!isPositiveInt(importId)) return null;
  if (!isPositiveInt(itemId)) return null;
  return { ownerId, importId, itemId };
}

export function buildSteamImportItemMessage(params: {
  importId: number;
  rowIndex: number;
  totalCount: number;
  steamAppName: string;
  steamAppId: number;
}): string {
  const steamStoreUrl = `https://store.steampowered.com/app/${params.steamAppId}/`;
  return (
    `## Steam Import #${params.importId}\n` +
    `Row ${params.rowIndex}/${params.totalCount}\n` +
    `Steam: **${params.steamAppName}**\n` +
    `[Open in Steam Store](${steamStoreUrl})`
  );
}

export function buildSteamImportItemButtons(params: {
  ownerId: string;
  importId: number;
  itemId: number;
}): ActionRowBuilder<ButtonBuilder> {
  const base = { ownerId: params.ownerId, importId: params.importId, itemId: params.itemId };
  return buildButtonRow(
    buildActionButton({
      customId: buildCollectionSteamImportActionId({ ...base, action: "remap" }),
      label: "Search a different title",
      style: ButtonStyle.Primary,
    }),
    buildActionButton({
      customId: buildCollectionSteamImportActionId({ ...base, action: "game-id" }),
      label: "Enter GameDB or IGDB ID",
      style: ButtonStyle.Secondary,
    }),
    buildActionButton({
      customId: buildCollectionSteamImportActionId({ ...base, action: "skip" }),
      label: "Skip",
      style: ButtonStyle.Secondary,
    }),
    buildActionButton({
      customId: buildCollectionSteamImportActionId({ ...base, action: "pause" }),
      label: "Pause",
      style: ButtonStyle.Danger,
    }),
  );
}

export function logSteamImportEvent(
  message: string,
  meta: Record<string, string | number>,
): void {
  const entries = Object.entries(meta).map(([key, value]) => `${key}=${value}`);
  console.info(`[SteamImport] ${message} ${entries.join(" ")}`.trim());
}

export function buildSteamImportReasonSummary(reasonCounts: Record<string, number>): string[] {
  return buildImportReasonSummary(reasonCounts, STEAM_IMPORT_REASON_LABELS);
}
