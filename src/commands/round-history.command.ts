import type {
  ButtonInteraction,
  Client,
  CommandInteraction,
  ModalSubmitInteraction,
} from "discord.js";
import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import {
  LabelBuilder,
  ModalBuilder,
  RadioGroupBuilder,
  StringSelectMenuBuilder as ModalStringSelectMenuBuilder,
} from "@discordjs/builders";
import {
  TextInputStyle,
  type APISelectMenuOption,
} from "discord-api-types/v10";
import {
  ButtonComponent,
  Discord,
  ModalComponent,
  Slash,
  SlashGroup,
  SlashOption,
} from "discordx";
import { buildTextInputLabel } from "../functions/uiComponents.js";
import type { IGotmEntry } from "../classes/Gotm.js";
import Gotm from "../classes/Gotm.js";
import type { INrGotmEntry } from "../classes/NrGotm.js";
import NrGotm from "../classes/NrGotm.js";
import {
  buildGotmCardsFromEntries,
  buildGotmSearchMessages,
  type GotmDisplayCard,
} from "../functions/GotmSearchComponents.js";
import {
  safeDeferReply,
  safeDeferUpdate,
  safeEditReply,
  safeReply,
  sanitizeUserInput,
} from "../functions/InteractionUtils.js";
import {
  buildComponentsV2Flags,
  buildErrorReply,
  buildTextReply,
} from "../functions/ComponentsV2Utils.js";
import { buildCaughtErrorMessage } from "../utilities/ApiErrorUtils.js";
import { decodeBase64Url, encodeBase64Url } from "../functions/CustomIdUtils.js";
import { parseCustomIdSegments } from "../utilities/CustomIdUtils.js";
import { ROUND_HISTORY_GAMES_PER_PAGE } from "../config/pagination.js";
import { DISCORD_SELECT_OPTIONS_MAX } from "../config/textLimits.js";
import {
  buildDisabledPrevNextRowWithIds,
  buildPageFooterText,
} from "../functions/PaginationUtils.js";
import { commandMention } from "../services/CommandMentionService.js";

const ROUND_HISTORY_MODAL_TITLE = "Round History";
const ROUND_HISTORY_HELP_ID = "round-history-help";
const ROUND_HISTORY_KIND_ID = "round-history-kind";
const ROUND_HISTORY_QUERY_ID = "round-history-query";
const ROUND_HISTORY_YEAR_ID = "round-history-year";
const ROUND_HISTORY_SORT_ID = "round-history-sort";

type RoundHistoryKind = "gotm" | "nr-gotm" | "both";
type RoundHistorySort = "asc" | "desc";

export type IRoundHistoryRecord = {
  round: number;
  gotmEntries: IGotmEntry[];
  nrGotmEntries: INrGotmEntry[];
};

export type IRoundHistoryFilterState = {
  ownerUserId: string;
  kind: RoundHistoryKind;
  query: string;
  year: number;
  sort: RoundHistorySort;
  page: number;
};

function buildRoundHistorySessionId(userId: string, isPrivate: boolean): string {
  const visibility = isPrivate ? "1" : "0";
  return `u${userId}_c${visibility}`;
}

function parsePrivateFlagFromSessionId(sessionId: string): boolean | null {
  const match = /^u\d+_c([01])$/.exec(sessionId);
  if (!match || !match[1]) {
    return null;
  }
  return match[1] === "1";
}

const ROUND_HISTORY_MODAL_ID_PREFIX = "modal:round-history:v1:query";

function buildRoundHistoryModalCustomId(sessionId: string): string {
  return `${ROUND_HISTORY_MODAL_ID_PREFIX}:${sessionId}`;
}

function parseRoundHistoryModalCustomId(customId: string): { sessionId: string } | null {
  const prefix = `${ROUND_HISTORY_MODAL_ID_PREFIX}:`;
  if (!customId.startsWith(prefix)) return null;
  const sessionId = customId.slice(prefix.length);
  return sessionId ? { sessionId } : null;
}

function parseYearFromMonthYear(value: string): number | null {
  const match = /(\d{4})\s*$/.exec(value);
  if (!match || !match[1]) return null;
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) ? parsed : null;
}

function getCurrentYear(): number {
  return new Date().getFullYear();
}

function getModalYearOptions(): APISelectMenuOption[] {
  const years = new Set<number>([getCurrentYear()]);
  for (const entry of Gotm.all()) {
    const parsed = parseYearFromMonthYear(entry.monthYear);
    if (parsed) years.add(parsed);
  }
  for (const entry of NrGotm.all()) {
    const parsed = parseYearFromMonthYear(entry.monthYear);
    if (parsed) years.add(parsed);
  }

  return Array.from(years)
    .sort((a, b) => b - a)
    .slice(0, DISCORD_SELECT_OPTIONS_MAX)
    .map((year) => ({
      label: String(year),
      value: String(year),
      default: year === getCurrentYear(),
    }));
}

export function buildRoundHistoryModal(sessionId: string): ModalBuilder {
  const helpText =
    "Filter by category, optional title text, and year. " +
    "Sort controls round order. Results show up to " +
    `${ROUND_HISTORY_GAMES_PER_PAGE} games per page.`;

  return new ModalBuilder()
    .setCustomId(buildRoundHistoryModalCustomId(sessionId))
    .setTitle(ROUND_HISTORY_MODAL_TITLE)
    .addLabelComponents(
      buildTextInputLabel({
        customId: ROUND_HISTORY_HELP_ID,
        label: "How this form works",
        style: TextInputStyle.Paragraph,
        required: false,
        maxLength: 500,
        value: helpText,
      }),
      new LabelBuilder()
        .setLabel("Category")
        .setDescription("Required")
        .setRadioGroupComponent(
          new RadioGroupBuilder()
            .setCustomId(ROUND_HISTORY_KIND_ID)
            .setRequired(true)
            .setOptions(
              { label: "GOTM", value: "gotm" },
              { label: "NR-GOTM", value: "nr-gotm" },
              { label: "Both", value: "both", default: true },
            ),
        ),
      new LabelBuilder()
        .setLabel("Year")
        .setDescription("Required")
        .setStringSelectMenuComponent(
          new ModalStringSelectMenuBuilder()
            .setCustomId(ROUND_HISTORY_YEAR_ID)
            .setMinValues(1)
            .setMaxValues(1)
            .setOptions(getModalYearOptions()),
        ),
      new LabelBuilder()
        .setLabel("Sort")
        .setDescription("Round number order")
        .setRadioGroupComponent(
          new RadioGroupBuilder()
            .setCustomId(ROUND_HISTORY_SORT_ID)
            .setRequired(true)
            .setOptions(
              { label: "Ascending", value: "asc", default: true },
              { label: "Descending", value: "desc" },
            ),
        ),
      buildTextInputLabel({
        customId: ROUND_HISTORY_QUERY_ID,
        label: "Query (optional title match)",
        required: false,
        maxLength: 30,
      }),
    );
}

function getRoundHistoryModalComponentSummary(value: unknown): string {
  const components = (value as { components?: unknown })?.components;
  if (!Array.isArray(components)) {
    return "components=not-array";
  }

  return components
    .map((component, index) => {
      const topLevel = component as {
        type?: unknown;
        component?: { type?: unknown; custom_id?: unknown };
        components?: Array<{ type?: unknown; custom_id?: unknown }>;
      };
      const children = Array.isArray(topLevel.components)
        ? topLevel.components
        : topLevel.component
          ? [topLevel.component]
          : [];
      const childTypes = children
        .map((child) => `${String(child.type)}:${String(child.custom_id ?? "no-id")}`)
        .join(",");
      return `${index}:${String(topLevel.type)}[${childTypes}]`;
    })
    .join(" ");
}

function logRoundHistoryModalDebug(
  event: string,
  details: Record<string, unknown>,
): void {
  const safeDetails = Object.fromEntries(
    Object.entries(details).map(([key, value]) => [
      key,
      value instanceof Error
        ? `${value.name}: ${value.message}\n${value.stack ?? ""}`
        : value,
    ]),
  );
  console.info(`[RoundHistoryModalDebug] ${event} ${JSON.stringify(safeDetails)}`);
}

function parseKind(value: unknown): RoundHistoryKind | null {
  return value === "gotm" || value === "nr-gotm" || value === "both"
    ? value
    : null;
}

function parseSort(value: unknown): RoundHistorySort | null {
  return value === "asc" || value === "desc" ? value : null;
}

function extractSingleValueFromModal(
  interaction: ModalSubmitInteraction,
  fieldId: string,
): string | undefined {
  const topLevelComponents = (
    interaction.components ?? []
  ) as Array<{
    component?: { customId?: string; value?: unknown; values?: unknown };
    components?: Array<{ customId?: string; value?: unknown; values?: unknown }>;
  }>;

  for (const topLevel of topLevelComponents) {
    const children = Array.isArray(topLevel.components)
      ? topLevel.components
      : topLevel.component
        ? [topLevel.component]
        : [];

    for (const child of children) {
      if (!child || child.customId !== fieldId) {
        continue;
      }
      if (typeof child.value === "string") {
        return child.value;
      }
      if (Array.isArray(child.values) && typeof child.values[0] === "string") {
        return child.values[0];
      }
    }
  }
  return undefined;
}

function encodeQueryToken(query: string): string {
  if (!query) return "_";
  return encodeBase64Url(query);
}

function decodeQueryToken(token: string): string | null {
  if (token === "_") return "";
  const decoded = decodeBase64Url(token, "\0");
  return decoded === "\0" ? null : decoded;
}

function buildRoundHistoryPageCustomId(state: IRoundHistoryFilterState): string {
  const kindToken = state.kind === "gotm"
    ? "g"
    : state.kind === "nr-gotm"
      ? "n"
      : "b";
  const sortToken = state.sort === "desc" ? "d" : "a";
  return [
    "round-history-page",
    state.ownerUserId,
    kindToken,
    String(state.year),
    sortToken,
    String(state.page),
    encodeQueryToken(state.query),
  ].join(":");
}

function parseRoundHistoryPageCustomId(customId: string): IRoundHistoryFilterState | null {
  if (!customId.startsWith("round-history-page:")) return null;
  const segs = parseCustomIdSegments(customId, 6);
  if (!segs) return null;
  const [ownerUserId, kindToken, yearStr, sortToken, pageStr, queryStr] = segs;
  const year = Number(yearStr);
  const page = Number(pageStr);
  const query = decodeQueryToken(queryStr ?? "");
  if (
    !ownerUserId || !Number.isInteger(year) || !Number.isInteger(page) || page < 0 || query === null
  ) {
    return null;
  }

  const kind: RoundHistoryKind = kindToken === "g"
    ? "gotm"
    : kindToken === "n"
      ? "nr-gotm"
      : kindToken === "b"
        ? "both"
        : null as never;
  if (!kind) {
    return null;
  }

  const sort: RoundHistorySort = sortToken === "d" ? "desc" : sortToken === "a" ? "asc" : null as never;
  if (!sort) {
    return null;
  }

  return {
    ownerUserId,
    kind,
    query,
    year,
    sort,
    page,
  };
}

function getFilteredRoundHistoryRecords(
  kind: RoundHistoryKind,
  query: string,
  year: number,
  sort: RoundHistorySort,
): IRoundHistoryRecord[] {
  const normalizedQuery = query.trim().toLowerCase();
  const includeGotm = kind === "gotm" || kind === "both";
  const includeNrGotm = kind === "nr-gotm" || kind === "both";
  const gotmEntries = includeGotm ? Gotm.getByYear(year) : [];
  const nrGotmEntries = includeNrGotm ? NrGotm.getByYear(year) : [];
  const byRound = new Map<number, IRoundHistoryRecord>();

  for (const entry of gotmEntries) {
    if (
      normalizedQuery &&
      !entry.gameOfTheMonth.some((game) => game.title.toLowerCase().includes(normalizedQuery))
    ) {
      continue;
    }
    const existing = byRound.get(entry.round);
    if (existing) {
      existing.gotmEntries.push(entry);
    } else {
      byRound.set(entry.round, {
        round: entry.round,
        gotmEntries: [entry],
        nrGotmEntries: [],
      });
    }
  }

  for (const entry of nrGotmEntries) {
    if (
      normalizedQuery &&
      !entry.gameOfTheMonth.some((game) => game.title.toLowerCase().includes(normalizedQuery))
    ) {
      continue;
    }
    const existing = byRound.get(entry.round);
    if (existing) {
      existing.nrGotmEntries.push(entry);
    } else {
      byRound.set(entry.round, {
        round: entry.round,
        gotmEntries: [],
        nrGotmEntries: [entry],
      });
    }
  }

  const sorted = Array.from(byRound.values()).sort((a, b) =>
    sort === "asc" ? a.round - b.round : b.round - a.round,
  );
  return sorted;
}

type IRoundHistoryResponse = {
  components: Array<any>;
  files: any[];
  totalPages: number;
  safePage: number;
};

type IRoundHistoryPage = {
  cards: GotmDisplayCard[];
  firstRoundIndex: number;
  lastRoundIndex: number;
};

function buildRoundCards(round: IRoundHistoryRecord): GotmDisplayCard[] {
  return [
    ...buildGotmCardsFromEntries(round.gotmEntries, "GOTM"),
    ...buildGotmCardsFromEntries(round.nrGotmEntries, "NR-GOTM").filter(
      (card) => card.title.trim().toLowerCase() !== "n/a",
    ),
  ].sort((a, b) => {
    if (a.kindLabel !== b.kindLabel) {
      return a.kindLabel === "GOTM" ? -1 : 1;
    }
    return a.title.localeCompare(b.title);
  });
}

// Pages are packed by game count so each reply stays under the component limit. A round
// stays on one page unless it alone holds more games than a page fits.
export function paginateRoundHistory(rounds: IRoundHistoryRecord[]): IRoundHistoryPage[] {
  const pages: IRoundHistoryPage[] = [];
  let current: IRoundHistoryPage | null = null;
  rounds.forEach((round, roundIndex) => {
    const roundCards = buildRoundCards(round);
    if (current && current.cards.length + roundCards.length > ROUND_HISTORY_GAMES_PER_PAGE) {
      current = null;
    }
    let offset = 0;
    do {
      const pageFull = current && current.cards.length >= ROUND_HISTORY_GAMES_PER_PAGE;
      if (!current || (pageFull && offset < roundCards.length)) {
        current = { cards: [], firstRoundIndex: roundIndex, lastRoundIndex: roundIndex };
        pages.push(current);
      }
      const room = ROUND_HISTORY_GAMES_PER_PAGE - current.cards.length;
      current.cards.push(...roundCards.slice(offset, offset + room));
      current.lastRoundIndex = roundIndex;
      offset += room;
    } while (offset < roundCards.length);
  });
  return pages;
}

function buildRoundHistoryIntro(
  state: IRoundHistoryFilterState,
  totalRounds: number,
  totalPages: number,
  page: IRoundHistoryPage | undefined,
): string {
  const kindLabel = state.kind === "gotm" ? "GOTM" : state.kind === "nr-gotm" ? "NR-GOTM" : "Both";
  const start = page ? page.firstRoundIndex + 1 : 0;
  const end = page ? page.lastRoundIndex + 1 : 0;
  const queryLine = state.query ? `"${state.query}"` : "(none)";
  return [
    `Category: ${kindLabel} | Year: ${state.year} | Sort: ${state.sort.toUpperCase()}`,
    `Query: ${queryLine}`,
    buildPageFooterText(
      state.page,
      Math.max(totalPages, 1),
      `Rounds ${start}-${end} of ${totalRounds}`,
    ),
  ].join("\n");
}

function buildRoundHistoryPaginationRow(
  state: IRoundHistoryFilterState,
  totalPages: number,
): ActionRowBuilder<ButtonBuilder> | null {
  const prevPage = Math.max(0, state.page - 1);
  const nextPage = Math.min(totalPages - 1, state.page + 1);
  return buildDisabledPrevNextRowWithIds(
    buildRoundHistoryPageCustomId({ ...state, page: prevPage }),
    buildRoundHistoryPageCustomId({ ...state, page: nextPage }),
    state.page,
    totalPages,
    { styles: { next: ButtonStyle.Primary } },
  );
}

async function buildRoundHistoryResponse(
  interaction: CommandInteraction | ButtonInteraction | ModalSubmitInteraction,
  state: IRoundHistoryFilterState,
): Promise<IRoundHistoryResponse> {
  const allRounds = getFilteredRoundHistoryRecords(state.kind, state.query, state.year, state.sort);
  return buildRoundHistoryPageResponse(
    interaction.client,
    interaction.guildId ?? undefined,
    state,
    allRounds,
  );
}

export async function buildRoundHistoryPageResponse(
  client: Client,
  guildId: string | undefined,
  state: IRoundHistoryFilterState,
  allRounds: IRoundHistoryRecord[],
): Promise<IRoundHistoryResponse> {
  const pages = paginateRoundHistory(allRounds);
  const totalPages = Math.max(1, pages.length);
  const safePage = Math.min(Math.max(state.page, 0), totalPages - 1);
  const page = pages[safePage];
  const cards = page?.cards ?? [];

  const payloads = await buildGotmSearchMessages(client, cards, {
    title: `Round History - ${state.year}`,
    continuationTitle: `Round History - ${state.year} (continued)`,
    emptyMessage: "No rounds matched your filters.",
    introText: buildRoundHistoryIntro(
      { ...state, page: safePage },
      allRounds.length,
      totalPages,
      page,
    ),
    guildId,
    maxGamesPerContainer: ROUND_HISTORY_GAMES_PER_PAGE,
    maxContainersPerMessage: 1,
  });

  const payload = payloads[0] ?? { components: [], files: [] };
  const paginationRow = buildRoundHistoryPaginationRow({ ...state, page: safePage }, totalPages);
  const components = paginationRow ? [...payload.components, paginationRow] : payload.components;
  return {
    // eslint-disable-next-line local/dynamic-components-require-chunking
    components,
    files: payload.files,
    totalPages,
    safePage,
  };
}

@Discord()
@SlashGroup("gotm")
export class RoundHistoryCommand {
  @Slash({ description: "Query historical GOTM/NR-GOTM rounds", name: "history" })
  async roundHistory(
    @SlashOption({
      description: "Send reply privately (only visible to you).",
      name: "private",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    privateFlag: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const sessionId = buildRoundHistorySessionId(interaction.user.id, Boolean(privateFlag));
    let modal: ModalBuilder | null = null;
    let modalJson: unknown = null;

    try {
      modal = buildRoundHistoryModal(sessionId);
      modalJson = modal.toJSON();
      logRoundHistoryModalDebug("open.before_show", {
        sessionId,
        privateFlag: Boolean(privateFlag),
        modalConstructor: modal.constructor.name,
        hasToJson: typeof modal.toJSON === "function",
        customId: (modalJson as { custom_id?: unknown }).custom_id,
        componentSummary: getRoundHistoryModalComponentSummary(modalJson),
      });

      await interaction.showModal(modal);
      logRoundHistoryModalDebug("open.show_success", {
        sessionId,
      });
    } catch (error: unknown) {
      const errorMessage = buildCaughtErrorMessage("Unable to open round history form", error);
      let postErrorJson: unknown = modalJson;
      let postErrorJsonError: unknown = null;
      if (modal && !postErrorJson) {
        try {
          postErrorJson = modal.toJSON();
        } catch (jsonError: unknown) {
          postErrorJsonError = jsonError;
        }
      }
      logRoundHistoryModalDebug("open.show_failed", {
        sessionId,
        privateFlag: Boolean(privateFlag),
        error: error instanceof Error ? error : String(error),
        modalConstructor: modal?.constructor.name ?? "none",
        hasModalToJson: modal ? typeof modal.toJSON === "function" : false,
        postErrorJsonError:
          postErrorJsonError instanceof Error ? postErrorJsonError : String(postErrorJsonError ?? ""),
        componentSummary: getRoundHistoryModalComponentSummary(postErrorJson),
      });
      await safeReply(interaction, buildErrorReply(errorMessage, true));
    }
  }

  @ModalComponent({ id: /^modal:round-history:v1:query:[A-Za-z0-9_-]{1,64}$/ })
  async submitRoundHistoryModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsedCustomId = parseRoundHistoryModalCustomId(interaction.customId);
    const query = sanitizeUserInput(
      interaction.fields.getTextInputValue(ROUND_HISTORY_QUERY_ID) ?? "",
      { preserveNewlines: false, maxLength: 30 },
    );
    const selectedKind = parseKind(extractSingleValueFromModal(interaction, ROUND_HISTORY_KIND_ID));
    const selectedSort = parseSort(extractSingleValueFromModal(interaction, ROUND_HISTORY_SORT_ID)) ?? "asc";
    const selectedYearRaw = extractSingleValueFromModal(interaction, ROUND_HISTORY_YEAR_ID);
    const selectedYear = Number(selectedYearRaw);

    if (!parsedCustomId) {
      await safeReply(interaction, buildTextReply(
        "This round history form is invalid. " +
          `Please run ${commandMention("gotm history")} again.`,
        true,
      ));
      return;
    }

    if (!selectedKind) {
      await safeReply(interaction, buildTextReply("Please choose GOTM, NR-GOTM, or Both.", true));
      return;
    }

    const year = Number.isInteger(selectedYear) ? selectedYear : getCurrentYear();
    const privateFlag = parsePrivateFlagFromSessionId(parsedCustomId.sessionId);
    const ephemeral = privateFlag === null ? true : (privateFlag ?? false);
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(ephemeral) });

    const response = await buildRoundHistoryResponse(interaction, {
      ownerUserId: interaction.user.id,
      kind: selectedKind,
      query,
      year,
      sort: selectedSort,
      page: 0,
    });

    await safeReply(interaction, {
      components: response.components,
      files: response.files.length ? response.files : undefined,
      flags: buildComponentsV2Flags(ephemeral),
    });
  }

  @ButtonComponent({ id: /^round-history-page:\d+:[gnb]:\d{4}:[ad]:\d+:[A-Za-z0-9_-]+$/ })
  async handleRoundHistoryPageButton(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseRoundHistoryPageCustomId(interaction.customId);
    if (!parsed) {
      await safeReply(interaction, buildTextReply(
        "This round history page control is invalid. " +
          `Please run ${commandMention("gotm history")} again.`, true));
      return;
    }

    if (parsed.ownerUserId !== interaction.user.id) {
      await safeReply(interaction, buildTextReply("Only the user who opened this round history view can use these controls.", true));
      return;
    }

    await safeDeferUpdate(interaction);

    const response = await buildRoundHistoryResponse(interaction, parsed);
    await safeEditReply(interaction, {
      content: null,
      components: response.components,
      files: response.files.length ? response.files : [],
    });
  }
}
