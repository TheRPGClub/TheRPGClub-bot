import type { ContainerBuilder } from "@discordjs/builders";
import { escapeMarkdown } from "discord.js";
import {
  COLOR_HIGHLIGHT,
  COLOR_INFO,
  COLOR_PURPLE,
  COLOR_SUCCESS,
} from "../config/colors.js";
import {
  buildComponentsV2EditFlags,
  buildContentContainer,
  buildMaskedLink,
} from "../functions/ComponentsV2Utils.js";
import { truncateWithEllipsis } from "../utilities/ValidationUtils.js";
import { logError } from "../utilities/LogUtils.js";

const LOG_CONTEXT = "AchievementHighlightService";

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

export interface IPendingHighlights {
  data: IAchievementHighlight[];
  meta: { cursor: number; next_cursor: number | null };
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
  ackHighlights: (cursor: number) => Promise<void>;
  ackAlert: (alert: AchievementHubAlert) => Promise<void>;
}

export interface IAchievementHighlightDeps {
  api: IAchievementHighlightApi;
  getHighlightChannel: () => Promise<IHighlightChannel | null>;
  getAdminChannel: () => Promise<IHighlightChannel | null>;
  /** The www origin that each Highlight's `url_path` is joined to. */
  wwwBaseUrl: string;
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    batches.push(items.slice(start, start + size));
  }
  return batches;
}

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

function buildMessage(containers: ContainerBuilder[]): IHighlightMessage {
  return {
    components: containers,
    flags: buildComponentsV2EditFlags(),
    allowedMentions: { parse: [] },
  };
}

/**
 * One hourly tick: post pending Highlights, acking the cursor after each message Discord
 * accepts, then post the PSN auth alert once. Any failure stops the tick; the next tick
 * picks up from the stored cursor.
 */
export async function runAchievementHighlightTick(
  deps: IAchievementHighlightDeps,
): Promise<void> {
  let pending: IPendingHighlights;
  try {
    pending = await deps.api.fetchPending();
  } catch (err) {
    logError(`${LOG_CONTEXT}.fetchPending`, err);
    return;
  }

  const channel = await deps.getHighlightChannel();
  if (!channel) return;
  try {
    await postHighlights(deps, channel, pending.data);
  } catch (err) {
    logError(`${LOG_CONTEXT}.postHighlights`, err);
  }
}

async function postHighlights(
  deps: IAchievementHighlightDeps,
  channel: IHighlightChannel,
  highlights: IAchievementHighlight[],
): Promise<void> {
  for (const batch of chunk(highlights, HIGHLIGHTS_PER_MESSAGE)) {
    await channel.send(buildMessage(batch.map((item) => buildHighlightCard(item, deps))));
    await deps.api.ackHighlights(batch[batch.length - 1]!.id);
  }
}
