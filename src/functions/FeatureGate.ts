/**
 * The bot's feature gate (spec api#347, bot#1520). The API decides who can use what
 * (ADR 0005); this module only maps an interaction to a Feature key and turns the API's
 * per-user answer into what the bot does with the interaction.
 */

import { TextDisplayBuilder } from "discord.js";

import { FEATURE_ACCESS_WAIT_MS } from "../config/cacheDefaults.js";
import { BOT_DEV_CHANNEL_ID } from "../config/channels.js";
import { FEATURE_COMMANDS, FEATURE_COMPONENT_PREFIXES } from "../config/featureGate.js";
import { logError, logWarn } from "../utilities/LogUtils.js";
import { hasComponentsV2Flag, safeV2TextContent } from "./ComponentsV2Utils.js";

/** The private reply to someone who can't use the Feature (Preview for non-staff, or Off). */
export const FEATURE_NOT_AVAILABLE_MESSAGE = "This feature isn't available yet.";

/** Added to every reply of a Feature a staff member can use only because it is in Preview. */
export const FEATURE_PREVIEW_NOTE = "-# Preview - staff only";

const MESSAGE_CONTENT_LIMIT = 2000;

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
 * Decides what happens to an interaction that belongs to `featureKey` (null when the
 * command is not mapped to a Feature). With no access answer (the lookup failed or timed
 * out) or no entry for the key, the interaction runs: the gate never turns an API outage
 * into a refusal.
 */
export function decideFeatureGate(
  featureKey: string | null,
  access: IFeatureAccess | null,
): FeatureGateDecision {
  if (!featureKey || !access) return "run";
  const entry = access.features.find((feature) => feature.key === featureKey);
  if (!entry) return "run";
  if (!entry.canUse) return "not_available";
  return entry.preview ? "preview_note" : "run";
}

/** Where the gate reads a user's Feature access from (the cached API lookup in the bot). */
export interface IFeatureAccessSource {
  get(userId: string): Promise<IFeatureAccess>;
}

/**
 * The gate for one interaction: maps it to a Feature, and only then looks up the acting
 * user's access. A lookup that fails, or that takes longer than `waitMs`, lets the
 * interaction run ungated (it is logged, and a late answer still fills the cache).
 */
export async function resolveFeatureGate(
  target: FeatureGateTarget,
  userId: string,
  source: IFeatureAccessSource,
  waitMs: number = FEATURE_ACCESS_WAIT_MS,
): Promise<FeatureGateDecision> {
  const featureKey = featureKeyFor(target);
  if (!featureKey) return "run";

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      logWarn("FeatureGate", `access lookup for ${userId} took over ${waitMs}ms; running ungated`);
      resolve(null);
    }, waitMs);
  });
  const lookup = source.get(userId).catch((err: unknown) => {
    logError(`FeatureGate: access lookup failed for ${userId}; running ungated`, err);
    return null;
  });
  try {
    return decideFeatureGate(featureKey, await Promise.race([lookup, timeout]));
  } finally {
    clearTimeout(timer);
  }
}

function isPreviewNoteComponent(component: unknown): boolean {
  const json = component instanceof TextDisplayBuilder ? component.toJSON() : component;
  return (json as { content?: unknown } | null)?.content === FEATURE_PREVIEW_NOTE;
}

function withNoteLine(content: string): string {
  if (content.endsWith(FEATURE_PREVIEW_NOTE)) return content;
  const noted = `${content}\n${FEATURE_PREVIEW_NOTE}`;
  return noted.length > MESSAGE_CONTENT_LIMIT ? content : noted;
}

/**
 * Adds the Preview note to a reply, edit or update payload. Components V2 payloads get a
 * text component after their own; other payloads get a line under their content. A payload
 * that sets neither (an edit keeping the message body) is returned unchanged, and so is
 * one that already carries the note.
 */
export function addPreviewNote<T>(payload: T): T {
  if (typeof payload === "string") return withNoteLine(payload) as T;
  if (!payload || typeof payload !== "object") return payload;
  const options = payload as { flags?: unknown; components?: unknown; content?: unknown };
  if (hasComponentsV2Flag(options.flags)) {
    if (!Array.isArray(options.components)) return payload;
    if (options.components.some(isPreviewNoteComponent)) return payload;
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

/** The club-wide state of a Feature in an access lookup, or null when it is not listed. */
export function featureStateFor(
  featureKey: string,
  access: IFeatureAccess | null,
): FeatureState | null {
  return access?.features.find((feature) => feature.key === featureKey)?.state ?? null;
}

/**
 * A Feature's club-wide state for routing a post. A flag's state does not depend on who
 * asks, so the lookup runs for `lookupUserId` (the bot's own user). With no user (the bot
 * is not logged in) or a failed lookup (logged) there is no state, and the post goes to
 * its normal channel: the gate never loses a post to an API outage.
 */
export async function resolveFeatureState(
  featureKey: string,
  lookupUserId: string | null,
  source: IFeatureAccessSource,
): Promise<FeatureState | null> {
  if (!lookupUserId) return null;
  try {
    return featureStateFor(featureKey, await source.get(lookupUserId));
  } catch (err) {
    logError(`FeatureGate: state lookup for ${featureKey} failed; posting as Live`, err);
    return null;
  }
}
