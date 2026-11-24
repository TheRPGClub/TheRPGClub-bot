import {
  ActionRowBuilder,
  ButtonBuilder,
  CheckboxGroupBuilder,
  ContainerBuilder,
  LabelBuilder,
  ModalBuilder,
  RadioGroupBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
} from "@discordjs/builders";
import {
  ButtonStyle,
  MessageFlags,
  TextInputStyle,
} from "discord-api-types/v10";
import { buildTextContainer, buildTextDisplay } from "../functions/ComponentsV2Utils.js";
import {
  CHALLENGE_FORMAT_LABELS,
  describePoolSources,
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
  DISCORD_BUTTON_LABEL_MAX,
  DISCORD_SELECT_LABEL_MAX,
  DISCORD_SELECT_OPTIONS_MAX,
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
} from "./ChallengeApi.js";
import { franchiseMainlineGames, type IFranchiseGame } from "./ChallengeProposalApi.js";
import { GAME_LIST_API, type IGameListApi } from "./GameListApi.js";
import { plural } from "../utilities/TextUtils.js";
import { logError } from "../utilities/LogUtils.js";

// /challenge create and the rules part of /challenge edit (spec api#376), design 6C "Two
// modals and a cover preview": a basics modal, the Format's settings modal, the pick of
// franchises and Series, then a preview of the Pool's covers where games are left out or
// added by hand before saving. A Pool has Core and Optional Games (spec api#442, ADR 0014,
// bot design 1A "Two lines, one tick-box"): the preview names both, one paged select ticks
// the Core Games (unticked ones stay as Optional Games), and a button sets the Optional
// target. A Pool stays editable once it has Runs: that edit opens straight on the preview
// and changes the Pool alone. A Slots Challenge (bot#1550) sets Counts past play in
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

/**
 * The Game List a Pool is made from (bot#1569): on create, the list `/challenge create
 * from-list:` named, read after the basics modal (`name` null until then); on edit, the
 * linked list, shown only.
 */
export interface IDraftGameList {
  id: number;
  name: string | null;
  /** The games it brought in as Core Games (create). */
  gameCount: number;
  /** Edit: the member may add games to the list from this Challenge (`can_add`). */
  canAdd?: boolean;
}

/** Where "Include a game" puts the game it finds. */
export type IncludeAs = "core" | "optional";

export interface IChallengeDraft {
  mode: "create" | "edit";
  /** The Challenge being edited; null while creating. */
  challengeId: number | null;
  /**
   * Edit only: the Challenge has Runs, so its Format, schedule and Season are locked and
   * only its Pool changes (spec api#442).
   */
  poolOnly?: boolean;
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
    /** IGDB collections, shown as Series. */
    collections: INamedId[];
    /** Core Games: every Run Clears them. Only the Host puts a game here. */
    core: IWizardGame[];
    /** Optional Games picked by hand; the sources bring the rest. */
    optional: IWizardGame[];
    excluded: IWizardGame[];
    /** Optional Games a Run must Clear on top of every Core Game. */
    optionalTarget: number;
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
  /** Where the picked "Include a game" result goes. */
  includeAs: IncludeAs;
  /** The page of the exclude pick in the preview. */
  previewPage: number;
  /** The Game List the Pool is made from or linked to; null when none. */
  gameList?: IDraftGameList | null;
  /** Edit: the Core and hand-picked Optional Games the Pool had when the edit began. */
  handBefore?: number[];
  /**
   * Edit of a linked Pool: whether the games this edit puts in the Pool by hand also go
   * into the list (spec story 30); null or absent until the Host answers, which keeps
   * the list as it is.
   */
  addToList?: boolean | null;
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
  optionalTarget: "challenge-optional-target",
  includeAs: "challenge-include-as",
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
  WIZARD_FIELDS.includeAs,
  WIZARD_FIELDS.firstYear,
  WIZARD_FIELDS.lastYear,
];

/** The checkbox groups, read as their one ticked value or null. */
export const WIZARD_CHECKBOX_FIELDS: readonly string[] = [WIZARD_FIELDS.countsPastPlay];

/** A modal's answers: text inputs as typed, radio groups as their value or null. */
export type WizardFields = Readonly<Record<string, string | null | undefined>>;

const NAME_MAX = 100;
const DESCRIPTION_MAX = 2000;
/** Games in one page of the Core and exclude picks (a select holds 25 options). */
const PICK_PAGE_SIZE = DISCORD_SELECT_OPTIONS_MAX;
/** Core Games named on the preview; past it, the rest are counted. */
const CORE_NAMED_MAX = 15;
/** Hand-picked Optional Games named on the preview; past it, they are counted. */
const HAND_NAMED_MAX = 3;
/** The largest Optional target the modal takes. */
const OPTIONAL_TARGET_MAX = 9999;
const SECRET_SANTA_CALENDAR = { signupCutoff: "12-01", pickDeadline: "12-15", reveal: "12-25" };
const YEARS_ALIVE: IChallengeDraft["slots"] = {
  firstYear: "birth_year",
  lastYear: "current_year",
  countsPastPlay: false,
};

export function newChallengeDraft(
  ownerId: string,
  clubHosted: boolean,
  gameListId: number | null = null,
): IChallengeDraft {
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
    pool: {
      franchises: [],
      collections: [],
      core: [],
      optional: [],
      excluded: [],
      optionalTarget: 0,
    },
    assignment: { ...SECRET_SANTA_CALENDAR },
    slots: { ...YEARS_ALIVE },
    sourceResults: [],
    includeChoices: [],
    includeAs: "core",
    previewPage: 1,
    gameList: gameListId ? { id: gameListId, name: null, gameCount: 0 } : null,
  };
}

function draftPool(pool: IChallengePool): IChallengeDraft["pool"] {
  return {
    franchises: (pool.franchises ?? []).map((f) => ({ id: f.franchise_id, name: f.name })),
    collections: (pool.collections ?? []).map((c) => ({ id: c.collection_id, name: c.name })),
    core: (pool.core_games ?? []).map((g) => ({ id: g.game_id, title: g.title })),
    optional: (pool.optional_games ?? [])
      .filter((g) => g.source === "hand")
      .map((g) => ({ id: g.game_id, title: g.title })),
    excluded: (pool.excluded_games ?? []).map((g) => ({ id: g.game_id, title: g.title })),
    optionalTarget: pool.optional_target ?? 0,
  };
}

function draftSlots(slots: IChallengeSlots): IChallengeDraft["slots"] {
  return {
    firstYear: slots.first_year,
    lastYear: slots.last_year,
    countsPastPlay: slots.counts_past_play,
  };
}

/**
 * The draft for editing a Challenge's rules, starting at basics. A Pool with Runs can only
 * change its Pool, so it starts at the preview.
 */
export function draftFromChallenge(challenge: IChallenge, ownerId: string): IChallengeDraft {
  const draft = newChallengeDraft(ownerId, false);
  const assignment = challenge.assignment;
  const poolOnly = challenge.challenge_format === "pool" && (challenge.run_count ?? 0) > 0;
  return {
    ...draft,
    mode: "edit",
    challengeId: challenge.id,
    poolOnly,
    step: poolOnly ? "preview" : "basics",
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
    gameList: challenge.pool?.game_list
      ? {
        id: challenge.pool.game_list.id,
        name: challenge.pool.game_list.name,
        gameCount: 0,
        canAdd: challenge.pool.game_list.can_add,
      }
      : null,
    handBefore: challenge.pool
      ? [...(challenge.pool.core_games ?? []).map((g) => g.game_id),
        ...(challenge.pool.optional_games ?? []).filter((g) => g.source === "hand")
          .map((g) => g.game_id)]
      : [],
    addToList: null,
  };
}

function isDraftGameList(value: unknown): value is IDraftGameList {
  const list = value as Partial<IDraftGameList> | null | undefined;
  return !!list && typeof list === "object" && Number.isInteger(list.id) &&
    (list.name === null || typeof list.name === "string") &&
    Number.isInteger(list.gameCount);
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
    isGameList(pool.core) &&
    isGameList(pool.optional) &&
    isGameList(pool.excluded) &&
    !!draft.assignment &&
    Array.isArray(draft.sourceResults) &&
    Array.isArray(draft.includeChoices);
  if (!valid) return null;
  // A draft saved before Slots joined has no slots: it gets the defaults.
  const slots = draft.slots as Partial<IChallengeDraft["slots"]> | undefined;
  const slotsValid = !!slots && isYear(slots.firstYear, "birth_year") &&
    isYear(slots.lastYear, "current_year") && typeof slots.countsPastPlay === "boolean";
  const target = Number(pool.optionalTarget);
  return {
    ...draft,
    pool: {
      ...draft.pool,
      optionalTarget: Number.isInteger(target) && target >= 0 ? target : 0,
    },
    includeAs: draft.includeAs === "optional" ? "optional" : "core",
    slots: slotsValid ? draft.slots : { ...YEARS_ALIVE },
    previewPage: Math.max(1, Number(draft.previewPage) || 1),
    gameList: isDraftGameList(draft.gameList) ? draft.gameList : null,
    handBefore: Array.isArray(draft.handBefore)
      ? draft.handBefore.filter((id) => Number.isInteger(id))
      : [],
    addToList: typeof draft.addToList === "boolean" ? draft.addToList : null,
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

/**
 * After the basics modal on a create started `from-list:` (bot#1569): reads the list once
 * and brings its games in as Core Games, ranked order first. A Format other than Pool
 * drops the list (only a Pool is fed by one), as does a list the member can't read.
 */
export async function applyGameList(
  draft: IChallengeDraft,
  actingUserId: string,
  api: Pick<IGameListApi, "get"> = GAME_LIST_API,
): Promise<{ draft: IChallengeDraft; errors: string[] }> {
  const pending = draft.gameList;
  if (draft.mode !== "create" || !pending || pending.name !== null) return { draft, errors: [] };
  if (draft.format !== "pool") {
    return {
      draft: { ...draft, gameList: null },
      errors: ["A Game List only starts a Pool Challenge, so this one starts without it."],
    };
  }
  const list = await api.get(pending.id, actingUserId);
  if (!list) {
    return {
      draft: { ...draft, gameList: null },
      errors: ["That Game List is gone, or you can't see it, so the Pool starts empty."],
    };
  }
  const games = [...(list.entries ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((entry) => ({ id: entry.game.game_id, title: entry.game.title }));
  let core = draft.pool.core;
  for (const game of games) core = withGame(core, game);
  const ids = new Set(games.map((game) => game.id));
  return {
    draft: {
      ...draft,
      pool: {
        ...draft.pool,
        core,
        optional: without(draft.pool.optional, ids),
        excluded: without(draft.pool.excluded, ids),
      },
      gameList: { id: list.id, name: list.name, gameCount: games.length },
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
  return pool.franchises.length + pool.collections.length + pool.core.length +
    pool.optional.length > 0;
}

/** A Pool's Season or end date from the settings modal; a Pool-only edit keeps its own. */
function readPoolSchedule(
  draft: IChallengeDraft,
  fields: WizardFields,
  errors: string[],
): Pick<IChallengeDraft, "season" | "endsOn"> {
  if (draft.poolOnly) return { season: draft.season, endsOn: draft.endsOn };
  if (draft.schedule === "seasonal") {
    const start = readMonthDay(fields, WIZARD_FIELDS.seasonStart, "Season starts", errors);
    const end = readMonthDay(fields, WIZARD_FIELDS.seasonEnd, "Season ends", errors);
    return { season: start && end ? { start, end } : null, endsOn: null };
  }
  const typed = field(fields, WIZARD_FIELDS.endsOn);
  const endsOn = typed ? parseChallengeDate(typed) : null;
  if (typed && !endsOn) errors.push(`End date: "${typed}" is not a date, such as 3 March 2027.`);
  return { season: null, endsOn };
}

/**
 * Applies the Format's settings modal. For a Pool, a search runs the franchise and Series
 * lookup and moves to the pick; with no search it moves to the preview, where games can
 * also be included by hand. Errors leave the draft as it was.
 */
export async function applySettings(
  draft: IChallengeDraft,
  fields: WizardFields,
  api: Pick<IChallengeWizardApi, "poolSources"> = CHALLENGE_API,
): Promise<{ draft: IChallengeDraft; errors: string[] }> {
  if (draft.format === "assignment") return applyAssignmentSettings(draft, fields);
  if (draft.format === "slots") return applySlotsSettings(draft, fields);

  const errors: string[] = [];
  const schedule = readPoolSchedule(draft, fields, errors);
  const query = field(fields, WIZARD_FIELDS.search);
  let sourceResults = draft.sourceResults;
  if (!errors.length && query) {
    sourceResults = await api.poolSources(query);
    if (!sourceResults.length) {
      errors.push(`Nothing in the GameDB matches "${query}". Try another search.`);
    }
  }
  if (errors.length) return { draft, errors };
  return {
    draft: {
      ...draft,
      ...schedule,
      step: query ? "sources" : "preview",
      sourceResults,
      previewPage: 1,
    },
    errors: [],
  };
}

/** Applies the Optional target modal: a whole number of 0 or more. */
export function applyOptionalTarget(
  draft: IChallengeDraft,
  fields: WizardFields,
): { draft: IChallengeDraft; errors: string[] } {
  const typed = field(fields, WIZARD_FIELDS.optionalTarget);
  const target = Number(typed || "0");
  if (!/^\d*$/.test(typed) || !Number.isInteger(target) || target > OPTIONAL_TARGET_MAX) {
    return {
      draft,
      errors: [`Optional target: "${typed}" is not a whole number of 0 or more.`],
    };
  }
  return { draft: { ...draft, pool: { ...draft.pool, optionalTarget: target } }, errors: [] };
}

function sourceValue(source: { kind: string; id: number }): string {
  return `${source.kind}:${source.id}`;
}

const SOURCE_KIND_LABELS: Readonly<Record<IPoolSource["kind"], string>> = {
  franchise: "Franchise",
  collection: "Series",
};

/** The options of the franchise and Series pick: the last results, then the chosen. */
function sourceOptions(
  draft: IChallengeDraft,
): { value: string; label: string; description: string }[] {
  const options = draft.sourceResults.map((source) => ({
    value: sourceValue(source),
    label: source.name,
    description: `${SOURCE_KIND_LABELS[source.kind]} · ` +
      `${source.game_count} ${source.game_count === 1 ? "game" : "games"}`,
  }));
  const chosen = [
    ...draft.pool.franchises.map((f) => ({
      value: `franchise:${f.id}`,
      label: f.name,
      description: SOURCE_KIND_LABELS.franchise,
    })),
    ...draft.pool.collections.map((c) => ({
      value: `collection:${c.id}`,
      label: c.name,
      description: SOURCE_KIND_LABELS.collection,
    })),
  ];
  for (const option of chosen) {
    if (!options.some((o) => o.value === option.value)) options.push(option);
  }
  return options.slice(0, DISCORD_SELECT_OPTIONS_MAX);
}

/**
 * Applies the franchise and Series pick: the ticked ones join the Pool and the ones
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
 * After the franchise and Series pick: each Franchise newly added brings its Mainline games
 * in as Core Games (spec api#442; the owner confirmed it), unless the Host left them out or
 * already made them Core. Add-ons are never Mainline (GET /franchises/:id). A Franchise that
 * can't be read adds its games as Optional only, as before.
 */
export async function applyFranchiseMainline(
  before: IChallengeDraft,
  after: IChallengeDraft,
  mainlineOf: (franchiseId: number) => Promise<IFranchiseGame[]> = franchiseMainlineGames,
): Promise<IChallengeDraft> {
  const had = new Set(before.pool.franchises.map((f) => f.id));
  const added = after.pool.franchises.filter((f) => !had.has(f.id));
  if (!added.length) return after;
  const excluded = new Set(after.pool.excluded.map((g) => g.id));
  let core = after.pool.core;
  const ids = new Set<number>();
  for (const franchise of added) {
    let games: IFranchiseGame[] = [];
    try {
      games = await mainlineOf(franchise.id);
    } catch (err: unknown) {
      logError("ChallengeWizard.applyFranchiseMainline", err);
    }
    for (const game of games) {
      if (excluded.has(game.game_id)) continue;
      core = withGame(core, { id: game.game_id, title: game.title });
      ids.add(game.game_id);
    }
  }
  return {
    ...after,
    pool: { ...after.pool, core, optional: without(after.pool.optional, ids) },
  };
}

function without(games: readonly IWizardGame[], ids: ReadonlySet<number>): IWizardGame[] {
  return games.filter((game) => !ids.has(game.id));
}

function withGame(games: readonly IWizardGame[], game: IWizardGame): IWizardGame[] {
  return games.some((g) => g.id === game.id) ? [...games] : [...games, game];
}

/**
 * Applies a page of the Core pick (design 1A): of the games `shown`, the ticked ones are
 * Core Games and the unticked ones Optional Games. A Core Game unticked is kept in the Pool
 * as an Optional Game picked by hand, since no source may hold it.
 */
export function applyCorePick(
  draft: IChallengeDraft,
  shown: readonly IWizardGame[],
  values: readonly string[],
): IChallengeDraft {
  const ticked = new Set(values.map(Number));
  let core = draft.pool.core.filter((game) =>
    ticked.has(game.id) || !shown.some((g) => g.id === game.id));
  let optional = without(draft.pool.optional, ticked);
  for (const game of shown) {
    const picked = { id: game.id, title: game.title };
    if (ticked.has(game.id)) core = withGame(core, picked);
    else if (draft.pool.core.some((g) => g.id === game.id)) optional = withGame(optional, picked);
  }
  return { ...draft, pool: { ...draft.pool, core, optional } };
}

/**
 * Applies a page of the exclude pick: of the games `shown`, the ticked ones are left out
 * (a Core Game or one picked by hand too) and the rest put back.
 */
export function applyExcludePick(
  draft: IChallengeDraft,
  shown: readonly IWizardGame[],
  values: readonly string[],
): IChallengeDraft {
  const ticked = new Set(values.map(Number));
  const shownIds = new Set(shown.map((game) => game.id));
  const excluded = draft.pool.excluded.filter((game) => !shownIds.has(game.id));
  for (const game of shown) {
    if (ticked.has(game.id)) excluded.push({ id: game.id, title: game.title });
  }
  return {
    ...draft,
    pool: {
      ...draft.pool,
      core: without(draft.pool.core, ticked),
      optional: without(draft.pool.optional, ticked),
      excluded,
    },
  };
}

/**
 * Runs the "Include a game" search; the preview then offers what it found, to add as a
 * Core or an Optional Game (`as`).
 */
export async function applyIncludeSearch(
  draft: IChallengeDraft,
  query: string,
  searchGames: (query: string) => Promise<IIncludeChoice[]>,
  as: IncludeAs = "core",
): Promise<IChallengeDraft> {
  const choices = query.trim() ? await searchGames(query.trim()) : [];
  return {
    ...draft,
    includeAs: as,
    includeChoices: choices.slice(0, DISCORD_SELECT_OPTIONS_MAX),
  };
}

/** Adds the picked game to the Pool by hand, as a Core or Optional Game, no longer left out. */
export function applyIncludePick(draft: IChallengeDraft, value: string): IChallengeDraft {
  const choice = draft.includeChoices.find((c) => String(c.id) === value);
  if (!choice) return { ...draft, includeChoices: [] };
  const game = { id: choice.id, title: choice.title };
  const ids = new Set([choice.id]);
  const core = draft.includeAs === "core"
    ? withGame(draft.pool.core, game)
    : without(draft.pool.core, ids);
  const optional = draft.includeAs === "optional"
    ? withGame(draft.pool.optional, game)
    : without(draft.pool.optional, ids);
  return {
    ...draft,
    includeChoices: [],
    pool: { ...draft.pool, core, optional, excluded: without(draft.pool.excluded, ids) },
  };
}

/**
 * The games an edit of a list-linked Pool puts in the Pool by hand (new Core Games or
 * Optional Games picked by hand), when the member may add them to the list: what
 * `add_to_list` would add (spec story 30). Empty otherwise.
 */
export function newListGames(draft: IChallengeDraft): IWizardGame[] {
  if (draft.mode !== "edit" || !draft.gameList?.canAdd) return [];
  const before = new Set(draft.handBefore ?? []);
  const seen = new Set<number>();
  return [...draft.pool.core, ...draft.pool.optional].filter((game) => {
    if (before.has(game.id) || seen.has(game.id)) return false;
    seen.add(game.id);
    return true;
  });
}

/** The Host's answer to "Also add to <list>?" on an edit of a list-linked Pool. */
export function applyAddToList(draft: IChallengeDraft, add: boolean): IChallengeDraft {
  return { ...draft, addToList: add };
}

function poolDefinition(draft: IChallengeDraft, withExcluded: boolean): IPoolDefinition {
  return {
    franchise_ids: draft.pool.franchises.map((f) => f.id),
    collection_ids: draft.pool.collections.map((c) => c.id),
    core_game_ids: draft.pool.core.map((g) => g.id),
    optional_game_ids: draft.pool.optional.map((g) => g.id),
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
  const pool: NonNullable<IChallengeWrite["pool"]> = {
    ...poolDefinition(draft, true),
    optional_target: draft.pool.optionalTarget,
  };
  // A Game List is linked only on create; the API copies its games in as Core Games too.
  if (draft.mode === "create" && draft.gameList?.name) pool.game_list_id = draft.gameList.id;
  const addToList = draft.addToList === true && newListGames(draft).length > 0;
  // With Runs, only the Pool may change: the rest is locked (spec api#442).
  if (draft.poolOnly) return addToList ? { pool, add_to_list: true } : { pool };
  const write: IChallengeWrite = {
    name: draft.name,
    description: draft.description,
    challenge_format: draft.format,
    schedule: draft.schedule,
    season: draft.schedule === "seasonal" ? draft.season : null,
    ends_on: draft.schedule === "always_open" ? draft.endsOn : null,
  };
  if (draft.format === "pool") {
    write.pool = pool;
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
  if (addToList && draft.format === "pool") write.add_to_list = true;
  return write;
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
    `**${escapeChallengeText(draft.name)}** · ${CHALLENGE_FORMAT_LABELS[draft.format]} · ` +
      schedule,
    `Next: the ${settingsLabel(draft)}.`,
  ];
  return wizardView(buildTextContainer(lines.join("\n")), [
    buttonRow(
      button(sessionId, "settings", settingsLabel(draft), ButtonStyle.Primary),
      button(sessionId, "basics", "Edit basics"),
      button(sessionId, "cancel", "Cancel"),
    ),
  ]);
}

/** The draft's sources in words, as the Pool's posts name them. */
function draftSources(draft: IChallengeDraft): string | null {
  return describePoolSources({
    optional_target: 0,
    core_count: 0,
    franchises: draft.pool.franchises.map((f) => ({ franchise_id: f.id, name: f.name })),
    collections: draft.pool.collections.map((c) => ({ collection_id: c.id, name: c.name })),
  });
}

function sourcesView(sessionId: string, draft: IChallengeDraft, notice: string[]): IChallengeView {
  const lines = [
    ...noticeLines(notice),
    `### ${stepTitle(draft)}${draft.poolOnly ? "" : " (2 of 2)"}: the Pool`,
    "Pick the franchises and Series whose games join the Pool. A franchise's Mainline " +
      "games come in as Core Games, the rest as Optional Games. In the preview you tick the " +
      "Core Games, leave games out and add others by hand.",
    `Chosen: ${draftSources(draft) ?? "nothing yet"}`,
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
        .setPlaceholder("Franchises and Series")
        .setMinValues(0)
        .setMaxValues(options.length)
        .addOptions(...options.map((option) => ({
          label: option.label.slice(0, DISCORD_SELECT_LABEL_MAX),
          description: option.description,
          value: option.value,
          default: chosen.has(option.value),
        }))),
    ));
  }
  rows.push(buttonRow(
    button(sessionId, "preview", "Preview", ButtonStyle.Primary),
    button(sessionId, "settings", "Search again"),
    button(sessionId, "cancel", "Cancel"),
  ));
  return wizardView(buildTextContainer(lines.join("\n")), rows);
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
  return wizardView(buildTextContainer(lines.join("\n")), [
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
  return wizardView(buildTextContainer(lines.join("\n")), [
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

/** "A, B and 3 more": titles named up to `max`, the rest counted. */
function namedTitles(games: readonly IWizardGame[], max: number): string {
  const named = games.slice(0, max).map((g) => escapeChallengeText(g.title));
  const more = games.length - named.length;
  return more > 0 ? `${named.join(", ")} and ${more} more` : listJoin(named);
}

/** "**Optional Games (12)** from the Final Fantasy franchise, plus X added by hand" */
function optionalLine(draft: IChallengeDraft, optionalCount: number): string {
  const head = `**Optional Games (${optionalCount})**`;
  const sources = draftSources(draft);
  const hand = draft.pool.optional;
  const handText = hand.length <= HAND_NAMED_MAX
    ? `${namedTitles(hand, HAND_NAMED_MAX)} added by hand`
    : `${hand.length} added by hand`;
  if (sources && hand.length) return `${head} from ${sources}, plus ${handText}`;
  if (sources) return `${head} from ${sources}`;
  if (hand.length) return `${head} ${handText}`;
  return `${head} none yet`;
}

/** Where the Pool's linked Game List stands (design 1A): made from it, or linked to it. */
function gameListLine(draft: IChallengeDraft): string | null {
  const list = draft.gameList;
  if (!list?.name) return null;
  const name = `**${escapeChallengeText(list.name)}**`;
  if (draft.mode === "create") {
    return `-# Made from your Game List ${name}. ` +
      (list.gameCount === 1
        ? "Its one game came in as a Core Game. "
        : `Its ${plural(list.gameCount, "game")} came in as Core Games. `) +
      "Games you add to the list later arrive as Optional Games.";
  }
  return `-# Linked to the Game List ${name}. Games added to it arrive as Optional Games.`;
}

function selectRow(select: StringSelectMenuBuilder): Row {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

function gameOption(game: IGameSummary, ticked: boolean) {
  const year = yearOf(game);
  return {
    label: game.title.slice(0, DISCORD_SELECT_LABEL_MAX),
    value: String(game.game_id),
    default: ticked,
    ...(year ? { description: year } : {}),
  };
}

/**
 * The Pool preview (design 1A "Two lines, one tick-box"): the target, the covers, a line
 * for the Core Games and one for where the Optional Games come from, then the Core pick
 * (ticked is Core, unticked stays Optional), the exclude pick, and the target button.
 */
async function poolPreview(
  sessionId: string,
  draft: IChallengeDraft,
  api: Pick<IChallengeWizardApi, "poolPreview">,
  notice: string[],
): Promise<IChallengeView> {
  const [candidates, inPool, resolved]: IPage<IGameSummary>[] = await Promise.all([
    api.poolPreview(poolDefinition(draft, false), draft.previewPage, PICK_PAGE_SIZE),
    api.poolPreview(poolDefinition(draft, true), draft.previewPage, PICK_PAGE_SIZE),
    api.poolPreview(poolDefinition(draft, true), 1, COVER_WALL_MAX),
  ]);
  const core = draft.pool.core;
  const coreIds = new Set(core.map((g) => g.id));
  const optionalCount = Math.max(0, resolved.count - core.length);
  const target = describePoolTarget({
    optional_target: draft.pool.optionalTarget,
    core_count: core.length,
  });
  const container = buildTextContainer([
    ...noticeLines(notice),
    `## Preview: ${escapeChallengeText(draft.name)}`,
    `-# Pool · ${target} · ${scheduleSummary(draft)}`,
  ].join("\n"));
  const wall = buildCoverWall(resolved.items);
  if (wall) container.addMediaGalleryComponents(wall);
  const details: string[] = [];
  if (!resolved.count && !hasPoolDefinition(draft.pool)) {
    details.push(draft.poolOnly
      ? "No games yet. Include a game, or add a franchise or Series with Sources."
      : "No games yet. Include a game, or go Back and search for a franchise or Series.");
  } else {
    details.push(
      `**Core Games (${core.length})** ` +
        (core.length ? namedTitles(core, CORE_NAMED_MAX) : "none yet"),
      optionalLine(draft, optionalCount),
    );
  }
  if (draft.pool.excluded.length) {
    details.push(`-# Left out: ${namedTitles(draft.pool.excluded, CORE_NAMED_MAX)}`);
  }
  const listLine = gameListLine(draft);
  if (listLine) details.push(listLine);
  const listAsk = listQuestion(draft);
  if (listAsk) details.push(listAsk.line);
  if (draft.pool.franchises.length + draft.pool.collections.length) {
    details.push("-# Add-ons never come in from a franchise or Series. " +
      "Add one by hand if you want it.");
  }
  if (draft.poolOnly) {
    details.push("-# Runs see the change at once. Adding Core Games or raising the target " +
      "DMs members with an Active Run.");
  }
  const pages = Math.max(candidates.pages, inPool.pages);
  if (pages > 1) details.push(`-# Games below: page ${draft.previewPage} of ${pages}`);
  container.addTextDisplayComponents(buildTextDisplay(details.join("\n")));

  const rows: Row[] = [];
  if (inPool.items.length) {
    rows.push(selectRow(new StringSelectMenuBuilder()
      .setCustomId(buildChallengeWizardId("core", sessionId))
      .setPlaceholder("Core Games: tick the games every Run must Clear")
      .setMinValues(0)
      .setMaxValues(inPool.items.length)
      .addOptions(...inPool.items.map((game) => gameOption(game, coreIds.has(game.game_id))))));
  }
  const excluded = new Set(draft.pool.excluded.map((g) => g.id));
  if (candidates.items.length) {
    rows.push(selectRow(new StringSelectMenuBuilder()
      .setCustomId(buildChallengeWizardId("exclude", sessionId))
      .setPlaceholder("Leave games out")
      .setMinValues(0)
      .setMaxValues(candidates.items.length)
      .addOptions(...candidates.items.map((game) =>
        gameOption(game, excluded.has(game.game_id))))));
  }
  if (draft.includeChoices.length) {
    rows.push(selectRow(new StringSelectMenuBuilder()
      .setCustomId(buildChallengeWizardId("include-pick", sessionId))
      .setPlaceholder(draft.includeAs === "core"
        ? "Pick the game to add as a Core Game"
        : "Pick the game to add as an Optional Game")
      .addOptions(...draft.includeChoices.map((choice) => ({
        label: (choice.year ? `${choice.title} (${choice.year})` : choice.title)
          .slice(0, DISCORD_SELECT_LABEL_MAX),
        value: String(choice.id),
      })))));
  }
  rows.push(buttonRow(
    saveButton(sessionId, draft),
    button(sessionId, "target", `Optional target: ${draft.pool.optionalTarget}`),
    button(sessionId, "include", "Include a game"),
    draft.poolOnly
      ? button(sessionId, "settings", "Sources")
      : button(sessionId, "basics", "Back"),
    button(sessionId, "cancel", "Cancel"),
  ));
  const extra: ButtonBuilder[] = [];
  if (pages > 1) {
    extra.push(
      button(sessionId, "page-prev", "Previous games", ButtonStyle.Secondary,
        draft.previewPage <= 1),
      button(sessionId, "page-next", "More games", ButtonStyle.Secondary,
        draft.previewPage >= pages),
    );
  }
  if (listAsk) extra.push(...listAsk.buttons(sessionId));
  if (extra.length) rows.push(buttonRow(...extra));
  return wizardView(container, rows);
}

/**
 * "Also add to <list>?" (spec story 30), once an edit of a list-linked Pool puts games in
 * it by hand and the member may add to the list. The answer covers every game the edit
 * adds by hand, as `add_to_list` does; until the Host answers, the list stays as it is.
 */
function listQuestion(draft: IChallengeDraft): {
  line: string;
  buttons: (sessionId: string) => ButtonBuilder[];
} | null {
  const games = newListGames(draft);
  const list = draft.gameList;
  if (!games.length || !list?.name) return null;
  const name = `**${escapeChallengeText(list.name)}**`;
  const titles = namedTitles(games, CORE_NAMED_MAX);
  const addLabel = `Add to ${list.name}`.slice(0, DISCORD_BUTTON_LABEL_MAX);
  if (draft.addToList === true) {
    return {
      line: `-# Saving also adds ${titles} to ${name}.`,
      buttons: (sessionId) => [button(sessionId, "list-skip", "Keep the list as it is")],
    };
  }
  if (draft.addToList === false) {
    return {
      line: `-# ${name} stays as it is.`,
      buttons: (sessionId) => [button(sessionId, "list-add", addLabel)],
    };
  }
  return {
    line: `**Also add ${titles} to ${name}?**\n` +
      "-# It feeds this Challenge. Members who can see the list will see them there.",
    buttons: (sessionId) => [
      button(sessionId, "list-add", addLabel, ButtonStyle.Primary),
      button(sessionId, "list-skip", "Keep the list as it is"),
    ],
  };
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
  return wizardView(buildTextContainer(content), []);
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

function sourceSearchInput(): LabelBuilder {
  return textInput(WIZARD_FIELDS.search, "Search franchises and Series", {
    required: false,
    description: "Their games join as Optional Games. Leave it empty to go to the preview.",
    maxLength: 100,
  });
}

/**
 * Modal 2: the Format's settings (a Pool's schedule and source search; a calendar). A
 * Pool-only edit (the Challenge has Runs) holds just the search.
 */
export function buildSettingsModal(sessionId: string, draft: IChallengeDraft): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(buildChallengeWizardId("settings-modal", sessionId))
    .setTitle(draft.poolOnly ? "Pool sources" : `${settingsLabel(draft)} (2 of 2)`);
  if (draft.poolOnly) return modal.addLabelComponents(sourceSearchInput());
  if (draft.format === "assignment") {
    const { signupCutoff, pickDeadline, reveal } = draft.assignment;
    return modal.addLabelComponents(
      textInput(WIZARD_FIELDS.signupCutoff, "Sign-up closes", {
        value: formatMonthDay(signupCutoff),
        description: "The draw happens that day.",
      }),
      textInput(WIZARD_FIELDS.pickDeadline, "Santas pick by", {
        value: formatMonthDay(pickDeadline),
      }),
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
  labels.push(sourceSearchInput());
  return modal.addLabelComponents(...labels);
}

/** The "Include a game" modal: a GameDB title search, and whether it joins as Core. */
export function buildIncludeModal(sessionId: string, draft: IChallengeDraft): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(buildChallengeWizardId("include-modal", sessionId))
    .setTitle("Include a game")
    .addLabelComponents(
      textInput(WIZARD_FIELDS.includeQuery, "Game title", {
        description: "You'll choose from the GameDB matches next.",
        maxLength: 100,
      }),
      radio(WIZARD_FIELDS.includeAs, "Add it as", [
        { label: "Core Game", value: "core", description: "Every Run must Clear it" },
        {
          label: "Optional Game",
          value: "optional",
          description: "It counts toward the Optional target",
        },
      ], draft.includeAs),
    );
}

/** Where the include modal put the game: Core unless Optional was chosen. */
export function includeAsOf(fields: WizardFields): IncludeAs {
  return field(fields, WIZARD_FIELDS.includeAs) === "optional" ? "optional" : "core";
}

/** The Optional target button's modal (design 1A): one number. */
export function buildOptionalTargetModal(
  sessionId: string,
  draft: IChallengeDraft,
): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(buildChallengeWizardId("target-modal", sessionId))
    .setTitle("Optional target")
    .addLabelComponents(textInput(WIZARD_FIELDS.optionalTarget, "Optional Games to Clear", {
      value: String(draft.pool.optionalTarget),
      description: "On top of every Core Game. 0 means the Core Games alone.",
      maxLength: 4,
    }));
}
