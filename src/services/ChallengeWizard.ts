import {
  ActionRowBuilder,
  ButtonBuilder,
  CheckboxGroupBuilder,
  ContainerBuilder,
  LabelBuilder,
  ModalBuilder,
  RadioGroupBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
} from "@discordjs/builders";
import {
  ButtonStyle,
  MessageFlags,
  TextInputStyle,
} from "discord-api-types/v10";
import { safeV2TextContent } from "../functions/ComponentsV2Utils.js";
import {
  CHALLENGE_FORMAT_LABELS,
  describePool,
  describePoolTarget,
  escapeChallengeText,
  formatChallengeDate,
  formatMonthDay,
  listJoin,
  parseChallengeDate,
  parseMonthDay,
} from "../functions/ChallengeCopy.js";
import {
  buildChallengeWizardId,
  type ChallengeWizardAction,
} from "../functions/ChallengeCustomIds.js";
import {
  DISCORD_SELECT_LABEL_MAX,
  DISCORD_SELECT_OPTIONS_MAX,
  MAX_CONTAINER_TEXT,
} from "../config/textLimits.js";
import {
  buildCoverWall,
  challengeRuleLines,
  COVER_WALL_MAX,
} from "./ChallengeAnnouncements.js";
import type { IChallengeView } from "./ChallengeBrowse.js";
import {
  CHALLENGE_API,
  challengeRefusalText,
  type ChallengeSchedule,
  type IChallenge,
  type IChallengeApi,
  type IChallengePool,
  type IChallengeSlots,
  type IChallengeWrite,
  type IGameSummary,
  type IPage,
  type IPoolDefinition,
  type IPoolSource,
  type PoolTarget,
} from "./ChallengeApi.js";

// /challenge create and the rules part of /challenge edit (spec api#376), design 6C "Two
// modals and a cover preview": a basics modal, the Format's settings modal, the pick of
// franchises and collections, then a preview of the Pool's covers where games are left
// out or added by hand before saving. A Slots Challenge (bot#1550) sets Counts past play in
// the basics modal and its first and last year in the settings modal, then is previewed
// in words. The draft is plain data, saved with the wizard session so every step resumes
// after a restart.

/** The Formats this wizard builds. */
export type WizardFormat = "pool" | "slots" | "assignment";

const WIZARD_FORMATS: readonly string[] = ["pool", "slots", "assignment"];

export type WizardStep = "basics" | "sources" | "preview";

export interface INamedId {
  id: number;
  name: string;
}

export interface IWizardGame {
  id: number;
  title: string;
}

export interface IIncludeChoice extends IWizardGame {
  year: number | null;
}

export interface IChallengeDraft {
  mode: "create" | "edit";
  /** The Challenge being edited; null while creating. */
  challengeId: number | null;
  ownerId: string;
  /** Create only: the club is the Host (Moderators and above; the API decides). */
  clubHosted: boolean;
  step: WizardStep;
  name: string;
  description: string;
  format: WizardFormat;
  schedule: ChallengeSchedule;
  /** Seasonal: the Season as MM-DD. */
  season: { start: string; end: string } | null;
  /** Always Open: the last Open day, as an ISO date. */
  endsOn: string | null;
  pool: {
    franchises: INamedId[];
    collections: INamedId[];
    included: IWizardGame[];
    excluded: IWizardGame[];
    target: PoolTarget;
  };
  /** Assignment: the Edition calendar as MM-DD. */
  assignment: { signupCutoff: string; pickDeadline: string; reveal: string };
  /** Slots: the range, and Counts past play (Always Open only). */
  slots: {
    firstYear: number | "birth_year";
    lastYear: number | "current_year";
    countsPastPlay: boolean;
  };
  /** The last franchise and collection search's results. */
  sourceResults: IPoolSource[];
  /** The last "Include a game" search's results. */
  includeChoices: IIncludeChoice[];
  /** The page of the exclude pick in the preview. */
  previewPage: number;
}

export type IChallengeWizardApi = Pick<
  IChallengeApi,
  "createChallenge" | "updateChallenge" | "poolPreview" | "poolSources"
>;

/** The custom IDs of the modals' inputs. */
export const WIZARD_FIELDS = {
  name: "challenge-name",
  description: "challenge-description",
  format: "challenge-format",
  schedule: "challenge-schedule",
  seasonStart: "challenge-season-start",
  seasonEnd: "challenge-season-end",
  endsOn: "challenge-ends-on",
  target: "challenge-target",
  targetCount: "challenge-target-count",
  search: "challenge-search",
  signupCutoff: "challenge-signup-cutoff",
  pickDeadline: "challenge-pick-deadline",
  reveal: "challenge-reveal",
  includeQuery: "challenge-include-query",
  countsPastPlay: "challenge-counts-past-play",
  firstYear: "challenge-first-year",
  firstYearFixed: "challenge-first-year-fixed",
  lastYear: "challenge-last-year",
  lastYearFixed: "challenge-last-year-fixed",
  season: "challenge-season",
} as const;

/** The value of Counts past play's one checkbox when it is ticked. */
export const COUNTS_PAST_PLAY_ON = "on";

/** The modal fields each modal holds, so the command can read them by kind. */
export const WIZARD_RADIO_FIELDS: readonly string[] = [
  WIZARD_FIELDS.format,
  WIZARD_FIELDS.schedule,
  WIZARD_FIELDS.target,
  WIZARD_FIELDS.firstYear,
  WIZARD_FIELDS.lastYear,
];

/** The checkbox groups, read as their one ticked value or null. */
export const WIZARD_CHECKBOX_FIELDS: readonly string[] = [WIZARD_FIELDS.countsPastPlay];

/** A modal's answers: text inputs as typed, radio groups as their value or null. */
export type WizardFields = Readonly<Record<string, string | null | undefined>>;

const NAME_MAX = 100;
const DESCRIPTION_MAX = 2000;
/** Games in one page of the exclude pick (a select holds 25 options). */
const EXCLUDE_PAGE_SIZE = DISCORD_SELECT_OPTIONS_MAX;
const SECRET_SANTA_CALENDAR = { signupCutoff: "12-01", pickDeadline: "12-15", reveal: "12-25" };
const YEARS_ALIVE: IChallengeDraft["slots"] = {
  firstYear: "birth_year",
  lastYear: "current_year",
  countsPastPlay: false,
};

export function newChallengeDraft(ownerId: string, clubHosted: boolean): IChallengeDraft {
  return {
    mode: "create",
    challengeId: null,
    ownerId,
    clubHosted,
    step: "basics",
    name: "",
    description: "",
    format: "pool",
    schedule: "seasonal",
    season: null,
    endsOn: null,
    pool: { franchises: [], collections: [], included: [], excluded: [], target: 1 },
    assignment: { ...SECRET_SANTA_CALENDAR },
    slots: { ...YEARS_ALIVE },
    sourceResults: [],
    includeChoices: [],
    previewPage: 1,
  };
}

function draftPool(pool: IChallengePool): IChallengeDraft["pool"] {
  return {
    franchises: (pool.franchises ?? []).map((f) => ({ id: f.franchise_id, name: f.name })),
    collections: (pool.collections ?? []).map((c) => ({ id: c.collection_id, name: c.name })),
    included: (pool.included_games ?? []).map((g) => ({ id: g.game_id, title: g.title })),
    excluded: (pool.excluded_games ?? []).map((g) => ({ id: g.game_id, title: g.title })),
    target: pool.target,
  };
}

function draftSlots(slots: IChallengeSlots): IChallengeDraft["slots"] {
  return {
    firstYear: slots.first_year,
    lastYear: slots.last_year,
    countsPastPlay: slots.counts_past_play,
  };
}

/** The draft for editing a Challenge's rules, starting at basics. */
export function draftFromChallenge(challenge: IChallenge, ownerId: string): IChallengeDraft {
  const draft = newChallengeDraft(ownerId, false);
  const assignment = challenge.assignment;
  return {
    ...draft,
    mode: "edit",
    challengeId: challenge.id,
    name: challenge.name,
    description: challenge.description,
    format: challenge.challenge_format,
    schedule: challenge.schedule,
    season: challenge.season
      ? { start: challenge.season.start, end: challenge.season.end }
      : null,
    endsOn: challenge.ends_on ?? null,
    pool: challenge.pool ? draftPool(challenge.pool) : draft.pool,
    assignment: assignment
      ? {
        signupCutoff: assignment.signup_cutoff,
        pickDeadline: assignment.pick_deadline,
        reveal: assignment.reveal,
      }
      : draft.assignment,
    slots: challenge.slots ? draftSlots(challenge.slots) : draft.slots,
  };
}

function isYear(value: unknown, keyword: string): boolean {
  return value === keyword || Number.isInteger(value);
}

function isNamedIdList(value: unknown): value is INamedId[] {
  return Array.isArray(value) && value.every((item) =>
    !!item && typeof item.id === "number" && typeof item.name === "string");
}

function isGameList(value: unknown): value is IWizardGame[] {
  return Array.isArray(value) && value.every((item) =>
    !!item && typeof item.id === "number" && typeof item.title === "string");
}

/** A draft restored from a saved session, or null when the saved state is not one. */
export function challengeDraftFromState(state: unknown): IChallengeDraft | null {
  if (!state || typeof state !== "object") return null;
  const draft = state as IChallengeDraft;
  const pool = draft.pool as Partial<IChallengeDraft["pool"]> | undefined;
  const valid =
    (draft.mode === "create" || draft.mode === "edit") &&
    typeof draft.ownerId === "string" &&
    ["basics", "sources", "preview"].includes(draft.step) &&
    typeof draft.name === "string" &&
    typeof draft.description === "string" &&
    WIZARD_FORMATS.includes(draft.format) &&
    !!pool &&
    isNamedIdList(pool.franchises) &&
    isNamedIdList(pool.collections) &&
    isGameList(pool.included) &&
    isGameList(pool.excluded) &&
    !!draft.assignment &&
    Array.isArray(draft.sourceResults) &&
    Array.isArray(draft.includeChoices);
  if (!valid) return null;
  // A draft saved before Slots joined has no slots: it gets the defaults.
  const slots = draft.slots as Partial<IChallengeDraft["slots"]> | undefined;
  const slotsValid = !!slots && isYear(slots.firstYear, "birth_year") &&
    isYear(slots.lastYear, "current_year") && typeof slots.countsPastPlay === "boolean";
  return {
    ...draft,
    slots: slotsValid ? draft.slots : { ...YEARS_ALIVE },
    previewPage: Math.max(1, Number(draft.previewPage) || 1),
  };
}

function field(fields: WizardFields, id: string): string {
  return (fields[id] ?? "").trim();
}

/** Applies the basics modal. Errors leave the draft as it was. */
export function applyBasics(
  draft: IChallengeDraft,
  fields: WizardFields,
): { draft: IChallengeDraft; errors: string[] } {
  const name = field(fields, WIZARD_FIELDS.name);
  const description = field(fields, WIZARD_FIELDS.description);
  const format = field(fields, WIZARD_FIELDS.format);
  const schedule = field(fields, WIZARD_FIELDS.schedule);
  const countsPastPlay = field(fields, WIZARD_FIELDS.countsPastPlay) === COUNTS_PAST_PLAY_ON;
  const errors: string[] = [];
  if (!name) errors.push("Give the Challenge a name.");
  if (!WIZARD_FORMATS.includes(format)) errors.push("Choose a Challenge Format.");
  if (schedule !== "always_open" && schedule !== "seasonal") errors.push("Choose a schedule.");
  if (countsPastPlay && WIZARD_FORMATS.includes(format) && format !== "slots") {
    errors.push("Counts past play is only for Slots Challenges.");
  } else if (countsPastPlay && schedule === "seasonal") {
    errors.push("Counts past play is only for Always Open Challenges.");
  }
  if (errors.length) return { draft, errors };
  return {
    draft: {
      ...draft,
      step: "basics",
      name: name.slice(0, NAME_MAX),
      description: description.slice(0, DESCRIPTION_MAX),
      format: format as WizardFormat,
      // An Assignment Challenge runs in Editions: Always Open, with no end date.
      schedule: format === "assignment" ? "always_open" : schedule as ChallengeSchedule,
      slots: { ...draft.slots, countsPastPlay },
    },
    errors: [],
  };
}

function monthDayError(label: string, value: string): string {
  return `${label}: "${value}" is not a day and month, such as 21 June.`;
}

function readMonthDay(
  fields: WizardFields,
  id: string,
  label: string,
  errors: string[],
): string | null {
  const value = field(fields, id);
  const parsed = parseMonthDay(value);
  if (!parsed) errors.push(value ? monthDayError(label, value) : `${label}: give a day and month.`);
  return parsed;
}

function applyAssignmentSettings(
  draft: IChallengeDraft,
  fields: WizardFields,
): { draft: IChallengeDraft; errors: string[] } {
  const errors: string[] = [];
  const signupCutoff = readMonthDay(fields, WIZARD_FIELDS.signupCutoff, "Sign-up closes", errors);
  const pickDeadline = readMonthDay(fields, WIZARD_FIELDS.pickDeadline, "Picks due", errors);
  const reveal = readMonthDay(fields, WIZARD_FIELDS.reveal, "Reveal", errors);
  if (errors.length || !signupCutoff || !pickDeadline || !reveal) return { draft, errors };
  return {
    draft: {
      ...draft,
      step: "preview",
      schedule: "always_open",
      season: null,
      endsOn: null,
      assignment: { signupCutoff, pickDeadline, reveal },
    },
    errors: [],
  };
}

/** A fixed year typed in the Slots modal, or null with the reason added to `errors`. */
function readYear(
  fields: WizardFields,
  id: string,
  label: string,
  example: number,
  errors: string[],
): number | null {
  const value = field(fields, id);
  if (!value) {
    errors.push(`${label}: give a year, such as ${example}.`);
    return null;
  }
  const year = Number(value);
  if (!/^\d{4}$/.test(value) || !Number.isInteger(year)) {
    errors.push(`${label}: "${value}" is not a year, such as ${example}.`);
    return null;
  }
  return year;
}

/** "21 June to 22 September" as a Season, or null when it is not one. */
function parseSeason(value: string): { start: string; end: string } | null {
  const parts = value.split(/\s+(?:to|until|-)\s+/i);
  if (parts.length !== 2) return null;
  const start = parseMonthDay(parts[0]!);
  const end = parseMonthDay(parts[1]!);
  return start && end ? { start, end } : null;
}

/** Applies the Slots settings modal: the first and last year, and the schedule's dates. */
function applySlotsSettings(
  draft: IChallengeDraft,
  fields: WizardFields,
): { draft: IChallengeDraft; errors: string[] } {
  const errors: string[] = [];
  const firstYear = field(fields, WIZARD_FIELDS.firstYear) === "fixed"
    ? readYear(fields, WIZARD_FIELDS.firstYearFixed, "Fixed first year", 1990, errors)
    : "birth_year";
  const lastYear = field(fields, WIZARD_FIELDS.lastYear) === "fixed"
    ? readYear(fields, WIZARD_FIELDS.lastYearFixed, "Fixed last year", 1999, errors)
    : "current_year";
  if (typeof firstYear === "number" && typeof lastYear === "number" && firstYear > lastYear) {
    errors.push("The first year can't come after the last year.");
  }
  let season: IChallengeDraft["season"] = null;
  let endsOn: string | null = null;
  if (draft.schedule === "seasonal") {
    const typed = field(fields, WIZARD_FIELDS.season);
    season = parseSeason(typed);
    if (!season) {
      errors.push(typed
        ? `Season: "${typed}" is not two days and months, such as 21 June to 22 September.`
        : "Season: give its first and last day, such as 21 June to 22 September.");
    }
  } else {
    const typed = field(fields, WIZARD_FIELDS.endsOn);
    endsOn = typed ? parseChallengeDate(typed) : null;
    if (typed && !endsOn) errors.push(`End date: "${typed}" is not a date, such as 3 March 2027.`);
  }
  if (errors.length || firstYear === null || lastYear === null) return { draft, errors };
  return {
    draft: {
      ...draft,
      step: "preview",
      season,
      endsOn,
      slots: { ...draft.slots, firstYear, lastYear },
    },
    errors: [],
  };
}

function hasPoolDefinition(pool: IChallengeDraft["pool"]): boolean {
  return pool.franchises.length + pool.collections.length + pool.included.length > 0;
}

/**
 * Applies the Format's settings modal. For a Pool, a search runs the franchise and
 * collection lookup and moves to the pick; with no search, a Pool that already has games
 * moves to the preview. Errors leave the draft as it was.
 */
export async function applySettings(
  draft: IChallengeDraft,
  fields: WizardFields,
  api: Pick<IChallengeWizardApi, "poolSources"> = CHALLENGE_API,
): Promise<{ draft: IChallengeDraft; errors: string[] }> {
  if (draft.format === "assignment") return applyAssignmentSettings(draft, fields);
  if (draft.format === "slots") return applySlotsSettings(draft, fields);

  const errors: string[] = [];
  let season: IChallengeDraft["season"] = null;
  let endsOn: string | null = null;
  if (draft.schedule === "seasonal") {
    const start = readMonthDay(fields, WIZARD_FIELDS.seasonStart, "Season starts", errors);
    const end = readMonthDay(fields, WIZARD_FIELDS.seasonEnd, "Season ends", errors);
    season = start && end ? { start, end } : null;
  } else {
    const typed = field(fields, WIZARD_FIELDS.endsOn);
    endsOn = typed ? parseChallengeDate(typed) : null;
    if (typed && !endsOn) {
      errors.push(`End date: "${typed}" is not a date, such as 3 March 2027.`);
    }
  }

  let target: PoolTarget = "all";
  if (field(fields, WIZARD_FIELDS.target) !== "all") {
    const count = Number(field(fields, WIZARD_FIELDS.targetCount));
    if (!Number.isInteger(count) || count < 1 || !field(fields, WIZARD_FIELDS.targetCount)) {
      errors.push(
        "Games to Clear: give a whole number of 1 or more, or choose every game in the Pool.",
      );
    } else {
      target = count;
    }
  }

  const query = field(fields, WIZARD_FIELDS.search);
  let sourceResults = draft.sourceResults;
  if (!errors.length && query) {
    sourceResults = await api.poolSources(query);
    if (!sourceResults.length) {
      errors.push(`Nothing in the GameDB matches "${query}". Try another search.`);
    }
  }
  if (!errors.length && !query && !hasPoolDefinition(draft.pool)) {
    errors.push("Search for a franchise or collection to build the Pool from.");
  }
  if (errors.length) return { draft, errors };
  return {
    draft: {
      ...draft,
      step: query ? "sources" : "preview",
      season,
      endsOn,
      pool: { ...draft.pool, target },
      sourceResults,
      previewPage: 1,
    },
    errors: [],
  };
}

function sourceValue(source: { kind: string; id: number }): string {
  return `${source.kind}:${source.id}`;
}

/** The options of the franchise and collection pick: the last results, then the chosen. */
function sourceOptions(draft: IChallengeDraft): { value: string; label: string }[] {
  const options = draft.sourceResults.map((source) => ({
    value: sourceValue(source),
    label: `${source.name} (${source.kind}, ${source.game_count} ` +
      `${source.game_count === 1 ? "game" : "games"})`,
  }));
  const chosen = [
    ...draft.pool.franchises.map((f) => ({ value: `franchise:${f.id}`, label: `${f.name} (franchise)` })),
    ...draft.pool.collections.map((c) => ({
      value: `collection:${c.id}`,
      label: `${c.name} (collection)`,
    })),
  ];
  for (const option of chosen) {
    if (!options.some((o) => o.value === option.value)) options.push(option);
  }
  return options.slice(0, DISCORD_SELECT_OPTIONS_MAX);
}

/**
 * Applies the franchise and collection pick: the ticked ones join the Pool and the ones
 * offered but left unticked leave it.
 */
export function applySourcePick(
  draft: IChallengeDraft,
  values: readonly string[],
): IChallengeDraft {
  const offered = new Set(sourceOptions(draft).map((o) => o.value));
  const picked = new Set(values);
  const keep = (kind: string) => (item: INamedId) => {
    const value = `${kind}:${item.id}`;
    return !offered.has(value) || picked.has(value);
  };
  const franchises = draft.pool.franchises.filter(keep("franchise"));
  const collections = draft.pool.collections.filter(keep("collection"));
  for (const source of draft.sourceResults) {
    if (!picked.has(sourceValue(source))) continue;
    const list = source.kind === "franchise" ? franchises : collections;
    if (!list.some((item) => item.id === source.id)) {
      list.push({ id: source.id, name: source.name });
    }
  }
  return { ...draft, pool: { ...draft.pool, franchises, collections }, previewPage: 1 };
}

/**
 * Applies a page of the exclude pick: of the games `shown`, the ticked ones are left out
 * and the rest put back. Ticking a game added by hand takes it back out of the Pool.
 */
export function applyExcludePick(
  draft: IChallengeDraft,
  shown: readonly IWizardGame[],
  values: readonly string[],
): IChallengeDraft {
  const ticked = new Set(values.map(Number));
  const shownIds = new Set(shown.map((game) => game.id));
  const included = draft.pool.included.filter((game) => !ticked.has(game.id));
  const excluded = draft.pool.excluded.filter((game) => !shownIds.has(game.id));
  for (const game of shown) {
    const byHand = draft.pool.included.some((g) => g.id === game.id);
    if (ticked.has(game.id) && !byHand) excluded.push({ id: game.id, title: game.title });
  }
  return { ...draft, pool: { ...draft.pool, included, excluded } };
}

/** Runs the "Include a game" search; the preview then offers what it found. */
export async function applyIncludeSearch(
  draft: IChallengeDraft,
  query: string,
  searchGames: (query: string) => Promise<IIncludeChoice[]>,
): Promise<IChallengeDraft> {
  const choices = query.trim() ? await searchGames(query.trim()) : [];
  return { ...draft, includeChoices: choices.slice(0, DISCORD_SELECT_OPTIONS_MAX) };
}

/** Adds the picked game to the Pool by hand (and no longer leaves it out). */
export function applyIncludePick(draft: IChallengeDraft, value: string): IChallengeDraft {
  const choice = draft.includeChoices.find((c) => String(c.id) === value);
  if (!choice) return { ...draft, includeChoices: [] };
  const included = draft.pool.included.some((g) => g.id === choice.id)
    ? draft.pool.included
    : [...draft.pool.included, { id: choice.id, title: choice.title }];
  return {
    ...draft,
    includeChoices: [],
    pool: {
      ...draft.pool,
      included,
      excluded: draft.pool.excluded.filter((g) => g.id !== choice.id),
    },
  };
}

function poolDefinition(draft: IChallengeDraft, withExcluded: boolean): IPoolDefinition {
  return {
    franchise_ids: draft.pool.franchises.map((f) => f.id),
    collection_ids: draft.pool.collections.map((c) => c.id),
    included_game_ids: draft.pool.included.map((g) => g.id),
    excluded_game_ids: withExcluded ? draft.pool.excluded.map((g) => g.id) : [],
  };
}

function slotsOf(draft: IChallengeDraft): IChallengeSlots {
  return {
    first_year: draft.slots.firstYear,
    last_year: draft.slots.lastYear,
    // Always Open only; a Seasonal draft never sends it on.
    counts_past_play: draft.schedule === "always_open" && draft.slots.countsPastPlay,
  };
}

/** The create or edit body for the draft. */
export function challengeWriteOf(draft: IChallengeDraft): IChallengeWrite {
  const write: IChallengeWrite = {
    name: draft.name,
    description: draft.description,
    challenge_format: draft.format,
    schedule: draft.schedule,
    season: draft.schedule === "seasonal" ? draft.season : null,
    ends_on: draft.schedule === "always_open" ? draft.endsOn : null,
  };
  if (draft.format === "pool") {
    write.pool = { ...poolDefinition(draft, true), target: draft.pool.target };
  } else if (draft.format === "slots") {
    write.slots = slotsOf(draft);
  } else {
    write.assignment = {
      signup_cutoff: draft.assignment.signupCutoff,
      pick_deadline: draft.assignment.pickDeadline,
      reveal: draft.assignment.reveal,
    };
  }
  if (draft.mode === "create" && draft.clubHosted) write.hosted_by_club = true;
  return write;
}

function text(content: string): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(safeV2TextContent(content, MAX_CONTAINER_TEXT));
}

function button(
  sessionId: string,
  action: ChallengeWizardAction,
  label: string,
  style: ButtonStyle = ButtonStyle.Secondary,
  disabled = false,
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(buildChallengeWizardId(action, sessionId))
    .setLabel(label)
    .setStyle(style)
    .setDisabled(disabled);
}

type Row = ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>;

function wizardView(container: ContainerBuilder, rows: Row[]): IChallengeView {
  return {
    components: [container.toJSON(), ...rows.map((row) => row.toJSON())],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

function buttonRow(...buttons: ButtonBuilder[]): Row {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
}

function settingsLabel(draft: IChallengeDraft): string {
  return `${CHALLENGE_FORMAT_LABELS[draft.format]} settings`;
}

function noticeLines(notice: readonly string[]): string[] {
  return notice.length ? [...notice, ""] : [];
}

function stepTitle(draft: IChallengeDraft): string {
  return draft.mode === "create" ? "New Challenge" : `Editing ${escapeChallengeText(draft.name)}`;
}

function basicsView(sessionId: string, draft: IChallengeDraft, notice: string[]): IChallengeView {
  const schedule = draft.format === "assignment"
    ? "Always Open, in Editions"
    : draft.schedule === "seasonal" ? "Seasonal" : "Always Open";
  const lines = [
    ...noticeLines(notice),
    `### ${stepTitle(draft)} (1 of 2)`,
    `**${escapeChallengeText(draft.name)}** · ${CHALLENGE_FORMAT_LABELS[draft.format]} · ${schedule}`,
    `Next: the ${settingsLabel(draft)}.`,
  ];
  return wizardView(new ContainerBuilder().addTextDisplayComponents(text(lines.join("\n"))), [
    buttonRow(
      button(sessionId, "settings", settingsLabel(draft), ButtonStyle.Primary),
      button(sessionId, "basics", "Edit basics"),
      button(sessionId, "cancel", "Cancel"),
    ),
  ]);
}

function chosenSources(draft: IChallengeDraft): string {
  const parts = [
    ...draft.pool.franchises.map((f) => `the ${escapeChallengeText(f.name)} franchise`),
    ...draft.pool.collections.map((c) => `the ${escapeChallengeText(c.name)} collection`),
  ];
  return parts.length ? listJoin(parts) : "nothing yet";
}

function sourcesView(sessionId: string, draft: IChallengeDraft, notice: string[]): IChallengeView {
  const lines = [
    ...noticeLines(notice),
    `### ${stepTitle(draft)} (2 of 2): the Pool`,
    "Pick the franchises and collections whose games are in the Pool. " +
      "You can leave games out, or add others by hand, in the preview.",
    `Chosen: ${chosenSources(draft)}`,
  ];
  const options = sourceOptions(draft);
  const chosen = new Set([
    ...draft.pool.franchises.map((f) => `franchise:${f.id}`),
    ...draft.pool.collections.map((c) => `collection:${c.id}`),
  ]);
  const rows: Row[] = [];
  if (options.length) {
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(buildChallengeWizardId("sources", sessionId))
        .setPlaceholder("Franchises and collections")
        .setMinValues(0)
        .setMaxValues(options.length)
        .addOptions(...options.map((option) => ({
          label: option.label.slice(0, DISCORD_SELECT_LABEL_MAX),
          value: option.value,
          default: chosen.has(option.value),
        }))),
    ));
  }
  rows.push(buttonRow(
    button(sessionId, "preview", "Preview", ButtonStyle.Primary, !hasPoolDefinition(draft.pool)),
    button(sessionId, "settings", "Search again"),
    button(sessionId, "cancel", "Cancel"),
  ));
  return wizardView(new ContainerBuilder().addTextDisplayComponents(text(lines.join("\n"))), rows);
}

function scheduleSummary(draft: IChallengeDraft): string {
  if (draft.format === "assignment") return "Always Open, in Editions";
  if (draft.schedule === "seasonal" && draft.season) {
    return `Seasonal, ${formatMonthDay(draft.season.start)} to ${formatMonthDay(draft.season.end)}`;
  }
  return draft.endsOn ? `Always Open until ${formatChallengeDate(draft.endsOn)}` : "Always Open";
}

function saveButton(sessionId: string, draft: IChallengeDraft): ButtonBuilder {
  return button(
    sessionId,
    "save",
    draft.mode === "create" ? "Create Challenge" : "Save changes",
    ButtonStyle.Success,
  );
}

function assignmentPreview(
  sessionId: string,
  draft: IChallengeDraft,
  notice: string[],
): IChallengeView {
  const { signupCutoff, pickDeadline, reveal } = draft.assignment;
  const lines = [
    ...noticeLines(notice),
    `## Preview: ${escapeChallengeText(draft.name)}`,
    `-# Assignment · ${scheduleSummary(draft)}`,
    draft.description,
    `**Each Edition** Sign-up closes ${formatMonthDay(signupCutoff)}, Santas pick by ` +
      `${formatMonthDay(pickDeadline)}, and the picks are revealed ${formatMonthDay(reveal)}.`,
  ].filter(Boolean);
  return wizardView(new ContainerBuilder().addTextDisplayComponents(text(lines.join("\n"))), [
    buttonRow(
      saveButton(sessionId, draft),
      button(sessionId, "basics", "Back"),
      button(sessionId, "cancel", "Cancel"),
    ),
  ]);
}

/** A Slots Challenge's preview: its rules in words (the year strip is drawn for the post). */
function slotsPreview(
  sessionId: string,
  draft: IChallengeDraft,
  notice: string[],
): IChallengeView {
  const rules = challengeRuleLines({
    ...challengeOfDraft(draft),
    slots: slotsOf(draft),
  });
  const lines = [
    ...noticeLines(notice),
    `## Preview: ${escapeChallengeText(draft.name)}`,
    `-# Slots · ${scheduleSummary(draft)}`,
    draft.description,
    ...rules,
  ].filter(Boolean);
  return wizardView(new ContainerBuilder().addTextDisplayComponents(text(lines.join("\n"))), [
    buttonRow(
      saveButton(sessionId, draft),
      button(sessionId, "basics", "Back"),
      button(sessionId, "cancel", "Cancel"),
    ),
  ]);
}

/** The draft as a Challenge, for the rule lines the posts share. */
function challengeOfDraft(draft: IChallengeDraft): IChallenge {
  return {
    id: draft.challengeId ?? 0,
    name: draft.name,
    description: draft.description,
    challenge_format: draft.format,
    hosted_by_club: draft.clubHosted,
    schedule: draft.schedule,
    ends_on: draft.endsOn,
    season: draft.season ? { ...draft.season, crosses_new_year: false } : null,
    open: true,
    hidden: false,
  };
}

function yearOf(game: IGameSummary): string | null {
  const year = game.initial_release_date
    ? new Date(game.initial_release_date).getUTCFullYear()
    : NaN;
  return Number.isFinite(year) ? String(year) : null;
}

async function poolPreview(
  sessionId: string,
  draft: IChallengeDraft,
  api: Pick<IChallengeWizardApi, "poolPreview">,
  notice: string[],
): Promise<IChallengeView> {
  const [candidates, resolved]: IPage<IGameSummary>[] = await Promise.all([
    api.poolPreview(poolDefinition(draft, false), draft.previewPage, EXCLUDE_PAGE_SIZE),
    api.poolPreview(poolDefinition(draft, true), 1, COVER_WALL_MAX),
  ]);
  const pool: IChallengePool = {
    target: draft.pool.target,
    franchises: draft.pool.franchises.map((f) => ({ franchise_id: f.id, name: f.name })),
    collections: draft.pool.collections.map((c) => ({ collection_id: c.id, name: c.name })),
    included_games: draft.pool.included.map((g) => ({ game_id: g.id, title: g.title })),
    game_count: resolved.count,
  };
  const container = new ContainerBuilder().addTextDisplayComponents(text([
    ...noticeLines(notice),
    `## Preview: ${escapeChallengeText(draft.name)}`,
    `-# Pool · ${describePoolTarget(pool)} · ${scheduleSummary(draft)}`,
  ].join("\n")));
  const wall = buildCoverWall(resolved.items);
  if (wall) container.addMediaGalleryComponents(wall);
  const details = [describePool(pool)];
  if (draft.pool.excluded.length) {
    details.push(`-# Left out: ${listJoin(draft.pool.excluded.map((g) => escapeChallengeText(g.title)))}`);
  }
  if (candidates.pages > 1) {
    details.push(`-# Leave games out below: page ${draft.previewPage} of ${candidates.pages}`);
  }
  container.addTextDisplayComponents(text(details.join("\n")));

  const rows: Row[] = [];
  const excluded = new Set(draft.pool.excluded.map((g) => g.id));
  if (candidates.items.length) {
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(buildChallengeWizardId("exclude", sessionId))
        .setPlaceholder("Leave games out")
        .setMinValues(0)
        .setMaxValues(candidates.items.length)
        .addOptions(...candidates.items.map((game) => {
          const year = yearOf(game);
          return {
            label: game.title.slice(0, DISCORD_SELECT_LABEL_MAX),
            value: String(game.game_id),
            default: excluded.has(game.game_id),
            ...(year ? { description: year } : {}),
          };
        })),
    ));
  }
  if (draft.includeChoices.length) {
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(buildChallengeWizardId("include-pick", sessionId))
        .setPlaceholder("Pick the game to add")
        .addOptions(...draft.includeChoices.map((choice) => ({
          label: (choice.year ? `${choice.title} (${choice.year})` : choice.title)
            .slice(0, DISCORD_SELECT_LABEL_MAX),
          value: String(choice.id),
        }))),
    ));
  }
  rows.push(buttonRow(
    saveButton(sessionId, draft),
    button(sessionId, "include", "Include a game"),
    button(sessionId, "basics", "Back"),
    button(sessionId, "cancel", "Cancel"),
  ));
  if (candidates.pages > 1) {
    rows.push(buttonRow(
      button(sessionId, "page-prev", "Previous games", ButtonStyle.Secondary,
        draft.previewPage <= 1),
      button(sessionId, "page-next", "More games", ButtonStyle.Secondary,
        draft.previewPage >= candidates.pages),
    ));
  }
  return wizardView(container, rows);
}

/**
 * The message for the draft's step: what was chosen so far and the way on. `notice` lines
 * (errors from the last modal) lead it. API errors from the Pool preview are thrown.
 */
export async function renderWizardStep(
  sessionId: string,
  draft: IChallengeDraft,
  api: Pick<IChallengeWizardApi, "poolPreview"> = CHALLENGE_API,
  notice: readonly string[] = [],
): Promise<IChallengeView> {
  const lines = [...notice];
  if (draft.step === "sources") return sourcesView(sessionId, draft, lines);
  if (draft.step === "preview") {
    if (draft.format === "assignment") return assignmentPreview(sessionId, draft, lines);
    if (draft.format === "slots") return slotsPreview(sessionId, draft, lines);
    return poolPreview(sessionId, draft, api, lines);
  }
  return basicsView(sessionId, draft, lines);
}

/** The message that ends the wizard, for a cancel or a timed-out session. */
export function wizardClosedView(content: string): IChallengeView {
  return wizardView(new ContainerBuilder().addTextDisplayComponents(text(content)), []);
}

/**
 * Creates the Challenge (or saves the edit). Saved: the closing message, with the API's
 * warnings (a duplicate name) as given. Refused: the API's message as given, with the
 * request and response, and the draft is left to change and try again.
 */
export async function saveChallengeDraft(
  draft: IChallengeDraft,
  actingUserId: string,
  api: Pick<IChallengeWizardApi, "createChallenge" | "updateChallenge"> = CHALLENGE_API,
): Promise<{ saved: boolean; view: IChallengeView }> {
  const write = challengeWriteOf(draft);
  try {
    if (draft.mode === "edit" && draft.challengeId) {
      const challenge = await api.updateChallenge(draft.challengeId, write, actingUserId);
      return {
        saved: true,
        view: wizardClosedView(`Saved the changes to **${escapeChallengeText(challenge.name)}**.`),
      };
    }
    const { challenge, warnings } = await api.createChallenge(write, actingUserId);
    const lines = [
      `Created **${escapeChallengeText(challenge.name)}**. ` +
        "It will be announced in #challenges, and `/challenge show` shows it.",
      ...warnings.map((warning) => `-# ${warning.message}`),
    ];
    return { saved: true, view: wizardClosedView(lines.join("\n")) };
  } catch (err: unknown) {
    const fallback = draft.mode === "create"
      ? "Could not create the Challenge."
      : "Could not save the Challenge.";
    return { saved: false, view: wizardClosedView(challengeRefusalText(err, fallback)) };
  }
}

function textInput(
  id: string,
  label: string,
  options: {
    value?: string;
    placeholder?: string;
    required?: boolean;
    style?: TextInputStyle;
    maxLength?: number;
    description?: string;
  } = {},
): LabelBuilder {
  const input = new TextInputBuilder()
    .setCustomId(id)
    .setStyle(options.style ?? TextInputStyle.Short)
    .setRequired(options.required ?? true);
  if (options.value) input.setValue(options.value);
  if (options.placeholder) input.setPlaceholder(options.placeholder);
  if (options.maxLength) input.setMaxLength(options.maxLength);
  const label_ = new LabelBuilder().setLabel(label).setTextInputComponent(input);
  if (options.description) label_.setDescription(options.description);
  return label_;
}

function radio(
  id: string,
  label: string,
  options: { label: string; value: string; description?: string }[],
  selected: string | null,
): LabelBuilder {
  return new LabelBuilder().setLabel(label).setRadioGroupComponent(
    new RadioGroupBuilder()
      .setCustomId(id)
      .setRequired(true)
      .setOptions(...options.map((option) => ({
        ...option,
        default: option.value === selected,
      }))),
  );
}

/** Modal 1: name, description, Challenge Format and schedule. */
export function buildBasicsModal(sessionId: string, draft: IChallengeDraft): ModalBuilder {
  const editing = draft.mode === "edit";
  return new ModalBuilder()
    .setCustomId(buildChallengeWizardId("basics-modal", sessionId))
    .setTitle(editing ? "Edit Challenge (1 of 2)" : "New Challenge (1 of 2)")
    .addLabelComponents(
      textInput(WIZARD_FIELDS.name, "Name", { value: draft.name, maxLength: NAME_MAX }),
      textInput(WIZARD_FIELDS.description, "Description", {
        value: draft.description,
        style: TextInputStyle.Paragraph,
        maxLength: DESCRIPTION_MAX,
      }),
      radio(WIZARD_FIELDS.format, "Challenge Format", [
        { label: "Slots", value: "slots", description: "One game from each year in a range" },
        { label: "Pool", value: "pool", description: "Any game from a set you choose" },
        {
          label: "Assignment",
          value: "assignment",
          description: "Members pick a game from each other's backlog",
        },
      ], editing || draft.name ? draft.format : null),
      radio(WIZARD_FIELDS.schedule, "Schedule", [
        { label: "Always Open", value: "always_open", description: "Join at any time" },
        { label: "Seasonal", value: "seasonal", description: "Open on the same dates every year" },
      ], editing || draft.name ? draft.schedule : null),
      new LabelBuilder().setLabel("Counts past play").setCheckboxGroupComponent(
        new CheckboxGroupBuilder()
          .setCustomId(WIZARD_FIELDS.countsPastPlay)
          .setMinValues(0)
          .setMaxValues(1)
          .setRequired(false)
          .setOptions({
            label: "Let earlier Game Completions be picked",
            value: COUNTS_PAST_PLAY_ON,
            description: "Slots and Always Open only",
            default: draft.slots.countsPastPlay,
          }),
      ),
    );
}

/** Modal 2 for Slots: the first and last year, then the Season or end date. */
function slotsSettingsLabels(draft: IChallengeDraft): LabelBuilder[] {
  const { firstYear, lastYear, countsPastPlay } = draft.slots;
  const labels = [
    radio(WIZARD_FIELDS.firstYear, "First year", [
      {
        label: "Each member's birth year",
        value: "birth_year",
        description: "Members are asked for their Birth Date",
      },
      { label: "A fixed year", value: "fixed" },
    ], firstYear === "birth_year" ? "birth_year" : "fixed"),
    textInput(WIZARD_FIELDS.firstYearFixed, "Fixed first year", {
      value: typeof firstYear === "number" ? String(firstYear) : undefined,
      placeholder: "e.g. 1990",
      required: false,
      maxLength: 4,
    }),
    radio(WIZARD_FIELDS.lastYear, "Last year", [
      {
        label: "The current year",
        value: "current_year",
        description: "Gains a slot every 1 January",
      },
      { label: "A fixed year", value: "fixed" },
    ], lastYear === "current_year" ? "current_year" : "fixed"),
    textInput(WIZARD_FIELDS.lastYearFixed, "Fixed last year", {
      value: typeof lastYear === "number" ? String(lastYear) : undefined,
      placeholder: "e.g. 1999",
      required: false,
      maxLength: 4,
    }),
  ];
  // A modal holds five components: the schedule's dates take the last one.
  if (draft.schedule === "seasonal") {
    labels.push(textInput(WIZARD_FIELDS.season, "Season", {
      value: draft.season
        ? `${formatMonthDay(draft.season.start)} to ${formatMonthDay(draft.season.end)}`
        : undefined,
      placeholder: "21 June to 22 September",
      maxLength: 60,
    }));
  } else {
    labels.push(textInput(WIZARD_FIELDS.endsOn, "End date", {
      value: draft.endsOn ? formatChallengeDate(draft.endsOn) : undefined,
      placeholder: "None, or a date such as 3 March 2027",
      required: false,
      description: `Counts past play was set in step 1 (${countsPastPlay ? "on" : "off"}).`,
    }));
  }
  return labels;
}

/** Modal 2: the Format's settings (a Pool's schedule, target and search; a calendar). */
export function buildSettingsModal(sessionId: string, draft: IChallengeDraft): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(buildChallengeWizardId("settings-modal", sessionId))
    .setTitle(`${settingsLabel(draft)} (2 of 2)`);
  if (draft.format === "assignment") {
    const { signupCutoff, pickDeadline, reveal } = draft.assignment;
    return modal.addLabelComponents(
      textInput(WIZARD_FIELDS.signupCutoff, "Sign-up closes", {
        value: formatMonthDay(signupCutoff),
        description: "The draw happens that day.",
      }),
      textInput(WIZARD_FIELDS.pickDeadline, "Santas pick by", { value: formatMonthDay(pickDeadline) }),
      textInput(WIZARD_FIELDS.reveal, "Picks revealed", { value: formatMonthDay(reveal) }),
    );
  }
  if (draft.format === "slots") return modal.addLabelComponents(...slotsSettingsLabels(draft));
  const labels: LabelBuilder[] = [];
  if (draft.schedule === "seasonal") {
    labels.push(
      textInput(WIZARD_FIELDS.seasonStart, "Season starts", {
        value: draft.season ? formatMonthDay(draft.season.start) : undefined,
        placeholder: "21 June",
      }),
      textInput(WIZARD_FIELDS.seasonEnd, "Season ends", {
        value: draft.season ? formatMonthDay(draft.season.end) : undefined,
        placeholder: "22 September",
      }),
    );
  } else {
    labels.push(textInput(WIZARD_FIELDS.endsOn, "End date", {
      value: draft.endsOn ? formatChallengeDate(draft.endsOn) : undefined,
      placeholder: "None, or a date such as 3 March 2027",
      required: false,
    }));
  }
  const target = draft.pool.target;
  labels.push(
    radio(WIZARD_FIELDS.target, "Target", [
      { label: "A number of games", value: "number" },
      { label: "Every game in the Pool", value: "all" },
    ], target === "all" ? "all" : "number"),
    textInput(WIZARD_FIELDS.targetCount, "Games to Clear", {
      value: typeof target === "number" ? String(target) : undefined,
      required: false,
      maxLength: 4,
    }),
    textInput(WIZARD_FIELDS.search, "Search franchises and collections", {
      required: !hasPoolDefinition(draft.pool),
      description: "You'll choose from the results next.",
      maxLength: 100,
    }),
  );
  return modal.addLabelComponents(...labels);
}

/** The "Include a game" modal: a GameDB title search. */
export function buildIncludeModal(sessionId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(buildChallengeWizardId("include-modal", sessionId))
    .setTitle("Include a game")
    .addLabelComponents(textInput(WIZARD_FIELDS.includeQuery, "Game title", {
      description: "You'll choose from the GameDB matches next.",
      maxLength: 100,
    }));
}
