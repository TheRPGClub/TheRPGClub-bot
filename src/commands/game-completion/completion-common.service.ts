import {
  MessageFlags,
  type ButtonInteraction,
  type CommandInteraction,
  type ModalSubmitInteraction,
  type User,
} from "discord.js";
import { ContainerBuilder } from "@discordjs/builders";
import { buildDisabledPrevNextRowWithIds } from "../../functions/PaginationUtils.js";
import { safeDeferUpdate, safeReply } from "../../functions/InteractionUtils.js";
import { formatPlatformDisplayName } from "../../functions/PlatformDisplay.js";
import {
  buildComponentsV2Flags,
  buildTextContainer,
  safeV2TextContent,
} from "../../functions/ComponentsV2Utils.js";
import { decodeBase64Url, encodeWithMaxLength } from "../../functions/CustomIdUtils.js";
import { parseCustomIdSegments } from "../../utilities/CustomIdUtils.js";
import { renderUsernameWithEmoji } from "../../services/UserEmojiService.js";
import {
  COMPLETION_PAGE_SIZE,
} from "../profile.command.js";
import { apiGetRaw } from "../../services/RpgClubApiClient.js";
import { formatApiError } from "../../utilities/ApiErrorUtils.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";
import { MAX_CONTAINER_TEXT, MAX_SECTION_TEXT } from "../../config/textLimits.js";
import { safeIgnore } from "../../utilities/AsyncUtils.js";
import GamePlatformRegionService from "../../classes/GamePlatformRegionService.js";

export type CommonCompletionSort =
  | "title_asc"
  | "title_desc"
  | "date_desc"
  | "date_asc";

export const COMMON_COMPLETION_SORT_OPTIONS: Array<{
  label: string;
  value: CommonCompletionSort;
}> = [
  { label: "Date (Newest First)", value: "date_desc" },
  { label: "Date (Oldest First)", value: "date_asc" },
  { label: "Title (A-Z)", value: "title_asc" },
  { label: "Title (Z-A)", value: "title_desc" },
];

type InteractionLike =
  | CommandInteraction
  | ButtonInteraction
  | ModalSubmitInteraction;

type ICommonCompletionState = {
  leftId: string;
  rightId: string;
  sort: CommonCompletionSort;
  year: number | "unknown" | null;
  platformId: number | null;
  query?: string;
};

const NO_QUERY_TOKEN = "-";
const YEAR_ALL_TOKEN = "all";
const YEAR_UNKNOWN_TOKEN = "unknown";
const PLATFORM_ALL_TOKEN = "all";

function normalizeSort(sort: string): CommonCompletionSort {
  if (sort === "title_asc" || sort === "title_desc" || sort === "date_asc" || sort === "date_desc") {
    return sort;
  }
  return "date_desc";
}

function normalizeYearToken(year: number | "unknown" | null): string {
  if (year == null) return YEAR_ALL_TOKEN;
  if (year === "unknown") return YEAR_UNKNOWN_TOKEN;
  return String(year);
}

function parseYearToken(raw: string): number | "unknown" | null {
  if (!raw || raw === YEAR_ALL_TOKEN) return null;
  if (raw === YEAR_UNKNOWN_TOKEN) return "unknown";
  const parsed = Number(raw);
  if (!isPositiveInt(parsed)) return null;
  return parsed;
}

function normalizePlatformToken(platformId: number | null): string {
  if (platformId == null) return PLATFORM_ALL_TOKEN;
  return String(platformId);
}

function parsePlatformToken(raw: string): number | null {
  if (!raw || raw === PLATFORM_ALL_TOKEN) return null;
  const parsed = Number(raw);
  if (!isPositiveInt(parsed)) return null;
  return parsed;
}

function encodeQueryToken(query: string | undefined, maxLength: number): string {
  const trimmed = query?.trim();
  if (!trimmed) return NO_QUERY_TOKEN;
  return encodeWithMaxLength(trimmed, maxLength, NO_QUERY_TOKEN);
}

function decodeQueryToken(token: string): string | undefined {
  if (!token || token === NO_QUERY_TOKEN) return undefined;
  const decoded = decodeBase64Url(token).trim();
  return decoded.length ? decoded : undefined;
}

function buildCommonNavCustomId(
  state: ICommonCompletionState,
  page: number,
  direction: "prev" | "next",
): string {
  const base = `comp-common-nav:${state.leftId}:${state.rightId}:${state.sort}:${normalizeYearToken(state.year)}:${normalizePlatformToken(state.platformId)}:${page}:${direction}:`;
  const maxQueryLength = Math.max(100 - base.length, 0);
  const queryToken = encodeQueryToken(state.query, maxQueryLength);
  return `${base}${queryToken}`;
}

function parseCommonBackCustomId(
  customId: string,
): { state: ICommonCompletionState; page: number } | null {
  if (!customId.startsWith("comp-common-back:")) return null;
  const segs = parseCustomIdSegments(customId, 7);
  if (!segs) return null;
  const [leftId, rightId, sortTok, yearTok, platformTok, pageStr, queryTok] = segs;
  const page = Number(pageStr);
  if (!Number.isInteger(page) || page < 0) return null;

  return {
    page,
    state: {
      leftId,
      rightId,
      sort: normalizeSort(sortTok),
      year: parseYearToken(yearTok),
      platformId: parsePlatformToken(platformTok),
      query: decodeQueryToken(queryTok),
    },
  };
}

function parseCommonNavCustomId(
  customId: string,
): { state: ICommonCompletionState; page: number; direction: "prev" | "next" } | null {
  if (!customId.startsWith("comp-common-nav:")) return null;
  const segs = parseCustomIdSegments(customId, 8);
  if (!segs) return null;
  const [leftId, rightId, sortTok, yearTok, platformTok, pageStr, direction, queryTok] = segs;
  const page = Number(pageStr);
  if (!Number.isInteger(page) || page < 0) return null;
  if (direction !== "prev" && direction !== "next") return null;

  return {
    state: {
      leftId,
      rightId,
      sort: normalizeSort(sortTok),
      year: parseYearToken(yearTok),
      platformId: parsePlatformToken(platformTok),
      query: decodeQueryToken(queryTok),
    },
    page,
    direction,
  };
}

function buildV2Flags(ephemeral: boolean): number {
  return buildComponentsV2Flags(ephemeral);
}

const CHUNK_LIMIT = MAX_CONTAINER_TEXT;

function pushChunked(containers: ContainerBuilder[], lines: string[]): void {
  let buffer = "";
  for (const line of lines) {
    const next = buffer ? `${buffer}\n${line}` : line;
    if (next.length > CHUNK_LIMIT) {
      containers.push(
        buildTextContainer(safeV2TextContent(buffer, CHUNK_LIMIT)),
      );
      buffer = line;
    } else {
      buffer = next;
    }
  }
  if (buffer) {
    containers.push(
      buildTextContainer(safeV2TextContent(buffer, CHUNK_LIMIT)),
    );
  }
}

function formatYearLabel(year: number | "unknown" | null): string {
  if (year == null) return "All";
  if (year === "unknown") return "Unknown";
  return String(year);
}

function displayUserName(user: User): string {
  return user.displayName ?? user.username ?? user.id;
}

type CommonCompletionEntry = {
  game: { title: string };
};

type CommonCompletionResponse = {
  data: CommonCompletionEntry[];
  meta: { page: number; pages: number; count: number; per: number };
};

type CommonCompletionPage = {
  rows: CommonCompletionEntry[];
  page: number;
  pages: number;
  total: number;
};

function buildCommonCompletionPath(state: ICommonCompletionState, page: number): string {
  const params = new URLSearchParams({
    other_user_id: state.rightId,
    sort: state.sort,
    page: String(page + 1),
    per: String(COMPLETION_PAGE_SIZE),
  });
  if (state.year !== null) params.set("year", String(state.year));
  if (state.platformId != null) params.set("platform_id", String(state.platformId));
  const query = state.query?.trim();
  if (query) params.set("q", query);
  return `/api/v1/users/${state.leftId}/completions/common?${params.toString()}`;
}

// The API answers 404 for an unknown member and 422 for a bad filter or the same member
// twice. Every failure is shown with the full request and response.
async function fetchCommonCompletionPage(
  state: ICommonCompletionState,
  page: number,
): Promise<CommonCompletionPage | string> {
  const path = buildCommonCompletionPath(state, page);
  const result = await apiGetRaw<CommonCompletionResponse>(path);
  const body = result.rawData as CommonCompletionResponse | null;
  if (result.errorMessage || !body?.meta || !Array.isArray(body.data)) {
    const detail = formatApiError("GET", result.url, null, result.status, result.rawData);
    return `Could not load shared Game Completions.\n${detail}`;
  }
  return {
    rows: body.data,
    page: Math.max(body.meta.page - 1, 0),
    pages: Math.max(body.meta.pages, 1),
    total: body.meta.count,
  };
}

export async function renderCommonCompletionPage(
  interaction: InteractionLike,
  state: ICommonCompletionState,
  page: number,
  ephemeral: boolean,
): Promise<void> {
  if (state.leftId === state.rightId) {
    await safeReply(interaction, {
      components: [buildTextContainer("Pick two different members to compare.")],
      flags: buildV2Flags(ephemeral),
    });
    return;
  }

  const [leftUser, rightUser, allPlatforms] = await Promise.all([
    interaction.client.users.fetch(state.leftId).catch(() => interaction.user),
    interaction.client.users.fetch(state.rightId).catch(() => interaction.user),
    state.platformId != null ? GamePlatformRegionService.getAllPlatforms() : [],
  ]);

  const platformMap = new Map(
    allPlatforms.map((platform) => [platform.id, platform.abbreviation ?? platform.name]),
  );

  let fetched = await fetchCommonCompletionPage(state, page);
  if (typeof fetched !== "string" && fetched.rows.length === 0 && fetched.total > 0) {
    fetched = await fetchCommonCompletionPage(state, fetched.pages - 1);
  }
  if (typeof fetched === "string") {
    await safeReply(interaction, {
      components: [buildTextContainer(safeV2TextContent(fetched, MAX_CONTAINER_TEXT))],
      flags: buildV2Flags(ephemeral),
    });
    return;
  }

  if (!fetched.rows.length) {
    await safeReply(interaction, {
      components: [
        buildTextContainer("No shared Game Completions matched those filters."),
      ],
      flags: buildV2Flags(ephemeral),
    });
    return;
  }

  const { total, pages: totalPages, page: safePage } = fetched;
  const offset = safePage * COMPLETION_PAGE_SIZE;
  const pageRows = fetched.rows;

  const leftLabel = displayUserName(leftUser);
  const rightLabel = displayUserName(rightUser);

  const containers: ContainerBuilder[] = [];

  const leftDisplay = renderUsernameWithEmoji(state.leftId, leftLabel);
  const rightDisplay = renderUsernameWithEmoji(state.rightId, rightLabel);
  containers.push(
    buildTextContainer(
      safeV2TextContent(
        `## Shared Game Completions\n### ${leftDisplay} & ${rightDisplay}`,
        MAX_CONTAINER_TEXT,
      ),
    ),
  );

  const lines = pageRows.map((row, index) => `${offset + index + 1}. **${row.game.title}**`);
  pushChunked(containers, lines);

  const footerLines: string[] = [];
  if (state.year !== null) {
    footerLines.push(`-# Year: ${formatYearLabel(state.year)}`);
  }
  if (state.platformId != null) {
    const rawName = platformMap.get(state.platformId) ?? "Unknown Platform";
    footerLines.push(`-# Platform: ${formatPlatformDisplayName(rawName)}`);
  }
  if (state.query?.trim()) {
    footerLines.push(`-# Query: "${state.query.trim()}"`);
  }
  if (totalPages > 1) {
    footerLines.push(
      `-# ${total} Game Completions in common. Page ${safePage + 1} of ${totalPages}.`,
    );
  } else {
    footerLines.push(`-# ${total} Game Completions in common.`);
  }
  containers.push(
    buildTextContainer(safeV2TextContent(footerLines.join("\n"), MAX_SECTION_TEXT)),
  );

  const paginationRow = buildDisabledPrevNextRowWithIds(
    buildCommonNavCustomId(state, safePage, "prev"),
    buildCommonNavCustomId(state, safePage, "next"),
    safePage,
    totalPages,
  );

  await safeReply(interaction, {
    components: [
      ...containers,
      ...(paginationRow ? [paginationRow] : []),
    ],
    flags: buildV2Flags(ephemeral),
  });
}

export async function handleCommonCompletionNav(
  interaction: ButtonInteraction,
): Promise<void> {
  const parsed = parseCommonNavCustomId(interaction.customId);
  if (!parsed) return;

  const targetPage = parsed.direction === "next" ? parsed.page + 1 : Math.max(parsed.page - 1, 0);

  safeIgnore(safeDeferUpdate(interaction));

  const ephemeral = interaction.message?.flags?.has(MessageFlags.Ephemeral) ?? true;
  await renderCommonCompletionPage(interaction, parsed.state, targetPage, ephemeral);
}

export async function handleCommonCompletionBack(
  interaction: ButtonInteraction,
): Promise<void> {
  const parsed = parseCommonBackCustomId(interaction.customId);
  if (!parsed) return;

  safeIgnore(safeDeferUpdate(interaction));

  const ephemeral = interaction.message?.flags?.has(MessageFlags.Ephemeral) ?? true;
  await renderCommonCompletionPage(interaction, parsed.state, parsed.page, ephemeral);
}
