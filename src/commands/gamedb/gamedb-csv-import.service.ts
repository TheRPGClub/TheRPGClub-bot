import {
  ActionRowBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from "discord.js";
import {
  buildActionButton,
  buildButtonRow,
  buildSelectRow,
} from "../../functions/uiComponents.js";
import { ContainerBuilder } from "@discordjs/builders";
import {
  normalizePlatformKey,
  normalizeTitleKey,
  stripTitleDateSuffix,
} from "../../functions/CsvUtils.js";
import { buildTextContainer } from "../../functions/ComponentsV2Utils.js";
import { formatPlatformDisplayName } from "../../functions/PlatformDisplay.js";
import { formatTableDate } from "../../functions/DateFormatUtils.js";
import { igdbService, type IGDBGame } from "../../services/IGDB/IgdbService.js";
import { type IgdbSelectOption } from "../../services/IGDB/IgdbSelectService.js";
import Game from "../../classes/Game.js";
import { type IGameDbCsvImportItem } from "../../classes/GameDbCsvImport.js";
import { GAMEDB_CSV_PLATFORM_MAP } from "../../config/gamedbCsvPlatformMap.js";
import { buildIgdbSearchLink } from "./gamedb-utils.js";
import { type IGameDbCsvImport } from "../../classes/GameDbCsvImport.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";
import { truncateDescription, truncateLabel } from "../../config/textLimits.js";
import { logWarn } from "../../utilities/LogUtils.js";
import { GAMEDB_CSV_RESULT_LIMIT } from "../../config/pagination.js";

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
  return buildTextContainer(content);
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
      // eslint-disable-next-line local/custom-id-has-matching-handler
      .setCustomId(`${GAMEDB_CSV_SELECT_PREFIX}:${ownerId}:${importId}:${itemId}`)
      .setPlaceholder("Select a match from IGDB")
      .addOptions(
        options.slice(0, GAMEDB_CSV_RESULT_LIMIT).map((opt, idx) => ({
          label: truncateLabel(opt.label),
          value: String(opt.id),
          description: opt.description ? truncateLabel(opt.description) : undefined,
          default: idx === 0,
        })),
      );
    rows.push(buildSelectRow(select));
  }
   
  const manualBtn = buildActionButton({
    customId: `${GAMEDB_CSV_ACTION_PREFIX}:${ownerId}:${importId}:${itemId}:manual`,
    label: "Manual IGDB ID",
    style: ButtonStyle.Primary,
  });
   
  const queryBtn = buildActionButton({
    customId: `${GAMEDB_CSV_ACTION_PREFIX}:${ownerId}:${importId}:${itemId}:query`,
    label: "Manual IGDB Query",
    style: ButtonStyle.Primary,
  });
   
  const acceptBtn = buildActionButton({
    customId: `${GAMEDB_CSV_ACTION_PREFIX}:${ownerId}:${importId}:${itemId}:accept`,
    label: "Accept First Option",
    style: ButtonStyle.Success,
  });
  const actionRow = buildButtonRow(manualBtn, queryBtn, acceptBtn);
   
  const skipBtn = buildActionButton({
    customId: `${GAMEDB_CSV_ACTION_PREFIX}:${ownerId}:${importId}:${itemId}:skip`,
    label: "Skip",
    style: ButtonStyle.Secondary,
  });
   
  const pauseBtn = buildActionButton({
    customId: `${GAMEDB_CSV_ACTION_PREFIX}:${ownerId}:${importId}:${itemId}:pause`,
    label: "Pause",
    style: ButtonStyle.Secondary,
  });
  const controlRow = buildButtonRow(skipBtn, pauseBtn);
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
      description: game.summary ? truncateDescription(game.summary) : "No summary",
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
      .filter(isPositiveInt);
    platformIds.push(...ids);
  }

  const uniquePlatformIds: number[] = Array.from(new Set(platformIds));
  const platformMap = await Game.getPlatformsByIgdbIds(uniquePlatformIds);
  const missingPlatformIds = uniquePlatformIds.filter((id) => !platformMap.has(id));
  if (missingPlatformIds.length) {
    logWarn("GamedbCsvImport", `Missing IGDB platform IDs in GAMEDB_PLATFORMS: ${missingPlatformIds.join(", ")}`);
  }

  return results.map((game) => {
    const year = game.first_release_date
      ? new Date(game.first_release_date * 1000).getFullYear()
      : "TBD";
    const ids = (game.platforms ?? [])
      .map((platform) => platform.id)
      .filter(isPositiveInt);
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
