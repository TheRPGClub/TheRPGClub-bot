import Game from "../../classes/Game.js";
import GamePlatformRegionService from "../../classes/GamePlatformRegionService.js";
import { getHltbCacheByGameId, type HltbCacheEntry } from "../../classes/HltbCache.js";
import Member from "../../classes/Member.js";
import UserGameBacklog from "../../classes/UserGameBacklog.js";
import UserGameCollection from "../../classes/UserGameCollection.js";
import {
  BACKLOG_PICK_DISMISS_PREFIX,
  BACKLOG_PICK_REROLL_PREFIX,
  BACKLOG_PICK_START_PREFIX,
} from "../../config/customIdPrefixes.js";
import { safeV2TextContent } from "../../functions/ComponentsV2Utils.js";
import { logError } from "../../utilities/LogUtils.js";

export type BacklogPickSource = "backlog" | "collection" | "both";
export type BacklogPickEntryKind = "b" | "c";

const SOURCE_CODES: Record<BacklogPickSource, string> = {
  backlog: "b",
  collection: "c",
  both: "a",
};

/** HLTB lookups run in batches while walking the shuffled order, so a pick stays quick. */
const HLTB_LOOKUP_BATCH = 5;
const SEED_MAX = 0xffffffff;

export interface IBacklogPickFilters {
  ownerId: string;
  source: BacklogPickSource;
  /** 0 means no platform filter. */
  platformId: number;
  /** 0 means no playtime limit. */
  maxHours: number;
}

export interface IBacklogPickState extends IBacklogPickFilters {
  seed: number;
  /** Position in the shuffled candidate order to start looking from. */
  position: number;
}

export interface IBacklogPickCandidate {
  kind: BacklogPickEntryKind;
  entryId: number;
  gameId: number;
  title: string;
  platformId: number | null;
  platformName: string | null;
}

export interface IBacklogPickResult {
  candidate: IBacklogPickCandidate;
  /** Position of the pick in the shuffled order; the next reroll starts one past it. */
  position: number;
  hltb: HltbCacheEntry | null;
  coverUrl: string | null;
  /** True when this pick came from going back to the start of the shuffled order. */
  wrapped: boolean;
}

export function newBacklogPickSeed(): number {
  return Math.floor(Math.random() * SEED_MAX);
}

function sourceFromCode(code: string): BacklogPickSource | null {
  const match = (Object.keys(SOURCE_CODES) as BacklogPickSource[])
    .find((source) => SOURCE_CODES[source] === code);
  return match ?? null;
}

export function buildBacklogPickRerollId(state: IBacklogPickState): string {
  return [
    BACKLOG_PICK_REROLL_PREFIX,
    state.ownerId,
    SOURCE_CODES[state.source],
    state.platformId,
    state.maxHours,
    state.seed.toString(36),
    state.position,
  ].join(":");
}

export function parseBacklogPickRerollId(customId: string): IBacklogPickState | null {
  const match = /^backlog-pick-reroll-v1:(\d+):([bca]):(\d+):(\d+):([0-9a-z]+):(\d+)$/
    .exec(customId);
  if (!match) return null;
  const source = sourceFromCode(match[2]);
  const seed = parseInt(match[5], 36);
  if (!source || !Number.isSafeInteger(seed)) return null;
  return {
    ownerId: match[1],
    source,
    platformId: Number(match[3]),
    maxHours: Number(match[4]),
    seed,
    position: Number(match[6]),
  };
}

export function buildBacklogPickStartId(
  ownerId: string,
  kind: BacklogPickEntryKind,
  entryId: number,
): string {
  return `${BACKLOG_PICK_START_PREFIX}:${ownerId}:${kind}:${entryId}`;
}

export function parseBacklogPickStartId(
  customId: string,
): { ownerId: string; kind: BacklogPickEntryKind; entryId: number } | null {
  const match = /^backlog-pick-start-v1:(\d+):([bc]):(\d+)$/.exec(customId);
  if (!match) return null;
  const entryId = Number(match[3]);
  if (!Number.isSafeInteger(entryId) || entryId <= 0) return null;
  return { ownerId: match[1], kind: match[2] as BacklogPickEntryKind, entryId };
}

export function buildBacklogPickDismissId(ownerId: string): string {
  return `${BACKLOG_PICK_DISMISS_PREFIX}:${ownerId}`;
}

/**
 * Reads an HLTB time such as "12 Hours", "12½ Hours", or "45 Mins" as hours. Returns null
 * for blanks and placeholders like "--".
 */
export function parseHltbHours(value: string | null | undefined): number | null {
  if (!value) return null;
  const text = value.replace(/½/g, ".5").toLowerCase();
  const match = /(\d+(?:\.\d+)?)/.exec(text);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return /min/.test(text) ? amount / 60 : amount;
}

/** Main story time, falling back to the other single-run times when HLTB has no main. */
export function getHltbPickHours(hltb: HltbCacheEntry | null): number | null {
  if (!hltb) return null;
  return parseHltbHours(hltb.main)
    ?? parseHltbHours(hltb.singlePlayer)
    ?? parseHltbHours(hltb.mainSides);
}

/** mulberry32: small, fast, and the same sequence for the same seed on every run. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Orders candidates by a stable key, then shuffles them with the seed. The same seed and
 * the same entries give the same order after a restart, so the custom id only needs the
 * seed and a position.
 */
export function shuffleBacklogPickCandidates(
  candidates: IBacklogPickCandidate[],
  seed: number,
): IBacklogPickCandidate[] {
  const ordered = [...candidates].sort((a, b) =>
    a.kind === b.kind ? a.entryId - b.entryId : a.kind.localeCompare(b.kind));
  const random = seededRandom(seed);
  for (let i = ordered.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
  }
  return ordered;
}

/**
 * Walks the order from `start`, wrapping once, and returns the first candidate `accepts`
 * approves along with its position.
 */
export async function findBacklogPick<T>(
  order: IBacklogPickCandidate[],
  start: number,
  accepts: (candidate: IBacklogPickCandidate) => Promise<T | null>,
): Promise<{ candidate: IBacklogPickCandidate; position: number; value: T } | null> {
  const total = order.length;
  for (let offset = 0; offset < total; offset += HLTB_LOOKUP_BATCH) {
    const positions: number[] = [];
    for (let i = offset; i < Math.min(offset + HLTB_LOOKUP_BATCH, total); i++) {
      positions.push(start + i);
    }
    const values = await Promise.all(positions.map((pos) => accepts(order[pos % total])));
    const hit = values.findIndex((value) => value !== null);
    if (hit !== -1) {
      const position = positions[hit];
      return { candidate: order[position % total], position, value: values[hit] as T };
    }
  }
  return null;
}

async function loadBacklogPickCandidates(
  filters: IBacklogPickFilters,
): Promise<IBacklogPickCandidate[]> {
  const [backlog, collection, nowPlaying] = await Promise.all([
    filters.source === "collection" ? [] : UserGameBacklog.listForUser(filters.ownerId),
    filters.source === "backlog"
      ? []
      : UserGameCollection.searchEntries({ targetUserId: filters.ownerId }),
    Member.getNowPlaying(filters.ownerId),
  ]);

  // A game already on Now Playing is not a suggestion for what to play next.
  const seenGameIds = new Set(nowPlaying.map((entry) => entry.gameId));
  const candidates: IBacklogPickCandidate[] = [];
  const add = (kind: BacklogPickEntryKind, entry: Omit<IBacklogPickCandidate, "kind">) => {
    if (filters.platformId && entry.platformId !== filters.platformId) return;
    // Backlog entries go first, so a game in both lists counts once, as its backlog entry.
    if (seenGameIds.has(entry.gameId)) return;
    seenGameIds.add(entry.gameId);
    candidates.push({
      kind,
      entryId: entry.entryId,
      gameId: entry.gameId,
      title: entry.title,
      platformId: entry.platformId,
      platformName: entry.platformName,
    });
  };
  backlog.forEach((entry) => add("b", entry));
  collection.forEach((entry) => add("c", entry));
  return candidates;
}

async function lookupHltb(gameId: number): Promise<HltbCacheEntry | null> {
  try {
    return await getHltbCacheByGameId(gameId);
  } catch (err) {
    logError("backlog pick.hltb_lookup_failed", err);
    return null;
  }
}

async function lookupCover(gameId: number, hltb: HltbCacheEntry | null): Promise<string | null> {
  try {
    return (await Game.getGamePrimaryImageUrl(gameId)) ?? hltb?.imageUrl ?? null;
  } catch (err) {
    logError("backlog pick.cover_lookup_failed", err);
    return hltb?.imageUrl ?? null;
  }
}

export async function pickFromBacklog(
  state: IBacklogPickState,
): Promise<IBacklogPickResult | null> {
  const candidates = await loadBacklogPickCandidates(state);
  if (!candidates.length) return null;
  const order = shuffleBacklogPickCandidates(candidates, state.seed);

  // Without a playtime limit every candidate qualifies; HLTB is still fetched for display.
  const found = await findBacklogPick(order, state.position, async (candidate) => {
    if (!state.maxHours) return { hltb: null as HltbCacheEntry | null };
    const hltb = await lookupHltb(candidate.gameId);
    const hours = getHltbPickHours(hltb);
    return hours !== null && hours <= state.maxHours ? { hltb } : null;
  });
  if (!found) return null;

  const hltb = state.maxHours ? found.value.hltb : await lookupHltb(found.candidate.gameId);
  const coverUrl = await lookupCover(found.candidate.gameId, hltb);
  return {
    candidate: found.candidate,
    position: found.position % order.length,
    hltb,
    coverUrl,
    // A walk that runs past the end of the order has come back to the start. A list that
    // shrank since the last roll lands here too, which is why the notice only says repeats
    // are possible.
    wrapped: found.position >= order.length,
  };
}

export async function describeBacklogPickFilters(filters: IBacklogPickFilters): Promise<string> {
  const parts: string[] = [`source: ${filters.source}`];
  if (filters.platformId) {
    const platform = await GamePlatformRegionService.getPlatformById(filters.platformId)
      .catch(() => null);
    parts.push(`platform: ${platform?.name ?? `#${filters.platformId}`}`);
  }
  if (filters.maxHours) parts.push(`up to ${filters.maxHours} hours (HLTB main story)`);
  return parts.join(", ");
}

export function buildBacklogPickContent(
  result: IBacklogPickResult,
  filterSummary: string,
): string {
  const { candidate, hltb } = result;
  const title = safeV2TextContent(candidate.title, 100);
  const platform = candidate.platformName
    ? ` (${safeV2TextContent(candidate.platformName, 60)})`
    : "";
  const from = candidate.kind === "b" ? "your backlog" : "your collection";
  const lines = [
    "## Try this next",
    `**${title}**${platform}`,
    `From ${from}`,
    "",
  ];

  const times = [
    hltb?.main ? `Main: ${hltb.main}` : null,
    hltb?.mainSides ? `Main + Sides: ${hltb.mainSides}` : null,
    hltb?.completionist ? `Completionist: ${hltb.completionist}` : null,
  ].filter((line): line is string => line !== null);
  lines.push(times.length
    ? `**HowLongToBeat**\n${times.map((t) => safeV2TextContent(t, 80)).join("\n")}`
    : "No HowLongToBeat times on file.");

  lines.push("", `-# Filters: ${filterSummary}`);
  if (result.wrapped) {
    lines.push("-# Back to the start of your list, so picks may repeat.");
  }
  return lines.join("\n");
}

export function buildBacklogPickEmptyMessage(filters: IBacklogPickFilters): string {
  if (filters.maxHours) {
    return "Nothing matched those filters. Games with no HowLongToBeat times are skipped when "
      + "`max_hours` is set.";
  }
  return "Nothing matched those filters. Add games with `/backlog add` or `/collection add`.";
}
