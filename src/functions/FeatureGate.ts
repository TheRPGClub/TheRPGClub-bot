/**
 * The bot's feature gate (spec api#347, bot#1520). The API decides who can use what
 * (ADR 0005); this module maps an interaction to a Feature key and turns the Feature's
 * club-wide state (and, in Preview only, whether the user is staff) into what the bot does
 * with the interaction, and routes a Feature's automated posts.
 */

import { TextDisplayBuilder } from "discord.js";

import { FEATURE_ACCESS_WAIT_MS } from "../config/cacheDefaults.js";
import { ANNOUNCEMENT_CHANNEL_ID, BOT_DEV_CHANNEL_ID } from "../config/channels.js";
import { FEATURE_COMMANDS, FEATURE_COMPONENT_PREFIXES } from "../config/featureGate.js";
import {
  DISCORD_MESSAGE_CONTENT_MAX,
  DISCORD_V2_COMPONENTS_MAX,
  DISCORD_V2_TEXT_MAX,
} from "../config/textLimits.js";
import { logError, logWarn } from "../utilities/LogUtils.js";
import { hasComponentsV2Flag, safeV2TextContent } from "./ComponentsV2Utils.js";

/** The private reply to someone who can't use the Feature (Preview for non-staff, or Off). */
export const FEATURE_NOT_AVAILABLE_MESSAGE = "This feature isn't available yet.";

/** Added to every reply of a Feature a staff member can use only because it is in Preview. */
export const FEATURE_PREVIEW_NOTE = "-# Preview - staff only";

export type FeatureState = "off" | "preview" | "live";

export interface IFeatureAccessEntry {
  key: string;
  name: string;
  state: FeatureState;
  /** Live: everyone. Preview: staff only. Off: nobody. */
  canUse: boolean;
  /** True when the user can use the Feature only because they are staff (Preview). */
  preview: boolean;
}

/** The API's Feature access lookup for one Discord user (GET /users/:id/feature_access). */
export interface IFeatureAccess {
  userId: string;
  staff: boolean;
  features: IFeatureAccessEntry[];
}

/** One Feature's flag. Its state is club-wide: the same whoever asks. */
export interface IFeatureFlag {
  key: string;
  name: string;
  state: FeatureState;
}

/**
 * - `run`: handle the interaction as usual.
 * - `preview_note`: handle it, and mark every reply with the Preview note.
 * - `not_available`: refuse privately with FEATURE_NOT_AVAILABLE_MESSAGE.
 */
export type FeatureGateDecision = "run" | "preview_note" | "not_available";

/** What the gate looks at: a slash command or context menu name, or a custom ID. */
export type FeatureGateTarget =
  | { type: "command"; name: string }
  | { type: "component"; customId: string };

/** The Feature an interaction belongs to, or null when it is not mapped (never gated). */
export function featureKeyFor(target: FeatureGateTarget): string | null {
  if (target.type === "command") {
    return Object.hasOwn(FEATURE_COMMANDS, target.name) ? FEATURE_COMMANDS[target.name] : null;
  }
  let match: readonly [string, string] | null = null;
  for (const entry of FEATURE_COMPONENT_PREFIXES) {
    if (!target.customId.startsWith(entry[0])) continue;
    if (!match || entry[0].length > match[0].length) match = entry;
  }
  return match ? match[1] : null;
}

/**
 * Decides what happens to an interaction of a Feature in `state` (null when it is not
 * mapped, not listed, or the flags could not be read). Live runs for everyone and Off for
 * nobody; Preview runs with the note for staff and is refused to everyone else. `staff`
 * is only needed in Preview; null there (the staff lookup failed) runs it: the gate never
 * turns an API outage into a refusal.
 */
export function decideFeatureGate(
  state: FeatureState | null,
  staff: boolean | null,
): FeatureGateDecision {
  if (state === "off") return "not_available";
  if (state !== "preview" || staff === null) return "run";
  return staff ? "preview_note" : "not_available";
}

/** Where Feature Flag states are read (the bot's club-wide cache). */
export interface IFeatureFlagSource {
  /** Every Feature with its club-wide state. */
  flags(): Promise<readonly IFeatureFlag[]>;
}

/** What the gate reads: the club-wide flags, and who is staff (only asked in Preview). */
export interface IFeatureGateSource extends IFeatureFlagSource {
  /** Whether a Discord user is an Admin or Superadmin, by their stored roles. */
  isStaff(userId: string): Promise<boolean>;
}

/** The state of `featureKey` among `flags`, or null when it is not listed. */
export function featureStateFor(
  featureKey: string,
  flags: readonly IFeatureFlag[] | null,
): FeatureState | null {
  return flags?.find((flag) => flag.key === featureKey)?.state ?? null;
}

/**
 * Resolves `promise`, or null when it rejects (logged) or takes longer than `waitMs`
 * (logged; a late answer still lands wherever the promise puts it).
 */
export async function settleWithin<T>(
  what: string,
  promise: Promise<T>,
  waitMs: number,
): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      logWarn("FeatureGate", `${what} took over ${waitMs}ms; going on without it`);
      resolve(null);
    }, waitMs);
  });
  const settled = promise.catch((err: unknown) => {
    logError(`FeatureGate: ${what} failed; going on without it`, err);
    return null;
  });
  try {
    return await Promise.race([settled, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The gate for one interaction: maps it to a Feature, reads that Feature's club-wide state
 * (cached, so a Live or Off Feature costs no API call once warm) and only in Preview asks
 * whether the user is staff. Each read that fails, or that takes longer than `waitMs`,
 * lets the interaction run ungated (logged).
 */
export async function resolveFeatureGate(
  target: FeatureGateTarget,
  userId: string,
  source: IFeatureGateSource,
  waitMs: number = FEATURE_ACCESS_WAIT_MS,
): Promise<FeatureGateDecision> {
  const featureKey = featureKeyFor(target);
  if (!featureKey) return "run";
  const startedAt = Date.now();
  const flags = await settleWithin("Feature Flag lookup", source.flags(), waitMs);
  const state = featureStateFor(featureKey, flags);
  if (state !== "preview") return decideFeatureGate(state, null);
  const remainingMs = Math.max(0, waitMs - (Date.now() - startedAt));
  const staff = await settleWithin(
    `staff lookup for ${userId}`,
    source.isStaff(userId),
    remainingMs,
  );
  return decideFeatureGate(state, staff);
}

function componentJson(component: unknown): unknown {
  const json = component as { toJSON?: () => unknown } | null;
  return typeof json?.toJSON === "function" ? json.toJSON() : component;
}

function isPreviewNoteComponent(component: unknown): boolean {
  return (componentJson(component) as { content?: unknown } | null)?.content ===
    FEATURE_PREVIEW_NOTE;
}

/** Every component in a Components V2 tree, nested ones and accessories included. */
function countV2Components(components: readonly unknown[]): { count: number; text: number } {
  let count = 0;
  let text = 0;
  const visit = (component: unknown): void => {
    const json = componentJson(component) as {
      content?: unknown;
      components?: unknown;
      accessory?: unknown;
    } | null;
    if (!json || typeof json !== "object") return;
    count += 1;
    if (typeof json.content === "string") text += json.content.length;
    if (Array.isArray(json.components)) json.components.forEach(visit);
    if (json.accessory) visit(json.accessory);
  };
  components.forEach(visit);
  return { count, text };
}

/** True when one more text component holding the note fits Discord's V2 limits. */
function previewNoteFits(components: readonly unknown[]): boolean {
  const { count, text } = countV2Components(components);
  return count < DISCORD_V2_COMPONENTS_MAX &&
    text + FEATURE_PREVIEW_NOTE.length <= DISCORD_V2_TEXT_MAX;
}

function withNoteLine(content: string): string {
  if (content.endsWith(FEATURE_PREVIEW_NOTE)) return content;
  const noted = `${content}\n${FEATURE_PREVIEW_NOTE}`;
  return noted.length > DISCORD_MESSAGE_CONTENT_MAX ? content : noted;
}

/**
 * Adds the Preview note to a reply, edit or update payload. Components V2 payloads get a
 * text component after their own; other payloads get a line under their content. A payload
 * that sets neither (an edit keeping the message body) is returned unchanged, and so is
 * one that already carries the note or has no room left for it under Discord's limits
 * (the reply matters more than the note).
 */
export function addPreviewNote<T>(payload: T): T {
  if (typeof payload === "string") return withNoteLine(payload) as T;
  if (!payload || typeof payload !== "object") return payload;
  const options = payload as { flags?: unknown; components?: unknown; content?: unknown };
  if (hasComponentsV2Flag(options.flags)) {
    if (!Array.isArray(options.components)) return payload;
    if (options.components.some(isPreviewNoteComponent)) return payload;
    if (!previewNoteFits(options.components)) return payload;
    const note = new TextDisplayBuilder()
      .setContent(safeV2TextContent(FEATURE_PREVIEW_NOTE, FEATURE_PREVIEW_NOTE.length));
    return { ...payload, components: [...options.components, note] };
  }
  if (typeof options.content !== "string") return payload;
  return { ...payload, content: withNoteLine(options.content) };
}

/**
 * Where a Feature's automated public post goes (bot#1521): its normal channel when Live,
 * the bot-dev channel in Preview so staff can check the real output, nowhere when Off.
 * With no state (the lookup failed) it goes to its normal channel, as a command runs.
 */
export type FeaturePostDestination = "normal" | "bot_dev" | "suppressed";

export function featurePostDestination(state: FeatureState | null): FeaturePostDestination {
  if (state === "off") return "suppressed";
  return state === "preview" ? "bot_dev" : "normal";
}

/** The channel a Feature's post goes to instead of `normalChannelId`, or null when Off. */
export function routeFeaturePost(
  state: FeatureState | null,
  normalChannelId: string,
): string | null {
  const destination = featurePostDestination(state);
  if (destination === "suppressed") return null;
  return destination === "bot_dev" ? BOT_DEV_CHANNEL_ID : normalChannelId;
}

/** Where a voting post goes, and whether it carries the rehearsal banner. */
export interface IVotingPostTarget {
  channelId: string;
  /** A test banner on results, and no winner thread created or renamed. */
  rehearsal: boolean;
}

/**
 * Routes a voting post (panels, results, tie break) by the Voting & GOTM Feature's state.
 * Only a real post bound for announcements is routed: in Preview it goes to the bot-dev
 * channel as a rehearsal, and when Off nothing is posted (null). A rehearsal, or a post an
 * admin sent to another channel, goes where it was asked.
 */
export function routeVotingPost(
  state: FeatureState | null,
  requested: IVotingPostTarget,
): IVotingPostTarget | null {
  if (requested.rehearsal || requested.channelId !== ANNOUNCEMENT_CHANNEL_ID) return requested;
  const destination = featurePostDestination(state);
  if (destination === "suppressed") return null;
  if (destination === "normal") return requested;
  return { channelId: BOT_DEV_CHANNEL_ID, rehearsal: true };
}

/**
 * A Feature's club-wide state for routing a post. A failed lookup (logged) has no state,
 * so the post goes to its normal channel: the gate never loses a post to an API outage.
 */
export async function resolveFeatureState(
  featureKey: string,
  source: IFeatureFlagSource,
): Promise<FeatureState | null> {
  try {
    return featureStateFor(featureKey, await source.flags());
  } catch (err) {
    logError(`FeatureGate: state lookup for ${featureKey} failed; posting as Live`, err);
    return null;
  }
}
