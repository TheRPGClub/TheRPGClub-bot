import {
  ActionRowBuilder,
  ButtonBuilder,
  ContainerBuilder,
  SectionBuilder,
  SeparatorBuilder,
  ThumbnailBuilder,
} from "@discordjs/builders";
import {
  ButtonStyle,
  SeparatorSpacingSize,
  type APIMessageTopLevelComponent,
} from "discord-api-types/v10";
import { escapeMarkdown } from "discord.js";
import { DateTime } from "luxon";
import { PLAYTIME_UNDO_PREFIX } from "../config/customIdPrefixes.js";
import { DISCORD_AUTOCOMPLETE_CHOICES_MAX, truncateLabel } from "../config/textLimits.js";
import { gamePageUrl } from "../config/website.js";
import { CLUB_TIME_ZONE } from "../functions/ClubDate.js";
import {
  buildComponentsV2View,
  buildTextContainer,
  buildTextDisplay,
  type IComponentsV2View,
} from "../functions/ComponentsV2Utils.js";
import { buildApiErrorMessage, buildApiRefusalMessage } from "../utilities/ApiErrorUtils.js";
import { logError } from "../utilities/LogUtils.js";
import { linkCommandMentions } from "./CommandMentionService.js";
import {
  PLAYTIME_API,
  type IGamePlaytime,
  type IPlaytimeApi,
  type ManualPlaytimeMode,
  type PlaytimeProvider,
  withinDeadline,
} from "./PlaytimeApi.js";

// Playtime in Discord (spec api#457, bot#1572): /playtime add with its 5B receipt and Undo,
// and the game view's My Playtime button with its 6B private breakdown. Playtime is ungated.
// Every reply is worked out from the API's Playtime document; the bot keeps no state, and
// Undo carries what it undoes in its custom ID, so it still works after a restart.

/** The most hours one /playtime add takes (well inside the API's integer minutes). */
export const PLAYTIME_MAX_HOURS = 100_000;

/** The platform option's value for Manual Playtime on no platform ("Other"). */
export const PLAYTIME_OTHER_PLATFORM = "other";

const PROVIDER_NAMES: Readonly<Record<PlaytimeProvider, string>> = {
  steam: "Steam",
  retroachievements: "RetroAchievements",
  psn: "PSN",
};

/** A GameDB platform as the bot's platform cache holds it. */
export interface IPlaytimePlatform {
  id: number;
  name: string;
  abbreviation: string | null;
  code?: string;
}

/** The game a reply is about. */
export interface IPlaytimeGame {
  id: number;
  title: string;
  coverUrl: string | null;
}

export interface IPlaytimeDeps {
  api?: IPlaytimeApi;
  /** The GameDB platforms, for short names ("Switch", "PS4"). */
  platforms?: () => Promise<IPlaytimePlatform[]>;
  /** The game by ID, or null when there is none. */
  game?: (gameId: number) => Promise<IPlaytimeGame | null>;
}

export type PlaytimeResult = { view: IComponentsV2View } | { error: string };

// ---------------------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------------------

/**
 * The minutes for the `hours` option, or the reason they can't be used. Playtime is a whole
 * number of minutes of 0 or more; adding needs more than 0, setting a total may be 0.
 */
export function playtimeMinutesFromHours(
  hours: number,
  mode: ManualPlaytimeMode,
): { minutes: number } | { error: string } {
  if (!Number.isFinite(hours) || hours < 0) {
    return { error: "Hours must be a number of 0 or more." };
  }
  if (hours > PLAYTIME_MAX_HOURS) {
    return { error: `Hours must be at most ${PLAYTIME_MAX_HOURS.toLocaleString("en-US")}.` };
  }
  const minutes = Math.round(hours * 60);
  if (mode === "add" && minutes <= 0) {
    return { error: "Add at least a minute of Playtime, or use set:true to set a total." };
  }
  return { minutes };
}

/** "183 h", "17 h 20 m", "45 m", "0 h". */
export function formatPlaytime(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return rest ? `${rest} m` : "0 h";
  const shown = `${hours.toLocaleString("en-US")} h`;
  return rest ? `${shown} ${rest} m` : shown;
}

/** A change in hours as the receipt marks it: "+3", "-1.5", "+0.25". */
export function formatHoursDelta(minutes: number): string {
  const hours = Math.round((minutes / 60) * 100) / 100;
  return `${hours < 0 ? "-" : "+"}${Math.abs(hours)}`;
}

/** "9 Nov", or "9 Nov 2025" outside the current year, in the club's time zone. */
export function formatPlaythroughStart(startedAt: string, now: Date = new Date()): string {
  const start = DateTime.fromISO(startedAt, { zone: CLUB_TIME_ZONE });
  if (!start.isValid) return "an unknown date";
  const today = DateTime.fromJSDate(now, { zone: CLUB_TIME_ZONE });
  return start.toFormat(start.year === today.year ? "d LLL" : "d LLL yyyy");
}

// ---------------------------------------------------------------------------------------
// The breakdown
// ---------------------------------------------------------------------------------------

/** A platform's short name: its abbreviation, else its name. */
function platformShortName(
  platformId: number | null | undefined,
  fallback: string | null | undefined,
  platforms: readonly IPlaytimePlatform[],
): string {
  if (platformId == null) return fallback?.trim() || "Other";
  const platform = platforms.find((p) => p.id === platformId);
  return platform?.abbreviation || platform?.name || fallback?.trim() || `Platform ${platformId}`;
}

/** One source of Playtime, as a line of the receipt or a row of the table. */
export interface IPlaytimeSource {
  /** "Steam", "Manual". */
  source: string;
  /** "PC", "Switch", "Other". */
  platform: string;
  minutes: number;
  /** False for a Provider figure the member's own entry keeps over. */
  counted: boolean;
  /** The Manual entry on this platform ID (undefined for Provider figures). */
  manualPlatformId?: number | null;
}

/** Every source in the document: Provider figures first, then Manual entries. */
export function playtimeSources(
  doc: IGamePlaytime,
  platforms: readonly IPlaytimePlatform[],
): IPlaytimeSource[] {
  const providers = doc.breakdown.provider_sets.map((set) => ({
    source: PROVIDER_NAMES[set.provider] ?? set.provider,
    platform: platformShortName(set.platform_id, set.platform_label ?? set.platform_name,
      platforms),
    minutes: set.minutes,
    counted: set.counted,
  }));
  const manual = doc.breakdown.manual_entries.map((entry) => ({
    source: "Manual",
    platform: platformShortName(entry.platform_id, entry.platform_name, platforms),
    minutes: entry.minutes,
    counted: true,
    manualPlatformId: entry.platform_id ?? null,
  }));
  return [...providers, ...manual];
}

/** "PSN and your manual PS4 entry may both count your PS4 time." per mismatch. */
export function mismatchSentences(
  doc: IGamePlaytime,
  platforms: readonly IPlaytimePlatform[],
): string[] {
  return doc.mismatches.map((mismatch) => {
    const platform = platformShortName(mismatch.platform_id, mismatch.platform_name, platforms);
    const provider = PROVIDER_NAMES[mismatch.provider] ?? mismatch.provider;
    return `${provider} and your manual ${platform} entry may both count your ${platform} time.`;
  });
}

function playthroughLine(doc: IGamePlaytime, now: Date): string | null {
  if (!doc.playthrough) return null;
  const since = formatPlaythroughStart(doc.playthrough.started_at, now);
  return `Playthrough open since ${since}: **${formatPlaytime(doc.playthrough.minutes)}**`;
}

function linkButton(label: string, url: string): ButtonBuilder {
  return new ButtonBuilder().setLabel(label).setURL(url).setStyle(ButtonStyle.Link);
}

function buttonRow(buttons: ButtonBuilder[]): APIMessageTopLevelComponent {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons).toJSON();
}

function hasSources(doc: IGamePlaytime): boolean {
  return doc.breakdown.provider_sets.length + doc.breakdown.manual_entries.length > 0;
}

// ---------------------------------------------------------------------------------------
// 5B: the /playtime add receipt
// ---------------------------------------------------------------------------------------

/** What a /playtime add (or its Undo) changed: one Manual entry. */
export interface IManualChange {
  platformId: number | null;
  /** Its minutes before; null when there was no entry. */
  before: number | null;
  /** Its minutes after; null when Undo deleted it. */
  after: number | null;
  mode: ManualPlaytimeMode;
  /** True for the receipt Undo leaves behind. */
  undone?: boolean;
}

/** The Undo button's target: put the member's entry back as it was. */
export interface IPlaytimeUndo {
  userId: string;
  gameId: number;
  platformId: number | null;
  /** Its minutes before the change; null when the change created it (Undo deletes it). */
  before: number | null;
}

/** `playtime-undo-v1:<user>:<game>:<platform ID or o>:<minutes or n>`. */
export function buildPlaytimeUndoId(undo: IPlaytimeUndo): string {
  const platform = undo.platformId == null ? "o" : String(undo.platformId);
  const before = undo.before == null ? "n" : String(undo.before);
  return `${PLAYTIME_UNDO_PREFIX}:${undo.userId}:${undo.gameId}:${platform}:${before}`;
}

export function parsePlaytimeUndoId(customId: string): IPlaytimeUndo | null {
  const match = new RegExp(`^${PLAYTIME_UNDO_PREFIX}:(\\d+):(\\d+):(o|\\d+):(n|\\d+)$`)
    .exec(customId);
  if (!match) return null;
  const gameId = Number(match[2]);
  if (!Number.isSafeInteger(gameId) || gameId <= 0) return null;
  return {
    userId: match[1],
    gameId,
    platformId: match[3] === "o" ? null : Number(match[3]),
    before: match[4] === "n" ? null : Number(match[4]),
  };
}

function changeSummary(change: IManualChange, platform: string): string {
  const where = `Manual · ${platform}`;
  if (change.undone) {
    return change.after == null
      ? `Undone: removed ${where}`
      : `Undone: ${where} is back to ${formatPlaytime(change.after)}`;
  }
  const after = formatPlaytime(change.after ?? 0);
  if (change.mode === "set") {
    const was = change.before == null ? "" : ` (was ${formatPlaytime(change.before)})`;
    return `Set ${where} to ${after}${was}`;
  }
  const added = formatPlaytime((change.after ?? 0) - (change.before ?? 0));
  return `Added ${added} to ${where} (${formatPlaytime(change.before ?? 0)} to ${after})`;
}

function sourceLine(source: IPlaytimeSource, delta: number | null): string {
  let line = `${source.source} · ${escapeMarkdown(source.platform)} ` +
    `**${formatPlaytime(source.minutes)}**`;
  if (delta) line += ` *(${formatHoursDelta(delta)})*`;
  if (!source.counted) line += " *(not counted: you kept your own entry)*";
  return line;
}

/**
 * The 5B receipt: the cover, the game and its new total, what changed, every source with
 * the changed Manual entry marked, the open Playthrough, any mismatch as one plain line,
 * then Undo (unless this is what Undo left) and Open on the website.
 */
export function buildPlaytimeReceipt(input: {
  doc: IGamePlaytime;
  game: IPlaytimeGame;
  change: IManualChange;
  platforms: readonly IPlaytimePlatform[];
  now?: Date;
}): IComponentsV2View {
  const { doc, game, change, platforms } = input;
  const now = input.now ?? new Date();
  const platform = platformShortName(change.platformId, null, platforms);
  const delta = change.undone ? null : (change.after ?? 0) - (change.before ?? 0);
  const lines = playtimeSources(doc, platforms).map((source) => sourceLine(
    source,
    source.manualPlatformId !== undefined && source.manualPlatformId === change.platformId
      ? delta
      : null,
  ));
  const head = [
    `### ${escapeMarkdown(game.title)} · ${formatPlaytime(doc.total_minutes)}`,
    `-# ${changeSummary(change, escapeMarkdown(platform))}`,
    ...(lines.length ? lines : ["No Playtime on this game now."]),
  ].join("\n");

  const container = new ContainerBuilder();
  if (game.coverUrl && /^https?:\/\//i.test(game.coverUrl)) {
    const section = new SectionBuilder().addTextDisplayComponents(buildTextDisplay(head));
    section.setThumbnailAccessory(new ThumbnailBuilder().setURL(game.coverUrl));
    container.addSectionComponents(section);
  } else {
    container.addTextDisplayComponents(buildTextDisplay(head));
  }

  const tail: string[] = [];
  const playthrough = playthroughLine(doc, now);
  if (playthrough) tail.push(playthrough);
  const mismatches = mismatchSentences(doc, platforms);
  if (mismatches.length) tail.push(`-# ${mismatches.join(" ")} Sort it out on the website.`);
  if (tail.length) {
    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
    );
    container.addTextDisplayComponents(buildTextDisplay(tail.join("\n")));
  }

  const buttons: ButtonBuilder[] = [];
  if (!change.undone) {
    buttons.push(new ButtonBuilder()
      .setLabel("Undo")
      .setStyle(ButtonStyle.Secondary)
      .setCustomId(buildPlaytimeUndoId({
        userId: doc.user_id,
        gameId: game.id,
        platformId: change.platformId,
        before: change.before,
      })));
  }
  buttons.push(linkButton("Open on the website", gamePageUrl(game.id)));
  return buildComponentsV2View([container.toJSON(), buttonRow(buttons)], true);
}

// ---------------------------------------------------------------------------------------
// 6B: My Playtime
// ---------------------------------------------------------------------------------------

const TABLE_LABEL_WIDTH = 24;
const TABLE_VALUE_WIDTH = 10;

/** The sources and the total as a code block table, so the hours line up. */
export function playtimeTable(
  doc: IGamePlaytime,
  platforms: readonly IPlaytimePlatform[],
): string {
  const row = (label: string, value: string): string => {
    const clean = label.replace(/`/g, "'");
    const cut = clean.length > TABLE_LABEL_WIDTH ? clean.slice(0, TABLE_LABEL_WIDTH) : clean;
    return `${cut.padEnd(TABLE_LABEL_WIDTH)}${value.padStart(TABLE_VALUE_WIDTH)}`;
  };
  const rows = playtimeSources(doc, platforms).map((source) => {
    const value = formatPlaytime(source.minutes);
    return row(`${source.source} · ${source.platform}`, source.counted ? value : `(${value})`);
  });
  const rule = "-".repeat(TABLE_LABEL_WIDTH + TABLE_VALUE_WIDTH);
  return ["```", ...rows, rule, row("Playtime", formatPlaytime(doc.total_minutes)), "```"]
    .join("\n");
}

/**
 * The 6B private reply for whoever pressed My Playtime: the table of sources and the total,
 * the open Playthrough and a hint. With no Playtime, a pointer to linking accounts or
 * /playtime add.
 */
export function buildMyPlaytimeReply(input: {
  doc: IGamePlaytime;
  game: IPlaytimeGame;
  platforms: readonly IPlaytimePlatform[];
  now?: Date;
}): IComponentsV2View {
  const { doc, game, platforms } = input;
  const title = escapeMarkdown(game.title);
  const playthrough = playthroughLine(doc, input.now ?? new Date());
  if (!hasSources(doc)) {
    const lines = [
      `You have no Playtime on **${title}** yet.`,
      ...(playthrough ? [playthrough] : []),
      linkCommandMentions(
        "-# Link Steam, RetroAchievements or PSN on the website, or add it with /playtime add.",
      ),
    ];
    return buildComponentsV2View([buildTextContainer(lines.join("\n")).toJSON()], true);
  }
  const hint = ["Add time with /playtime add.", ...mismatchSentences(doc, platforms)];
  const lines = [
    `### Your Playtime · ${title}`,
    playtimeTable(doc, platforms),
    ...(playthrough ? [playthrough] : []),
    ...(playtimeSources(doc, platforms).some((s) => !s.counted)
      ? ["-# Hours in brackets don't count: you kept your own entry on that platform."]
      : []),
    linkCommandMentions(`-# ${hint.join(" ")}`),
  ];
  return buildComponentsV2View([
    buildTextContainer(lines.join("\n")).toJSON(),
    buttonRow([linkButton("Open on the website", gamePageUrl(game.id))]),
  ], true);
}

// ---------------------------------------------------------------------------------------
// Platform autocomplete
// ---------------------------------------------------------------------------------------

export interface IPlaytimeChoice {
  name: string;
  value: string;
}

function platformMatches(platform: IPlaytimePlatform, query: string): boolean {
  if (!query) return true;
  return [platform.name, platform.abbreviation ?? "", platform.code ?? ""]
    .some((text) => text.toLowerCase().includes(query));
}

function platformLabel(platform: IPlaytimePlatform): string {
  return platform.abbreviation ? `${platform.name} (${platform.abbreviation})` : platform.name;
}

/**
 * The platform option's choices: the platforms the member already has Playtime on for the
 * chosen game first, each with what it holds ("your Manual Playtime: 30 h", "Steam reports
 * 42 h"), then every other GameDB platform A to Z, then Other.
 */
export function playtimePlatformChoices(input: {
  query: string;
  platforms: readonly IPlaytimePlatform[];
  doc: IGamePlaytime | null;
}): IPlaytimeChoice[] {
  const query = input.query.trim().toLowerCase();
  const hints = new Map<number | null, string>();
  for (const entry of input.doc?.breakdown.manual_entries ?? []) {
    hints.set(entry.platform_id ?? null, `your Manual Playtime: ${formatPlaytime(entry.minutes)}`);
  }
  for (const set of input.doc?.breakdown.provider_sets ?? []) {
    if (set.platform_id == null || hints.has(set.platform_id)) continue;
    const provider = PROVIDER_NAMES[set.provider] ?? set.provider;
    hints.set(set.platform_id, `${provider} reports ${formatPlaytime(set.minutes)}`);
  }

  const withHint = (label: string, id: number | null): string => {
    const hint = hints.get(id);
    return truncateLabel(hint ? `${label} · ${hint}` : label);
  };
  const matching = input.platforms.filter((platform) => platformMatches(platform, query));
  const sorted = [...matching].sort((a, b) => {
    const aOwn = hints.has(a.id);
    if (aOwn !== hints.has(b.id)) return aOwn ? -1 : 1;
    return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  });
  const choices = sorted.map((platform) => ({
    name: withHint(platformLabel(platform), platform.id),
    value: String(platform.id),
  }));
  const other = { name: withHint("Other", null), value: PLAYTIME_OTHER_PLATFORM };
  if (hints.has(null)) {
    const ownCount = sorted.filter((p) => hints.has(p.id)).length;
    choices.splice(ownCount, 0, other);
  } else if (!query || "other".includes(query)) {
    choices.push(other);
  }
  return choices.slice(0, DISCORD_AUTOCOMPLETE_CHOICES_MAX);
}

// ---------------------------------------------------------------------------------------
// The flows
// ---------------------------------------------------------------------------------------

async function defaultPlatforms(): Promise<IPlaytimePlatform[]> {
  const { default: GamePlatformRegionService } =
    await import("../classes/GamePlatformRegionService.js");
  return GamePlatformRegionService.getCachedPlatforms();
}

async function defaultGame(gameId: number): Promise<IPlaytimeGame | null> {
  const { default: Game } = await import("../classes/Game.js");
  const game = await Game.getGameById(gameId);
  return game ? { id: game.id, title: game.title, coverUrl: game.coverUrl ?? null } : null;
}

async function readPlatforms(deps: IPlaytimeDeps): Promise<IPlaytimePlatform[]> {
  try {
    return await (deps.platforms ?? defaultPlatforms)();
  } catch (err: unknown) {
    // Short names are a nicety: without them the API's platform names stand.
    logError("Playtime.readPlatforms", err);
    return [];
  }
}

function manualMinutesOn(doc: IGamePlaytime, platformId: number | null): number | null {
  const entry = doc.breakdown.manual_entries
    .find((e) => (e.platform_id ?? null) === platformId);
  return entry ? entry.minutes : null;
}

function notice(text: string): PlaytimeResult {
  return { view: buildComponentsV2View([buildTextContainer(text).toJSON()], true) };
}

/**
 * /playtime add: adds `hours` to the member's Manual Playtime on the platform, or with
 * `set` replaces its total, then answers with the receipt.
 */
export async function addPlaytimeReply(
  input: {
    userId: string;
    gameId: number | null;
    platformId: number | null | undefined;
    hours: number;
    set: boolean;
  },
  deps: IPlaytimeDeps = {},
): Promise<PlaytimeResult> {
  if (input.gameId === null) return notice("Pick the game from the list.");
  if (input.platformId === undefined) return notice("Pick a platform from the list.");
  const mode: ManualPlaytimeMode = input.set ? "set" : "add";
  const parsed = playtimeMinutesFromHours(input.hours, mode);
  if ("error" in parsed) return notice(parsed.error);

  const api = deps.api ?? PLAYTIME_API;
  const game = await (deps.game ?? defaultGame)(input.gameId);
  if (!game) return notice(`No game found with ID ${input.gameId}.`);

  let before: number | null;
  let doc: IGamePlaytime;
  try {
    before = manualMinutesOn(await api.get(input.userId, game.id), input.platformId);
    doc = await api.writeManual(input.userId, game.id, {
      platformId: input.platformId,
      minutes: parsed.minutes,
      mode,
    });
  } catch (err: unknown) {
    return { error: buildApiRefusalMessage(err, "Could not save your Playtime.") };
  }
  return {
    view: buildPlaytimeReceipt({
      doc,
      game,
      platforms: await readPlatforms(deps),
      change: {
        platformId: input.platformId,
        before,
        after: manualMinutesOn(doc, input.platformId),
        mode,
      },
    }),
  };
}

/**
 * The receipt's Undo: sets the entry back to its earlier total, or deletes it when the
 * change created it. Answers with the receipt as it now stands, without Undo.
 */
export async function undoPlaytimeReply(
  undo: IPlaytimeUndo,
  deps: IPlaytimeDeps = {},
): Promise<PlaytimeResult> {
  const api = deps.api ?? PLAYTIME_API;
  const game = await (deps.game ?? defaultGame)(undo.gameId);
  if (!game) return notice(`No game found with ID ${undo.gameId}.`);

  let doc: IGamePlaytime;
  try {
    if (undo.before == null) {
      const current = await api.get(undo.userId, game.id);
      const entry = current.breakdown.manual_entries
        .find((e) => (e.platform_id ?? null) === undo.platformId);
      // Already gone (another delete got there first): read it afresh rather than show
      // the entry from before the delete.
      doc = entry
        ? (await api.deleteManual(entry.id)) ?? await api.get(undo.userId, game.id)
        : current;
    } else {
      doc = await api.writeManual(undo.userId, game.id, {
        platformId: undo.platformId,
        minutes: undo.before,
        mode: "set",
      });
    }
  } catch (err: unknown) {
    return { error: buildApiRefusalMessage(err, "Could not undo that change.") };
  }
  return {
    view: buildPlaytimeReceipt({
      doc,
      game,
      platforms: await readPlatforms(deps),
      change: {
        platformId: undo.platformId,
        before: null,
        after: undo.before,
        mode: "set",
        undone: true,
      },
    }),
  };
}

/** The game view's My Playtime: the presser's own breakdown, privately. */
export async function myPlaytimeReply(
  input: { userId: string; game: IPlaytimeGame },
  deps: IPlaytimeDeps = {},
): Promise<PlaytimeResult> {
  const api = deps.api ?? PLAYTIME_API;
  let doc: IGamePlaytime;
  try {
    doc = await api.get(input.userId, input.game.id);
  } catch (err: unknown) {
    return { error: buildApiErrorMessage("Could not read your Playtime.", err) };
  }
  return {
    view: buildMyPlaytimeReply({ doc, game: input.game, platforms: await readPlatforms(deps) }),
  };
}

/**
 * The platform option's choices for the game picked in `title` (a GameDB ID). The
 * member's Playtime is read only to put their platforms first; when it can't be read in
 * time the plain list stands.
 */
export async function playtimePlatformChoicesFor(
  input: { query: string; userId: string; gameId: number | null },
  deps: IPlaytimeDeps & { waitMs?: number } = {},
): Promise<IPlaytimeChoice[]> {
  const api = deps.api ?? PLAYTIME_API;
  const platforms = await readPlatforms(deps);
  let doc: IGamePlaytime | null = null;
  if (input.gameId !== null) {
    doc = await withinDeadline(api.get(input.userId, input.gameId), deps.waitMs ?? 1500)
      .catch((err: unknown) => {
        logError("Playtime.playtimePlatformChoicesFor", err);
        return null;
      });
  }
  return playtimePlatformChoices({ query: input.query, platforms, doc });
}
