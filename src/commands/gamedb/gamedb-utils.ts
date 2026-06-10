import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  type ActionRow,
  type MessageActionRowComponent,
  type AutocompleteInteraction,
} from "discord.js";
import {
  ACCESS_DENIED_MOD_ADMIN,
  AnyRepliable,
  safeReply,
  sanitizeUserInput,
} from "../../functions/InteractionUtils.js";
import { formatGameTitleWithYear } from "../../functions/GameTitleAutocompleteUtils.js";
import { buildComponentsV2Flags, buildTextReply } from "../../functions/ComponentsV2Utils.js";
import { decodeBase64Url, encodeBase64Url } from "../../functions/CustomIdUtils.js";
import Game from "../../classes/Game.js";
import { DISCORD_SELECT_LABEL_MAX, DISCORD_SELECT_OPTIONS_MAX } from "../../config/textLimits.js";
import { buildActionButton, buildButtonRow } from "../../functions/uiComponents.js";

export interface ISearchFilters {
  upcomingRelease?: boolean;
  platformId?: number;
  year?: number;
  developerId?: number;
  publisherId?: number;
}

function compactFilters(filters: ISearchFilters): string {
  let result = "";
  if (filters.upcomingRelease) result += "u";
  if (filters.platformId) result += `p${filters.platformId}`;
  if (filters.year) result += `y${filters.year}`;
  if (filters.developerId) result += `d${filters.developerId}`;
  if (filters.publisherId) result += `q${filters.publisherId}`;
  return result;
}

function parseCompactFilters(filterStr: string): ISearchFilters {
  const filters: ISearchFilters = {};
  if (filterStr.includes("u")) filters.upcomingRelease = true;
  const platformMatch = filterStr.match(/p(\d+)/);
  if (platformMatch) filters.platformId = Number(platformMatch[1]);
  const yearMatch = filterStr.match(/y(\d{4})/);
  if (yearMatch) filters.year = Number(yearMatch[1]);
  const developerMatch = filterStr.match(/d(\d+)/);
  if (developerMatch) filters.developerId = Number(developerMatch[1]);
  const publisherMatch = filterStr.match(/q(\d+)/);
  if (publisherMatch) filters.publisherId = Number(publisherMatch[1]);
  return filters;
}

export const GAME_SEARCH_PAGE_SIZE = 10;
export const MAX_COMPONENT_CUSTOM_ID_LENGTH = 100;
export const MAX_COMPLETION_NOTE_LEN = 500;
export const MAX_NOW_PLAYING_NOTE_LEN = 500;

export const GAMEDB_CSV_AUTO_ACCEPTED = new Map<number, string[]>();

export type PromptChoiceOption = {
  label: string;
  value: string;
  style?: ButtonStyle;
};

export function decodeSearchQuery(encoded: string): string {
  const decoded = decodeBase64Url(encoded);
  const nullIdx = decoded.indexOf("\0");
  return nullIdx >= 0 ? decoded.slice(0, nullIdx) : decoded;
}

export function decodeISearchFilters(encoded: string): ISearchFilters {
  const decoded = decodeBase64Url(encoded);
  const nullIdx = decoded.indexOf("\0");
  if (nullIdx < 0) return {};
  return parseCompactFilters(decoded.slice(nullIdx + 1));
}

export function encodeSearchQuery(
  query: string,
  maxLength: number,
  filters?: ISearchFilters,
): string {
  const filterStr = filters ? compactFilters(filters) : "";
  const suffix = filterStr ? `\0${filterStr}` : "";
  if (!query && !suffix) return "";
  if (maxLength <= 0) return "";
  let trimmed = query.trim();
  while (trimmed.length >= 0) {
    const encoded = encodeBase64Url(trimmed + suffix);
    if (encoded.length <= maxLength) return encoded;
    if (trimmed.length === 0) return "";
    trimmed = trimmed.slice(0, -1);
  }
  return "";
}

export function buildIgdbSearchLink(title: string): string {
  const encoded = encodeURIComponent(title);
  return `https://www.igdb.com/search?utf8=%E2%9C%93&type=1&q=${encoded}`;
}

export function getModeratorPermissionFlags(interaction: AnyRepliable): {
  isOwner: boolean;
  isAdmin: boolean;
  isModerator: boolean;
} | null {
  const guild = interaction.guild;
  if (!guild) return null;

  const member: any = interaction.member;
  const canCheck = member && typeof member.permissionsIn === "function" && interaction.channel;
  const isOwner = guild.ownerId === interaction.user.id;
  const isAdmin = canCheck
    ? member.permissionsIn(interaction.channel).has(PermissionsBitField.Flags.Administrator)
    : false;
  const isModerator = canCheck
    ? member.permissionsIn(interaction.channel).has(PermissionsBitField.Flags.ManageMessages)
    : false;

  return { isOwner, isAdmin, isModerator };
}

export async function requireModeratorOrAdminOrOwner(
  interaction: AnyRepliable,
): Promise<boolean> {
  const permissions = getModeratorPermissionFlags(interaction);
  if (!permissions) {
    await safeReply(interaction, buildTextReply("This action can only be used inside a server.", true));
    return false;
  }

  if (permissions.isOwner || permissions.isAdmin || permissions.isModerator) {
    return true;
  }

  await safeReply(interaction, buildTextReply(ACCESS_DENIED_MOD_ADMIN, true));
  return false;
}

export function pushAutoAcceptedTitle(importId: number, title: string): void {
  const list = GAMEDB_CSV_AUTO_ACCEPTED.get(importId) ?? [];
  list.push(title);
  GAMEDB_CSV_AUTO_ACCEPTED.set(importId, list);
}

export function consumeAutoAcceptedSummary(importId: number): string | null {
  const list = GAMEDB_CSV_AUTO_ACCEPTED.get(importId);
  if (!list || list.length === 0) return null;
  GAMEDB_CSV_AUTO_ACCEPTED.set(importId, []);
  const lines = list.map((title) => `- ${title}`);
  return `Auto-accepted since last prompt:\n${lines.join("\n")}`;
}

export function buildSearchCustomId(
  type: "select" | "page",
  ownerId: string,
  page: number,
  query: string,
  direction?: "next" | "prev",
  filters?: ISearchFilters,
): string {
  const base = `gamedb-search-${type}:${ownerId}:${page}:`;
  const maxQueryLength =
    MAX_COMPONENT_CUSTOM_ID_LENGTH - base.length - (direction ? `:${direction}`.length : 0);
  const encodedQuery = encodeSearchQuery(query, Math.max(maxQueryLength, 0), filters);
  return direction
    ? `${base}${encodedQuery}:${direction}`
    : `${base}${encodedQuery}`;
}

export function buildSearchRefreshCustomId(ownerId: string, encodedQuery: string): string {
  return `gamedb-search-refresh:${ownerId}:${encodedQuery}`;
}

export function buildSearchRecoveryComponents(
  ownerId: string,
  encodedQuery: string,
): ActionRowBuilder<ButtonBuilder>[] {
  const button = buildActionButton({
    customId: buildSearchRefreshCustomId(ownerId, encodedQuery),
    label: "Refresh search",
    style: ButtonStyle.Primary,
  });
  return [buildButtonRow(button)];
}

export function isUniqueConstraintError(err: any): boolean {
  const msg = err?.message ?? "";
  return /ORA-00001/i.test(msg) || /unique constraint/i.test(msg);
}

export function isUnknownWebhookError(err: any): boolean {
  const code = err?.code ?? err?.rawError?.code;
  return code === 10015;
}

export { buildComponentsV2Flags };

export function isHltbImportEligible(
  game: { initialReleaseDate?: Date | null },
  hasCache: boolean,
): boolean {
  if (hasCache) return false;
  if (!game.initialReleaseDate) return false;
  const releaseDate = game.initialReleaseDate instanceof Date
    ? game.initialReleaseDate
    : new Date(game.initialReleaseDate);
  if (Number.isNaN(releaseDate.getTime())) return false;
  const now = new Date();
  if (releaseDate > now) return false;
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  return releaseDate <= sixMonthsAgo;
}

export function getSearchRowsFromComponents(
  components: Array<ActionRow<MessageActionRowComponent> | unknown>,
): ActionRow<MessageActionRowComponent>[] {
  return components.filter((row) => {
    if (!row || typeof row !== "object") return false;
    const rowComponents = "components" in row ? (row as any).components : [];
    return Array.isArray(rowComponents) && rowComponents.some((component) =>
      component.customId?.startsWith("gamedb-search-"),
    );
  }) as ActionRow<MessageActionRowComponent>[];
}

export function buildKeepTypingOption(query: string): { name: string; value: string } {
  const label = `Keep typing: "${query}"`;
  return {
    name: label.slice(0, DISCORD_SELECT_LABEL_MAX),
    value: query,
  };
}

export async function autocompleteSearchPlatform(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const rawQuery = focused?.value ? String(focused.value) : "";
  const platforms = await Game.getAllPlatforms();
  const query = rawQuery.toLowerCase().trim();
  const filtered = query
    ? platforms.filter((p) =>
      p.name.toLowerCase().includes(query)
        || (p.abbreviation ?? "").toLowerCase().includes(query)
        || p.code.toLowerCase().includes(query),
    )
    : platforms;
  const options = filtered.slice(0, DISCORD_SELECT_OPTIONS_MAX).map((p) => ({
    name: (p.abbreviation ? `${p.name} (${p.abbreviation})` : p.name).slice(0, DISCORD_SELECT_LABEL_MAX),
    value: String(p.id),
  }));
  await interaction.respond(options);
}

export async function autocompleteSearchCompany(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const rawQuery = focused?.value ? String(focused.value) : "";
  const companies = await Game.getAllCompanies();
  const query = rawQuery.toLowerCase().trim();
  const filtered = query
    ? companies.filter((c) => c.name.toLowerCase().includes(query))
    : companies;
  const options = filtered.slice(0, DISCORD_SELECT_OPTIONS_MAX).map((c) => ({
    name: c.name.slice(0, DISCORD_SELECT_LABEL_MAX),
    value: String(c.id),
  }));
  await interaction.respond(options);
}

export async function autocompleteGameDbViewTitle(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const rawQuery = focused?.value ? String(focused.value) : "";
  const query = sanitizeUserInput(rawQuery, { preserveNewlines: false }).trim();
  if (!query) {
    await interaction.respond([]);
    return;
  }
  const results = await Game.searchGamesAutocomplete(query);
  const resultOptions = results.slice(0, 24).map((game) => {
    const label = formatGameTitleWithYear(game);
    return {
      name: label.slice(0, DISCORD_SELECT_LABEL_MAX),
      value: String(game.id),
    };
  });
  const options = [buildKeepTypingOption(query), ...resultOptions];
  await interaction.respond(options);
}

export function buildChoiceRows(
  customIdPrefix: string,
  options: PromptChoiceOption[],
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < options.length; i += 5) {
    const slice = options.slice(i, i + 5);
    const row = buildButtonRow(
      ...slice.map((opt) =>
        buildActionButton({ customId: `${customIdPrefix}:${opt.value}`, label: opt.label, style: opt.style ?? ButtonStyle.Secondary }),
      ),
    );
    rows.push(row);
  }
  return rows;
}
