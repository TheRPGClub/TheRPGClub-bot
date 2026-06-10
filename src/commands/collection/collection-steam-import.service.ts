import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { buildActionButton, buildButtonRow } from "../../functions/uiComponents.js";
import { buildImportReasonSummary } from "./collection-import-ui.utils.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";
import { parseCustomIdSegments } from "../../utilities/CustomIdUtils.js";

export type CollectionSteamImportButtonAction = "skip" | "remap" | "game-id" | "pause";

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
  INVALID_REMAP: "invalid-remap",
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
  steamReleaseYear: number | null;
}): string {
  const releaseText = params.steamReleaseYear ? ` | Release: ${params.steamReleaseYear}` : "";
  const steamStoreUrl = `https://store.steampowered.com/app/${params.steamAppId}/`;
  return (
    `## Steam Import #${params.importId}\n` +
    `Row ${params.rowIndex}/${params.totalCount}\n` +
    `Steam: **${params.steamAppName}**${releaseText}\n` +
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
