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

/**
 * Text characters per message. Discord allows 4000 across all of a Components V2
 * message's text displays; the margin covers anything a card adds beyond its fields.
 */
export const HIGHLIGHT_MESSAGE_TEXT_BUDGET = 3800;

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
    /** A secret Achievement. Missing (an older API) is treated as false. */
    hidden?: boolean;
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

/** Where and how Highlights are posted. */
export interface IHighlightPosting {
  getChannel: () => Promise<IHighlightChannel | null>;
  /** The www origin that each Highlight's `url_path` is joined to. */
  wwwBaseUrl: string;
}

export interface IAchievementHighlightDeps {
  api: IAchievementHighlightApi;
  /** Null when Highlight posting is not configured; the PSN auth alert still runs. */
  highlights: IHighlightPosting | null;
  getAdminChannel: () => Promise<IHighlightChannel | null>;
  /** Wait before retrying a failed ack. Defaults to ACK_RETRY_DELAY_MS. */
  ackRetryDelayMs?: number;
}

const ACK_RETRY_DELAY_MS = 2000;

/** Pending pages (25 Unlocks each) one tick may post. Re-fetches add no extra wakeups. */
export const MAX_PENDING_PAGES_PER_TICK = 10;

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

// Escaped length of one card field, so a card stays a small share of the message budget.
const CARD_FIELD_MAX_LENGTH = 80;

/** A trimmed, escaped field, truncated until its escaped form fits CARD_FIELD_MAX_LENGTH. */
function cardField(value: string | null | undefined, fallback: string): string {
  const text = (value ?? "").trim() || fallback;
  for (let max = Math.min(text.length, CARD_FIELD_MAX_LENGTH); max > 0; max--) {
    const escaped = escapeMarkdown(truncateWithEllipsis(text, max));
    if (escaped.length <= CARD_FIELD_MAX_LENGTH) return escaped;
  }
  return "";
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
  const platform = cardField(set.platform_label, "");
  if (platform) parts.push(platform);
  parts.push(PROVIDER_LABELS[set.provider]);
  return parts.join(" · ");
}

/** Joins the www origin and a Highlight's set page path. */
export function buildSetPageUrl(wwwBaseUrl: string, urlPath: string): string {
  return `${wwwBaseUrl.replace(/\/+$/, "")}/${urlPath.replace(/^\/+/, "")}`;
}

const HIDDEN_ACHIEVEMENT_NAME = "Hidden achievement";

/**
 * The text of one Highlight card. A hidden Achievement is masked as on www: no name, and
 * the set's icon in place of its own, so the public post spoils nothing. The member is
 * named by display name, never mentioned, so the post pings nobody even if the message's
 * allowed mentions were ever widened.
 */
export function buildHighlightCardText(
  item: IAchievementHighlight,
  deps: Pick<IHighlightPosting, "wwwBaseUrl">,
): string {
  const member = cardField(item.display_name, item.user_id);
  const achievement = item.achievement.hidden
    ? HIDDEN_ACHIEVEMENT_NAME
    : cardField(item.achievement.name, HIDDEN_ACHIEVEMENT_NAME);
  return [
    `**${member}** unlocked **${achievement}**`,
    buildSetLine(item),
    buildMarkerLine(item),
    buildMaskedLink("View set", buildSetPageUrl(deps.wwwBaseUrl, item.url_path)),
  ].join("\n");
}

export function buildHighlightCard(
  item: IAchievementHighlight,
  deps: Pick<IHighlightPosting, "wwwBaseUrl">,
): ContainerBuilder {
  return buildCard(item, buildHighlightCardText(item, deps));
}

function buildCard(item: IAchievementHighlight, text: string): ContainerBuilder {
  const achievementIcon = item.achievement.hidden ? null : item.achievement.icon_url;
  const icon = achievementIcon || item.achievement_set.icon_url || null;
  return buildContentContainer(text, icon).setAccentColor(HIGHLIGHT_COLORS[item.highlight]);
}

interface IHighlightCard {
  item: IAchievementHighlight;
  container: ContainerBuilder;
  textLength: number;
}

/**
 * Groups cards into messages of at most HIGHLIGHTS_PER_MESSAGE cards and
 * HIGHLIGHT_MESSAGE_TEXT_BUDGET characters of text, keeping their order.
 */
function groupIntoMessages(cards: IHighlightCard[]): IHighlightCard[][] {
  const groups: IHighlightCard[][] = [];
  let current: IHighlightCard[] = [];
  let textLength = 0;
  for (const card of cards) {
    const full =
      current.length === HIGHLIGHTS_PER_MESSAGE ||
      textLength + card.textLength > HIGHLIGHT_MESSAGE_TEXT_BUDGET;
    if (current.length > 0 && full) {
      groups.push(current);
      current = [];
      textLength = 0;
    }
    current.push(card);
    textLength += card.textLength;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/** Wraps one message's worth of cards as a message. */
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

  const posting = deps.highlights;
  if (posting) {
    await runStep("postHighlights", () => postHighlights(deps, posting, pending.data));
  }
  await runStep("postPsnAuthAlert", () => postPsnAuthAlert(deps, pending.alerts));
}

/**
 * Posts the first pending page, then re-fetches until the outbox is empty, so a backlog
 * drains within one tick instead of 25 an hour. Bounded by MAX_PENDING_PAGES_PER_TICK, and
 * stops early if a page holds nothing new (an ack the API did not apply).
 */
async function postHighlights(
  deps: IAchievementHighlightDeps,
  posting: IHighlightPosting,
  firstPage: IAchievementHighlight[],
): Promise<void> {
  if (firstPage.length === 0) return;
  const channel = await posting.getChannel();
  if (!channel) {
    logWarn(LOG_CONTEXT, "The achievements channel is unavailable; Highlights stay pending.");
    return;
  }
  const posted = new Set<number>();
  let highlights = firstPage;
  for (let pages = 1; ; pages++) {
    const fresh = highlights.filter((item) => !posted.has(item.id));
    if (fresh.length === 0) return;
    await postPage(deps, posting, channel, fresh);
    for (const item of fresh) posted.add(item.id);
    if (pages >= MAX_PENDING_PAGES_PER_TICK) return;
    highlights = (await deps.api.fetchPending()).data;
  }
}

async function postPage(
  deps: IAchievementHighlightDeps,
  posting: IHighlightPosting,
  channel: IHighlightChannel,
  highlights: IAchievementHighlight[],
): Promise<void> {
  const cards = highlights.map((item) => {
    const text = buildHighlightCardText(item, posting);
    return { item, container: buildCard(item, text), textLength: text.length };
  });
  for (const group of groupIntoMessages(cards)) {
    await postCards(deps, channel, group);
  }
}

// Statuses that say the channel or bot is unusable, or to wait, rather than that a card is bad.
const CHANNEL_LEVEL_STATUSES = new Set([401, 403, 404, 429]);

/**
 * True when Discord rejected the message's content (a 4xx such as 400 Invalid Form Body),
 * so sending the same cards again would fail the same way.
 */
export function isRejectedContent(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  return (
    typeof status === "number" &&
    status >= 400 &&
    status < 500 &&
    !CHANNEL_LEVEL_STATUSES.has(status)
  );
}

/**
 * Sends cards as one message and acks them. When Discord rejects the content, each card is
 * retried as its own message, and a card rejected on its own is logged, acked and skipped,
 * so one bad card cannot hold back the outbox. Any other failure stops the tick.
 */
async function postCards(
  deps: IAchievementHighlightDeps,
  channel: IHighlightChannel,
  cards: IHighlightCard[],
): Promise<void> {
  try {
    await channel.send(toQuietMessage(cards.map((card) => card.container)));
  } catch (err) {
    if (!isRejectedContent(err)) throw err;
    if (cards.length > 1) {
      for (const card of cards) await postCards(deps, channel, [card]);
      return;
    }
    logWarn(LOG_CONTEXT, `Discord rejected Highlight ${cards[0]!.item.id}; skipping it.`);
    logError(`${LOG_CONTEXT}.skippedHighlight`, err);
  }
  await ackHighlights(
    deps,
    cards.map((card) => card.item.id),
  );
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

/** The Highlight posting config, or null (with a warning) when any part of it is missing. */
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
    logWarn(
      LOG_CONTEXT,
      `Highlight posting is off: ${missing.join(" and ")} not configured. ` +
        "The PSN auth alert still runs.",
    );
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
 * The live deps. Highlight posting needs ACHIEVEMENTS_CHANNEL_ID and RPGCLUB_WWW_BASE_URL;
 * without them it is off, but the PSN auth alert (admin channel only) still runs.
 */
export function buildAchievementHighlightDeps(
  client: Client,
  options: IStartAchievementHighlightOptions = {},
): IAchievementHighlightDeps {
  const config = resolveAchievementHighlightConfig(
    options.channelId ?? ACHIEVEMENTS_CHANNEL_ID,
    options.wwwBaseUrl ?? process.env.RPGCLUB_WWW_BASE_URL,
  );
  return {
    api: achievementHighlightApi,
    highlights: config && {
      getChannel: () => fetchSendableChannel(client, config.channelId),
      wwwBaseUrl: config.wwwBaseUrl,
    },
    getAdminChannel: () => fetchSendableChannel(client, ADMIN_CHANNEL_ID),
  };
}

/**
 * Starts the hourly Highlight and PSN alert poster. Hourly and never faster (ADR 0003:
 * Neon must idle). Returns false when already running. The interval is tracked, so the
 * shutdown service stops it with the others.
 */
export function startAchievementHighlightService(
  client: Client,
  options: IStartAchievementHighlightOptions = {},
): boolean {
  if (highlightTask) {
    logWarn(LOG_CONTEXT, "Already started, ignoring a second start.");
    return false;
  }
  const deps = buildAchievementHighlightDeps(client, options);
  highlightTask = createIntervalTask({
    name: `${LOG_CONTEXT}.polling`,
    intervalMs: POLL_INTERVAL_MS,
    task: () => runAchievementHighlightTick(deps),
  });
  return highlightTask.start();
}
