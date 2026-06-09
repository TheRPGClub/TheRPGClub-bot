import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { buildImportReasonSummary } from "./collection-import-ui.utils.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";

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
  const parts = customId.split(":");
  if (parts.length !== 5) return null;
  if (parts[0] !== STEAM_IMPORT_ACTION_PREFIX) return null;

  const importId = Number(parts[2]);
  const itemId = Number(parts[3]);
  if (!isPositiveInt(importId)) return null;
  if (!isPositiveInt(itemId)) return null;

  const actionCode = parts[4];
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

  return { ownerId: parts[1], importId, itemId, action };
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
  const parts = customId.split(":");
  if (parts.length !== 5) return null;
  if (parts[0] !== STEAM_CHOOSE_PREFIX) return null;
  const importId = Number(parts[2]);
  const itemId = Number(parts[3]);
  const gameId = Number(parts[4]);
  if (!isPositiveInt(importId)) return null;
  if (!isPositiveInt(itemId)) return null;
  if (!isPositiveInt(gameId)) return null;
  return { ownerId: parts[1], importId, itemId, gameId };
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
  const parts = customId.split(":");
  if (parts.length !== 4) return null;
  if (parts[0] !== STEAM_REMAP_MODAL_PREFIX) return null;

  const importId = Number(parts[2]);
  const itemId = Number(parts[3]);
  if (!isPositiveInt(importId)) return null;
  if (!isPositiveInt(itemId)) return null;

  return { ownerId: parts[1], importId, itemId };
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
  const parts = customId.split(":");
  if (parts.length !== 4) return null;
  if (parts[0] !== STEAM_GAME_ID_MODAL_PREFIX) return null;
  const importId = Number(parts[2]);
  const itemId = Number(parts[3]);
  if (!isPositiveInt(importId)) return null;
  if (!isPositiveInt(itemId)) return null;
  return { ownerId: parts[1], importId, itemId };
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
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(
        buildCollectionSteamImportActionId({
          ownerId: params.ownerId,
          importId: params.importId,
          itemId: params.itemId,
          action: "remap",
        }),
      )
      .setLabel("Search a different title")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(
        buildCollectionSteamImportActionId({
          ownerId: params.ownerId,
          importId: params.importId,
          itemId: params.itemId,
          action: "game-id",
        }),
      )
      .setLabel("Enter GameDB or IGDB ID")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(
        buildCollectionSteamImportActionId({
          ownerId: params.ownerId,
          importId: params.importId,
          itemId: params.itemId,
          action: "skip",
        }),
      )
      .setLabel("Skip")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(
        buildCollectionSteamImportActionId({
          ownerId: params.ownerId,
          importId: params.importId,
          itemId: params.itemId,
          action: "pause",
        }),
      )
      .setLabel("Pause")
      .setStyle(ButtonStyle.Danger),
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
