import {
  ActionRowBuilder,
  ButtonBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
} from "@discordjs/builders";
import { ButtonStyle } from "discord-api-types/v10";
import type { Client } from "discord.js";
import { DateTime } from "luxon";
import { CONQUEST_CARD_PAPER, CONQUEST_COVERS_MAX } from "../config/franchiseProgress.js";
import { franchisePageUrl } from "../config/website.js";
import { escapeChallengeText } from "../functions/ChallengeCopy.js";
import { CLUB_TIME_ZONE } from "../functions/ClubDate.js";
import {
  buildComponentsV2View,
  buildTextDisplay,
  type IComponentsV2View,
} from "../functions/ComponentsV2Utils.js";
import { joinWithAnd } from "../utilities/TextUtils.js";

// The Conquest post (spec api#457, bot#1574, design pick 4B): a Components V2 card in the
// completions channel, right after the completion post, when a member Conquers a Franchise
// (a Game Completion for every Mainline game). The API's `franchise_conquest` job carries
// everything the card shows (FranchiseConquestJobPayload), so the bot reads nothing else.
// The member is a `<@id>` token, so Discord shows their name, and the card pings nobody.

/** Discord's longest button label. */
const BUTTON_LABEL_MAX = 80;
/** Discord's longest media gallery item description. */
const GALLERY_DESCRIPTION_MAX = 1024;

export interface IConquestCover {
  gameId: number;
  title: string;
  coverUrl: string;
}

export interface IConquestOther {
  userId: string;
  name: string;
}

/** A `franchise_conquest` job's payload, as the card needs it. */
export interface IFranchiseConquest {
  userId: string;
  franchiseId: number;
  franchiseName: string;
  /** ISO date-time: the day the Mainline set was finished. */
  conqueredAt: string;
  /** The member's Playtime in the Franchise, Mainline and spin-offs. */
  playtimeMinutes: number;
  mainlineTotal: number;
  /** Mainline games with a cover, latest release first. */
  covers: IConquestCover[];
  /** Other current members who Conquered it, earliest first (up to 10). */
  alsoConquered: IConquestOther[];
  /** How many other members have Conquered it in all. */
  alsoConqueredCount: number;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function required<T>(value: T | null, field: string): T {
  if (value === null) {
    throw new Error(`franchise_conquest payload is missing ${field}, so nothing was posted.`);
  }
  return value;
}

function parseCovers(value: unknown): IConquestCover[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const item = record(raw);
    const coverUrl = text(item.cover_url);
    const title = text(item.title);
    const gameId = count(item.game_id);
    return coverUrl && title && gameId ? [{ gameId, title, coverUrl }] : [];
  });
}

function parseOthers(value: unknown): IConquestOther[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const item = record(raw);
    const userId = text(item.user_id);
    return userId ? [{ userId, name: text(item.name) ?? userId }] : [];
  });
}

/**
 * The card's facts from a job payload. Throws when the member, the Franchise or the date
 * is missing; the rest falls back to empty (no covers, no Playtime, nobody else).
 */
export function parseFranchiseConquest(payload: Record<string, unknown>): IFranchiseConquest {
  const conqueredAt = required(text(payload.conquered_at), "conquered_at");
  if (!DateTime.fromISO(conqueredAt).isValid) {
    throw new Error(`franchise_conquest payload has a bad conquered_at: ${conqueredAt}.`);
  }
  const alsoConquered = parseOthers(payload.also_conquered);
  return {
    userId: required(text(payload.user_id), "user_id"),
    franchiseId: required(count(payload.franchise_id) || null, "franchise_id"),
    franchiseName: required(text(payload.franchise_name), "franchise_name"),
    conqueredAt,
    playtimeMinutes: count(payload.playtime_minutes),
    mainlineTotal: count(payload.mainline_total),
    covers: parseCovers(payload.covers),
    alsoConquered,
    alsoConqueredCount: Math.max(count(payload.also_conquered_count), alsoConquered.length),
  };
}

/** Playtime as the website writes it: "812 h", "1,240 h", or "45 m" under an hour. */
export function formatConquestPlaytime(minutes: number): string {
  if (minutes < 60) return `${minutes} m`;
  return `${Math.round(minutes / 60).toLocaleString("en-US")} h`;
}

/** "25 Nov 2026": the day it was Conquered, in the club's time zone. */
export function formatConquestDate(conqueredAt: string): string {
  return DateTime.fromISO(conqueredAt).setZone(CLUB_TIME_ZONE).toFormat("d LLL yyyy");
}

/** "Joins Rowan, Jun and Ada.", with "and N more" past the names the API sent. */
function othersLine(conquest: IFranchiseConquest): string {
  const names = conquest.alsoConquered.map((other) => escapeChallengeText(other.name));
  if (!names.length) return "The first member to Conquer it.";
  const more = conquest.alsoConqueredCount - names.length;
  return more > 0
    ? `Joins ${names.join(", ")} and ${more} more.`
    : `Joins ${joinWithAnd(names)}.`;
}

/** The line under the gallery: the Franchise Playtime, then who else Conquered it. */
export function conquestFooterLine(conquest: IFranchiseConquest): string {
  const playtime = conquest.playtimeMinutes > 0
    ? `**${formatConquestPlaytime(conquest.playtimeMinutes)}** of Playtime in the Franchise. `
    : "";
  return `${playtime}${othersLine(conquest)}`;
}

function coverGallery(covers: readonly IConquestCover[]): MediaGalleryBuilder | null {
  const items = covers.slice(0, CONQUEST_COVERS_MAX).map((cover) =>
    new MediaGalleryItemBuilder()
      .setURL(cover.coverUrl)
      .setDescription(cover.title.slice(0, GALLERY_DESCRIPTION_MAX)));
  return items.length ? new MediaGalleryBuilder().addItems(...items) : null;
}

function openButtonLabel(franchiseName: string): string {
  const label = `Open ${franchiseName}`;
  return label.length <= BUTTON_LABEL_MAX ? label : `${label.slice(0, BUTTON_LABEL_MAX - 3)}...`;
}

/**
 * Design 4B: "<member> Conquered <Franchise>", "Every Mainline game · 16 of 16 · <date>",
 * a gallery of up to 10 Mainline covers, the Franchise Playtime and who else Conquered it,
 * and an "Open <Franchise>" link, in a paper-edged container. Pings nobody.
 */
export function buildConquestCard(conquest: IFranchiseConquest): IComponentsV2View {
  const name = escapeChallengeText(conquest.franchiseName);
  const total = conquest.mainlineTotal;
  const facts = [
    "Every Mainline game",
    ...(total > 0 ? [`${total} of ${total}`] : []),
    formatConquestDate(conquest.conqueredAt),
  ];
  const container = new ContainerBuilder()
    .setAccentColor(CONQUEST_CARD_PAPER)
    .addTextDisplayComponents(
      buildTextDisplay(`## <@${conquest.userId}> Conquered ${name}`),
      buildTextDisplay(`-# ${facts.join(" · ")}`),
    );
  const gallery = coverGallery(conquest.covers);
  if (gallery) container.addMediaGalleryComponents(gallery);
  container.addTextDisplayComponents(buildTextDisplay(conquestFooterLine(conquest)));
  const links = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel(openButtonLabel(conquest.franchiseName))
      .setURL(franchisePageUrl(conquest.franchiseId)),
  );
  return buildComponentsV2View([container.toJSON(), links.toJSON()]);
}

/** What the Conquest job posts with. */
export interface IConquestPostDeps {
  /** Posts to a text channel. Throws the discord.js error, or when it can't hold posts. */
  postMessage(channelId: string, post: IComponentsV2View): Promise<void>;
}

export function createConquestPostDeps(client: Client): IConquestPostDeps {
  return {
    postMessage: async (channelId, post) => {
      const channel = await client.channels.fetch(channelId);
      if (!channel || !channel.isSendable()) {
        throw new Error(`Channel ${channelId} is missing or the bot cannot post in it.`);
      }
      await channel.send(post);
    },
  };
}

/** Posts the Conquest card in `channelId`; returns the job's result line. */
export async function postFranchiseConquest(
  conquest: IFranchiseConquest,
  channelId: string,
  deps: IConquestPostDeps,
): Promise<string> {
  await deps.postMessage(channelId, buildConquestCard(conquest));
  return `Posted ${conquest.userId}'s Conquest of ${conquest.franchiseName} in ${channelId}.`;
}
