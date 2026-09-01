import { type IMemberNowPlayingEntry } from "../classes/Member.js";
import { formatPlatformDisplayName } from "./PlatformDisplay.js";
import { buildMaskedLink } from "./ComponentsV2Utils.js";

export function buildNowPlayingSortStateToken(entryCount: number): string {
  return Array.from({ length: entryCount }, (_, index) => index.toString(36)).join("");
}

export function parseNowPlayingSortStateToken(
  token: string,
  entryCount: number,
): number[] | null {
  if (token.length !== entryCount) {
    return null;
  }
  const parsed: number[] = [];
  for (const character of token) {
    if (character === "_") {
      parsed.push(-1);
      continue;
    }
    const value = Number.parseInt(character, 36);
    if (!Number.isInteger(value) || value < 0 || value >= entryCount) {
      return null;
    }
    parsed.push(value);
  }
  return parsed;
}

export function encodeNowPlayingSortState(state: number[]): string {
  return state.map((value) => (value < 0 ? "_" : value.toString(36))).join("");
}

export function parseNowPlayingPlatformStateToken(
  token: string,
  entryCount: number,
): number[] | null {
  if (token.length !== entryCount) {
    return null;
  }
  const parsed: number[] = [];
  for (const character of token) {
    if (character === "_") {
      parsed.push(-1);
      continue;
    }
    const value = Number.parseInt(character, 36);
    if (!Number.isInteger(value) || value < 0 || value > 24) {
      return null;
    }
    parsed.push(value);
  }
  return parsed;
}

export function encodeNowPlayingPlatformState(state: number[]): string {
  return state.map((value) => (value < 0 ? "_" : value.toString(36))).join("");
}

export function buildNowPlayingPlatformStateFromCurrent(
  entries: IMemberNowPlayingEntry[],
  platformOptions: Array<Array<{ label: string; value: string; platformId: number }>>,
): string {
  const state = entries.map((entry, slotIndex) => {
    const options = platformOptions[slotIndex] ?? [];
    const selectedIndex = options.findIndex((option) => option.platformId === entry.platformId);
    return selectedIndex >= 0 ? selectedIndex : -1;
  });
  return encodeNowPlayingPlatformState(state);
}

export function resolvePlatformLabel(entry: IMemberNowPlayingEntry): string | null {
  const candidate =
    entry.platformAbbreviation ??
    formatPlatformDisplayName(entry.platformName) ??
    entry.platformName ??
    "Unknown Platform";
  if (candidate === "Unknown Platform") {
    return null;
  }
  return candidate;
}

export function formatEntry(
  entry: IMemberNowPlayingEntry,
  guildId: string | null,
): string {
  const platformLabel = resolvePlatformLabel(entry);
  const baseTitle = platformLabel
    ? `${entry.title} (${platformLabel})`
    : entry.title;
  if (entry.threadId && guildId) {
    const threadUrl = `https://discord.com/channels/${guildId}/${entry.threadId}`;
    return buildMaskedLink(baseTitle, threadUrl);
  }
  return baseTitle;
}

export function formatEntryTitleWithPlatform(
  entry: { title: string; platformName: string | null },
): string {
  const platformLabel = resolvePlatformLabel(entry as IMemberNowPlayingEntry);
  return platformLabel
    ? `${entry.title} (${platformLabel})`
    : entry.title;
}

export function sortNowPlayingEntries(
  entries: IMemberNowPlayingEntry[],
): IMemberNowPlayingEntry[] {
  return [...entries].sort((a, b) => {
    const titleA = a.title.toLowerCase();
    const titleB = b.title.toLowerCase();
    const titleCompare = titleA.localeCompare(titleB);
    if (titleCompare !== 0) return titleCompare;
    const gameIdA = a.gameId ?? 0;
    const gameIdB = b.gameId ?? 0;
    return gameIdA - gameIdB;
  });
}

export function getDisplayNowPlayingEntries(
  entries: IMemberNowPlayingEntry[],
): IMemberNowPlayingEntry[] {
  const hasManualOrder = entries.some((entry) => entry.sortOrder != null);
  return hasManualOrder ? entries : sortNowPlayingEntries(entries);
}
