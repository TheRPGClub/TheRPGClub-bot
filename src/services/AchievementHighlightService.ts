import type { ContainerBuilder } from "@discordjs/builders";
import { escapeMarkdown } from "discord.js";
import type { Client } from "discordx";
import { ACHIEVEMENTS_CHANNEL_ID, ADMIN_CHANNEL_ID } from "../config/channels.js";
import {
  COLOR_HIGHLIGHT,
  COLOR_INFO,
  COLOR_PURPLE,
  COLOR_SUCCESS,
  COLOR_WARNING,
} from "../config/colors.js";
import {
  buildAccentContainer,
  buildComponentsV2EditFlags,
  buildContentContainer,
  buildMaskedLink,
} from "../functions/ComponentsV2Utils.js";
import { chunk } from "../utilities/ArrayUtils.js";
import { createIntervalTask, type IIntervalTask } from "../utilities/IntervalUtils.js";
import { truncateWithEllipsis } from "../utilities/ValidationUtils.js";
import { apiGet, apiPostOrThrow } from "./RpgClubApiClient.js";
import { logError, logWarn } from "../utilities/LogUtils.js";

const LOG_CONTEXT = "AchievementHighlightService";

const PENDING_PATH = "/api/v1/achievements/highlights/pending";
const HIGHLIGHTS_ACK_PATH = "/api/v1/achievements/highlights/ack";
const ALERTS_ACK_PATH = "/api/v1/achievements/alerts/ack";

/**
 * Cards per message. Discord caps a Components V2 message at 40 components, and a card
 * with an icon is four (container, section, text, thumbnail).
 */
export const HIGHLIGHTS_PER_MESSAGE = 10;

export type HighlightKind = "platinum" | "completion" | "mastery" | "rare";
export type AchievementProvider = "retroachievements" | "steam" | "psn";
export type AchievementTier = "bronze" | "silver" | "gold" | "platinum";
export type AchievementHubAlert = "psn_auth_expired";

/** One announceable Unlock, as `GET /achievements/highlights/pending` lists it. */
export interface IAchievementHighlight {
  id: number;
  highlight: HighlightKind;
  hardcore: boolean;
  unlocked_at: string;
  user_id: string;
  display_name: string;
  url_path: string;
  achievement: {
    id: number;
    name?: string | null;
    description?: string | null;
    icon_url?: string | null;
    tier?: AchievementTier | null;
    points?: number | null;
    rarity?: number | null;
  };
  achievement_set: {
    id: number;
    title?: string | null;
    provider: AchievementProvider;
    platform_label?: string | null;
    icon_url?: string | null;
  };
}

export interface IAchievementHubAlerts {
  psn_auth_expired_at: string | null;
  psn_auth_alerted: boolean;
}

/** Un-announced Unlocks, oldest first, capped at 25 per request. */
export interface IPendingHighlights {
  data: IAchievementHighlight[];
  alerts: IAchievementHubAlerts;
}

/** Every message this service sends: Components V2, and never a ping. */
export interface IHighlightMessage {
  components: ContainerBuilder[];
  flags: number;
  allowedMentions: { parse: [] };
}

export interface IHighlightChannel {
  send: (message: IHighlightMessage) => Promise<unknown>;
}

export interface IAchievementHighlightApi {
  fetchPending: () => Promise<IPendingHighlights>;
  /** Marks these Unlocks announced. Idempotent, so a retry is safe. */
  ackHighlights: (ids: number[]) => Promise<void>;
  ackAlert: (alert: AchievementHubAlert) => Promise<void>;
}

export interface IAchievementHighlightDeps {
  api: IAchievementHighlightApi;
  getHighlightChannel: () => Promise<IHighlightChannel | null>;
  getAdminChannel: () => Promise<IHighlightChannel | null>;
  /** The www origin that each Highlight's `url_path` is joined to. */
  wwwBaseUrl: string;
  /** Wait before retrying a failed ack. Defaults to ACK_RETRY_DELAY_MS. */
  ackRetryDelayMs?: number;
}

const ACK_RETRY_DELAY_MS = 2000;

const PROVIDER_LABELS: Record<AchievementProvider, string> = {
  retroachievements: "RetroAchievements",
  steam: "Steam",
  psn: "PlayStation Network",
};

const HIGHLIGHT_LABELS: Record<HighlightKind, string> = {
  platinum: "Platinum",
  completion: "Completion",
  mastery: "Mastery",
  rare: "Rare",
};

const HIGHLIGHT_COLORS: Record<HighlightKind, number> = {
  platinum: COLOR_PURPLE,
  completion: COLOR_SUCCESS,
  mastery: COLOR_HIGHLIGHT,
  rare: COLOR_INFO,
};

// A Components V2 message holds at most 4000 characters of text, shared by its cards.
const CARD_FIELD_MAX_LENGTH = 80;

function cardField(value: string | null | undefined, fallback: string): string {
  const text = (value ?? "").trim() || fallback;
  return escapeMarkdown(truncateWithEllipsis(text, CARD_FIELD_MAX_LENGTH));
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatRarity(rarity: number): string {
  return `${Number(rarity.toFixed(2))}% Rarity`;
}

/** The Highlight kind, then the PSN tier or RetroAchievements hardcore marker, then Rarity. */
function buildMarkerLine(item: IAchievementHighlight): string {
  const parts = [HIGHLIGHT_LABELS[item.highlight]];
  const tier = item.achievement.tier;
  if (tier) parts.push(`${capitalize(tier)} trophy`);
  if (item.hardcore) parts.push("Hardcore");
  const rarity = item.achievement.rarity;
  if (typeof rarity === "number") parts.push(formatRarity(rarity));
  return parts.join(" · ");
}

function buildSetLine(item: IAchievementHighlight): string {
  const set = item.achievement_set;
  const parts = [`*${cardField(set.title, "Unknown set")}*`];
  if (set.platform_label) parts.push(cardField(set.platform_label, ""));
  parts.push(PROVIDER_LABELS[set.provider]);
  return parts.join(" · ");
}

/** Joins the www origin and a Highlight's set page path. */
export function buildSetPageUrl(wwwBaseUrl: string, urlPath: string): string {
  return `${wwwBaseUrl.replace(/\/+$/, "")}/${urlPath.replace(/^\/+/, "")}`;
}

/**
 * One Highlight card. The member is named by display name, never mentioned, so the post
 * pings nobody even if the message's allowed mentions were ever widened.
 */
export function buildHighlightCard(
  item: IAchievementHighlight,
  deps: Pick<IAchievementHighlightDeps, "wwwBaseUrl">,
): ContainerBuilder {
  const member = cardField(item.display_name, item.user_id);
  const achievement = cardField(item.achievement.name, "Hidden achievement");
  const lines = [
    `**${member}** unlocked **${achievement}**`,
    buildSetLine(item),
    buildMarkerLine(item),
    buildMaskedLink("View set", buildSetPageUrl(deps.wwwBaseUrl, item.url_path)),
  ];
  const icon = item.achievement.icon_url || item.achievement_set.icon_url || null;
  return buildContentContainer(lines.join("\n"), icon).setAccentColor(
    HIGHLIGHT_COLORS[item.highlight],
  );
}

/** Wraps one already chunked set of cards (see HIGHLIGHTS_PER_MESSAGE) as a message. */
function toQuietMessage(containers: ContainerBuilder[]): IHighlightMessage {
  return {
    components: containers,
    flags: buildComponentsV2EditFlags(),
    allowedMentions: { parse: [] },
  };
}

export const PSN_AUTH_EXPIRED_ALERT_TEXT =
  "**PSN token expired.** Refresh `psn_npsso` in the API credentials so PSN sync can resume.";

/** True while PSN auth is expired and this expiry has not been posted yet. */
export function needsPsnAuthAlert(alerts: IAchievementHubAlerts): boolean {
  return Boolean(alerts.psn_auth_expired_at) && !alerts.psn_auth_alerted;
}

async function runStep(name: string, step: () => Promise<void>): Promise<void> {
  try {
    await step();
  } catch (err) {
    logError(`${LOG_CONTEXT}.${name}`, err);
  }
}

/**
 * One hourly tick: post pending Highlights, acking their ids after each message Discord
 * accepts, then post the PSN auth alert once. A failed step is logged and left for the
 * next tick, which picks up whatever is still un-announced.
 */
export async function runAchievementHighlightTick(deps: IAchievementHighlightDeps): Promise<void> {
  let pending: IPendingHighlights;
  try {
    pending = await deps.api.fetchPending();
  } catch (err) {
    logError(`${LOG_CONTEXT}.fetchPending`, err);
    return;
  }

  await runStep("postHighlights", () => postHighlights(deps, pending.data));
  await runStep("postPsnAuthAlert", () => postPsnAuthAlert(deps, pending.alerts));
}

async function postHighlights(
  deps: IAchievementHighlightDeps,
  highlights: IAchievementHighlight[],
): Promise<void> {
  if (highlights.length === 0) return;
  const channel = await deps.getHighlightChannel();
  if (!channel) {
    logWarn(LOG_CONTEXT, "The achievements channel is unavailable; Highlights stay pending.");
    return;
  }
  for (const batch of chunk(highlights, HIGHLIGHTS_PER_MESSAGE)) {
    await channel.send(toQuietMessage(batch.map((item) => buildHighlightCard(item, deps))));
    await ackHighlights(
      deps,
      batch.map((item) => item.id),
    );
  }
}

/** Acks posted Highlights, retrying once so a brief API blip does not repost them. */
async function ackHighlights(deps: IAchievementHighlightDeps, ids: number[]): Promise<void> {
  try {
    await deps.api.ackHighlights(ids);
  } catch (err) {
    logWarn(LOG_CONTEXT, `Highlight ack failed, retrying once: ${String(err)}`);
    await new Promise((resolve) => setTimeout(resolve, deps.ackRetryDelayMs ?? ACK_RETRY_DELAY_MS));
    await deps.api.ackHighlights(ids);
  }
}

async function postPsnAuthAlert(
  deps: IAchievementHighlightDeps,
  alerts: IAchievementHubAlerts,
): Promise<void> {
  if (!needsPsnAuthAlert(alerts)) return;
  const channel = await deps.getAdminChannel();
  if (!channel) {
    logWarn(LOG_CONTEXT, "The admin channel is unavailable; the PSN auth alert stays pending.");
    return;
  }
  await channel.send(
    toQuietMessage([buildAccentContainer(PSN_AUTH_EXPIRED_ALERT_TEXT, COLOR_WARNING)]),
  );
  await deps.api.ackAlert("psn_auth_expired");
}

const POLL_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export interface IAchievementHighlightConfig {
  channelId: string;
  wwwBaseUrl: string;
}

/** The service's config, or null (with a warning) when any part of it is missing. */
export function resolveAchievementHighlightConfig(
  channelId: string,
  wwwBaseUrl: string | undefined,
): IAchievementHighlightConfig | null {
  const baseUrl = (wwwBaseUrl ?? "").trim().replace(/\/+$/, "");
  const missing = [
    channelId.trim() ? null : "ACHIEVEMENTS_CHANNEL_ID",
    baseUrl ? null : "RPGCLUB_WWW_BASE_URL",
  ].filter((name): name is string => name !== null);
  if (missing.length > 0) {
    logWarn(LOG_CONTEXT, `Disabled: ${missing.join(" and ")} not configured.`);
    return null;
  }
  return { channelId: channelId.trim(), wwwBaseUrl: baseUrl };
}

/** The Highlight endpoints, called only through RpgClubApiClient. */
export const achievementHighlightApi: IAchievementHighlightApi = {
  fetchPending: async () => {
    const pending = await apiGet<IPendingHighlights>(PENDING_PATH);
    if (!pending) throw new Error(`GET ${PENDING_PATH} returned 404.`);
    return pending;
  },
  ackHighlights: async (ids) => {
    await apiPostOrThrow(HIGHLIGHTS_ACK_PATH, { data: { ids } });
  },
  ackAlert: async (alert) => {
    await apiPostOrThrow(ALERTS_ACK_PATH, { alert });
  },
};

async function fetchSendableChannel(
  client: Client,
  channelId: string,
): Promise<IHighlightChannel | null> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isSendable()) return null;
  return channel;
}

let highlightTask: IIntervalTask | null = null;

export interface IStartAchievementHighlightOptions {
  channelId?: string;
  wwwBaseUrl?: string;
}

/**
 * Starts the hourly Highlight poster. Hourly and never faster (ADR 0003: Neon must idle).
 * Returns false when the service is disabled or already running. The interval is tracked,
 * so the shutdown service stops it with the others.
 */
export function startAchievementHighlightService(
  client: Client,
  options: IStartAchievementHighlightOptions = {},
): boolean {
  if (highlightTask) {
    logWarn(LOG_CONTEXT, "Already started, ignoring a second start.");
    return false;
  }
  const config = resolveAchievementHighlightConfig(
    options.channelId ?? ACHIEVEMENTS_CHANNEL_ID,
    options.wwwBaseUrl ?? process.env.RPGCLUB_WWW_BASE_URL,
  );
  if (!config) return false;

  const deps: IAchievementHighlightDeps = {
    api: achievementHighlightApi,
    getHighlightChannel: () => fetchSendableChannel(client, config.channelId),
    getAdminChannel: () => fetchSendableChannel(client, ADMIN_CHANNEL_ID),
    wwwBaseUrl: config.wwwBaseUrl,
  };
  highlightTask = createIntervalTask({
    name: `${LOG_CONTEXT}.polling`,
    intervalMs: POLL_INTERVAL_MS,
    task: () => runAchievementHighlightTick(deps),
  });
  return highlightTask.start();
}
