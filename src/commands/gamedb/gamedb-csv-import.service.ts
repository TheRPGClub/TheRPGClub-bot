import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from "discord.js";
import {
  ContainerBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import { normalizePlatformKey, normalizeTitleKey, stripTitleDateSuffix } from "../../functions/CsvUtils.js";
import { formatPlatformDisplayName } from "../../functions/PlatformDisplay.js";
import { formatTableDate } from "../profile.command.js";
import { igdbService, type IGDBGame } from "../../services/IGDB/IgdbService.js";
import { type IgdbSelectOption } from "../../services/IGDB/IgdbSelectService.js";
import Game from "../../classes/Game.js";
import { type IGameDbCsvImportItem } from "../../classes/GameDbCsvImport.js";
import { GAMEDB_CSV_PLATFORM_MAP } from "../../config/gamedbCsvPlatformMap.js";
import { buildIgdbSearchLink } from "./gamedb-utils.js";
import { type IGameDbCsvImport } from "../../classes/GameDbCsvImport.js";

export const GAMEDB_CSV_RESULT_LIMIT = 15;

const GAMEDB_CSV_ACTION_PREFIX = "gamedb-csv-action";
const GAMEDB_CSV_SELECT_PREFIX = "gamedb-csv-select";

let csvPlatformLookup: Map<string, number> | null = null;

export async function getPlatformLookupMap(): Promise<Map<string, number>> {
  if (csvPlatformLookup) return csvPlatformLookup;
  const platforms = await Game.getAllPlatforms();
  const map = new Map<string, number>();
  for (const platform of platforms) {
    if (!platform.igdbPlatformId) continue;
    const normalized = normalizePlatformKey(platform.name);
    if (!map.has(normalized)) {
      map.set(normalized, platform.igdbPlatformId);
    }
  }
  csvPlatformLookup = map;
  return map;
}

export async function mapCsvPlatformToIgdbIds(platformName: string | null): Promise<number[]> {
  if (!platformName) return [];
  const normalized = normalizePlatformKey(platformName);
  if (!normalized) return [];

  const platformLookupMap = await getPlatformLookupMap();
  const mappedNames = GAMEDB_CSV_PLATFORM_MAP[normalized];
  const resolved: number[] = [];

  if (mappedNames?.length) {
    for (const name of mappedNames) {
      const mapped = platformLookupMap.get(normalizePlatformKey(name));
      if (mapped && !resolved.includes(mapped)) {
        resolved.push(mapped);
      }
    }
  }

  if (!resolved.length) {
    const direct = platformLookupMap.get(normalized);
    if (direct) {
      resolved.push(direct);
    }
  }

  return resolved;
}

export function buildCsvPromptContent(
  session: IGameDbCsvImport,
  item: IGameDbCsvImportItem,
  hasResults: boolean,
): string {
  const releaseText = item.initialReleaseDate
    ? formatTableDate(item.initialReleaseDate)
    : "Unknown";
  const platformText = item.platformName ?? "Unknown";
  const displayTitle = item.rawGameTitle ?? item.gameTitle;
  const base =
    `## CSV Import #${session.importId} - Item ${item.rowIndex}/${session.totalCount}\n` +
    `**Title:** ${displayTitle}\n` +
    `**Platform:** ${platformText}\n` +
    `**Initial Release:** ${releaseText}`;
  if (hasResults) {
    return `${base}\n\nSelect an IGDB match or choose Manual IGDB ID to enter one.`;
  }
  const searchTitle = item.rawGameTitle ?? item.gameTitle;
  const link = buildIgdbSearchLink(searchTitle);
  return `${base}\n\nNo IGDB matches found. Search: ${link}\nChoose Manual IGDB ID or Skip.`;
}

export function buildCsvPromptContainer(content: string): ContainerBuilder {
  const container = new ContainerBuilder();
  const safeContent = content.length > 4000
    ? `${content.slice(0, 3997)}...`
    : content;
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(safeContent),
  );
  return container;
}

export function buildCsvPromptComponents(
  ownerId: string,
  importId: number,
  itemId: number,
  options: IgdbSelectOption[],
): ActionRowBuilder<any>[] {
  const rows: ActionRowBuilder<any>[] = [];

  if (options.length) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`${GAMEDB_CSV_SELECT_PREFIX}:${ownerId}:${importId}:${itemId}`)
      .setPlaceholder("Select a match from IGDB")
      .addOptions(
        options.slice(0, GAMEDB_CSV_RESULT_LIMIT).map((opt, idx) => ({
          label: opt.label.slice(0, 100),
          value: String(opt.id),
          description: opt.description?.slice(0, 100),
          default: idx === 0,
        })),
      );
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
  }

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${GAMEDB_CSV_ACTION_PREFIX}:${ownerId}:${importId}:${itemId}:manual`)
      .setLabel("Manual IGDB ID")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${GAMEDB_CSV_ACTION_PREFIX}:${ownerId}:${importId}:${itemId}:query`)
      .setLabel("Manual IGDB Query")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${GAMEDB_CSV_ACTION_PREFIX}:${ownerId}:${importId}:${itemId}:accept`)
      .setLabel("Accept First Option")
      .setStyle(ButtonStyle.Success),
  );
  const controlRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${GAMEDB_CSV_ACTION_PREFIX}:${ownerId}:${importId}:${itemId}:skip`)
      .setLabel("Skip")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${GAMEDB_CSV_ACTION_PREFIX}:${ownerId}:${importId}:${itemId}:pause`)
      .setLabel("Pause")
      .setStyle(ButtonStyle.Secondary),
  );
  rows.push(actionRow, controlRow);
  return rows;
}

export async function scoreCsvImportResults(
  item: IGameDbCsvImportItem,
  results: IGDBGame[],
): Promise<IgdbSelectOption[]> {
  const sortedGames = await scoreCsvImportGames(item, results);
  return sortedGames.slice(0, GAMEDB_CSV_RESULT_LIMIT).map((game) => {
    const year = game.first_release_date
      ? new Date(game.first_release_date * 1000).getFullYear()
      : "TBD";
    return {
      id: game.id,
      label: `${game.name} (${year})`,
      description: game.summary ? game.summary.slice(0, 95) : "No summary",
    };
  });
}

export async function scoreCsvImportGames(
  item: IGameDbCsvImportItem,
  results: IGDBGame[],
): Promise<IGDBGame[]> {
  const platformIds = await mapCsvPlatformToIgdbIds(item.platformName);
  const platformSet = new Set(platformIds);
  const releaseYear = item.initialReleaseDate?.getFullYear() ?? null;
  const normalizedTitle = normalizeTitleKey(item.gameTitle);

  const scored = results.map((game) => {
    const normalizedName = normalizeTitleKey(game.name);
    const isExact = normalizedTitle && normalizedName === normalizedTitle;
    const hasPlatform = platformSet.size
      ? (game.platforms ?? []).some((p) => platformSet.has(p.id))
      : false;
    const year = game.first_release_date
      ? new Date(game.first_release_date * 1000).getFullYear()
      : null;
    const yearMatch = releaseYear && year ? releaseYear === year : false;

    let score = 0;
    if (isExact) score += 4;
    if (hasPlatform) score += 3;
    if (yearMatch) score += 2;

    return { game, score, year: year ?? 0 };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.year !== a.year) return b.year - a.year;
    return a.game.name.localeCompare(b.game.name);
  });

  return scored.map((entry) => entry.game);
}

export function shouldAutoAcceptFirstCsvMatch(
  item: IGameDbCsvImportItem,
  firstMatch?: IGDBGame | null,
): boolean {
  if (!firstMatch) return false;
  const rawTitle = stripTitleDateSuffix(item.rawGameTitle ?? item.gameTitle).trim();
  if (!rawTitle) return false;
  const matchTitle = firstMatch.name ?? "";
  if (!matchTitle) return false;
  const normalizedCsv = normalizeTitleKey(rawTitle);
  const normalizedMatch = normalizeTitleKey(matchTitle);
  if (!normalizedCsv || normalizedCsv !== normalizedMatch) return false;
  const csvYear = item.initialReleaseDate?.getFullYear() ?? null;
  const igdbYear = firstMatch.first_release_date
    ? new Date(firstMatch.first_release_date * 1000).getFullYear()
    : null;
  if (!csvYear) return true;
  return Boolean(igdbYear && csvYear === igdbYear);
}

export async function buildIgdbSelectOptions(
  results: IGDBGame[],
): Promise<IgdbSelectOption[]> {
  const platformIds: number[] = [];
  for (const game of results) {
    const ids = (game.platforms ?? [])
      .map((platform) => platform.id)
      .filter((id) => Number.isInteger(id) && id > 0);
    platformIds.push(...ids);
  }

  const uniquePlatformIds: number[] = Array.from(new Set(platformIds));
  const platformMap = await Game.getPlatformsByIgdbIds(uniquePlatformIds);
  const missingPlatformIds = uniquePlatformIds.filter((id) => !platformMap.has(id));
  if (missingPlatformIds.length) {
    console.warn(
      `[GameDB] Missing IGDB platform IDs in GAMEDB_PLATFORMS: ${missingPlatformIds.join(", ")}`,
    );
  }

  return results.map((game) => {
    const year = game.first_release_date
      ? new Date(game.first_release_date * 1000).getFullYear()
      : "TBD";
    const ids = (game.platforms ?? [])
      .map((platform) => platform.id)
      .filter((id) => Number.isInteger(id) && id > 0);
    const platformNames = ids
      .map((id) => formatPlatformDisplayName(platformMap.get(id)?.name))
      .filter((name): name is string => Boolean(name));
    const platformLabel = platformNames.length
      ? `Platforms: ${platformNames.join(", ")}`
      : "Platforms: Unknown";
    const summary = game.summary || "No summary";
    const description = `${platformLabel} - ${summary}`.substring(0, 95);

    return {
      id: game.id,
      label: `${game.name} (${year})`,
      description,
    };
  });
}

export async function searchIgdbGamesForCsv(
  searchTitle: string,
  limit = 50,
): Promise<IGDBGame[]> {
  const search = await igdbService.searchGames(searchTitle, limit);
  return search.results ?? [];
}
