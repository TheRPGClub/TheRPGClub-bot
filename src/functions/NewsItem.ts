import type { NewsCategoryKey, NewsPlaces } from "../config/newsHub.js";

// What makes a Discord message a News Item, and the payload the API records for it
// (spec api#355, "What a News Item stores" and "What makes a message a News Item").

/** The parts of a Discord message a News Item is read from. A discord.js Message fits. */
export interface INewsMessage {
  id: string;
  channelId: string;
  system: boolean;
  webhookId: string | null;
  author: { id: string; bot: boolean; username: string; globalName: string | null };
  member: { displayName: string } | null;
  /** The text as a reader sees it: mentions and custom emoji resolved. */
  cleanContent: string;
  createdAt: Date;
  editedAt: Date | null;
  attachments: ReadonlyMap<string, INewsAttachment>;
  /** Discord's link previews. A member cannot post an embed of their own. */
  embeds: readonly INewsEmbed[];
}

export interface INewsAttachment {
  url: string;
  contentType: string | null;
  name: string;
}

export interface INewsEmbed {
  url: string | null;
  title: string | null;
  description: string | null;
  provider: { name?: string } | null;
  /** Who posted it, for a social post (X, Bluesky), whose preview has no title. */
  author?: { name?: string } | null;
  /** `proxyURL` is Discord's copy of the image, which loads where the site's own may not. */
  thumbnail: { url: string; proxyURL?: string } | null;
  image: { url: string; proxyURL?: string } | null;
}

export interface INewsLinkPayload {
  url: string;
  title: string | null;
  site_name: string | null;
  description: string | null;
  image_url: string | null;
}

export interface INewsImagePayload {
  url: string;
  /** When the signed address expires; null for an address that does not expire. */
  expires_at: string | null;
}

/** One News Item as the API records it: the PUT body's `data` plus the message ID. */
export interface INewsItemPayload {
  message_id: string;
  channel_id: string;
  category_key: NewsCategoryKey | null;
  author_id: string;
  author_name: string;
  comment: string | null;
  posted_at: string;
  edited_at: string | null;
  link: INewsLinkPayload | null;
  images: INewsImagePayload[];
}

const LINK_PATTERN = /https?:\/\/[^\s<>]+/gi;
const TRAILING_PUNCTUATION = ".,:;!?'\"*_~|";

function count(text: string, char: string): number {
  return text.split(char).length - 1;
}

/**
 * Drops what Discord does not count as part of an address: trailing punctuation, and a
 * closing bracket with no opening one in the address (a link in parentheses, or the end
 * of a masked link `[label](url)`).
 */
function trimAddress(raw: string): string {
  let url = raw;
  for (;;) {
    const last = url.at(-1) ?? "";
    const unbalanced = (last === ")" && count(url, "(") < count(url, ")")) ||
      (last === "]" && count(url, "[") < count(url, "]"));
    if (!TRAILING_PUNCTUATION.includes(last) && !unbalanced) return url;
    url = url.slice(0, -1);
  }
}

function isWebAddress(text: string): boolean {
  try {
    const { protocol, hostname } = new URL(text);
    return (protocol === "http:" || protocol === "https:") && hostname !== "";
  } catch {
    return false;
  }
}

/** Every link in the text, in order, each address once. */
function findLinks(text: string): string[] {
  const links = [...text.matchAll(LINK_PATTERN)].map((match) => trimAddress(match[0]));
  return [...new Set(links.filter(isWebAddress))];
}

function sameAddress(a: string, b: string): boolean {
  const bare = (url: string): string => url.replace(/\/+$/, "");
  return bare(a) === bare(b);
}

/**
 * Discord's preview of the link: the embed for that address, or the only embed when the
 * message has one link (Discord may report a redirect's address). With several links an
 * unmatched embed may belong to another one, so the link gets no preview.
 */
function previewOf(
  url: string,
  linkCount: number,
  embeds: readonly INewsEmbed[],
): INewsEmbed | null {
  const matched = embeds.find((embed) => embed.url !== null && sameAddress(embed.url, url));
  if (matched) return matched;
  return linkCount === 1 ? (embeds[0] ?? null) : null;
}

/**
 * The preview's image. Discord's proxied copy comes first: many sites (Gematsu among them)
 * refuse their images to a page on another site, while Discord's copy always loads.
 */
function previewImageOf(preview: INewsEmbed | null): string | null {
  const asset = preview?.thumbnail ?? preview?.image ?? null;
  return asset?.proxyURL || asset?.url || null;
}

function linkOf(url: string, preview: INewsEmbed | null): INewsLinkPayload {
  const imageUrl = previewImageOf(preview);
  return {
    url,
    title: preview?.title || preview?.author?.name || null,
    site_name: preview?.provider?.name || null,
    description: preview?.description || null,
    image_url: imageUrl && isWebAddress(imageUrl) ? imageUrl : null,
  };
}

const IMAGE_NAME_PATTERN = /\.(png|jpe?g|gif|webp|avif|bmp)$/i;

/** An image by its media type, or by its file name when Discord gave no type. */
function isImage(attachment: INewsAttachment): boolean {
  if (attachment.contentType) return attachment.contentType.startsWith("image/");
  return IMAGE_NAME_PATTERN.test(attachment.name);
}

/**
 * When a Discord address expires: its `ex` parameter, hex unix seconds. An address without
 * a readable one is not a signed address and does not expire (null), so it is never renewed.
 */
function expiresAt(url: string): string | null {
  let seconds = Number.NaN;
  try {
    seconds = Number.parseInt(new URL(url).searchParams.get("ex") ?? "", 16);
  } catch {
    // Not a parseable address: no expiry to read.
  }
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;
}

/** The message's images: the attachments a News Item stores and its News Copy uploads again. */
export function newsImageAttachments(message: INewsMessage): INewsAttachment[] {
  return [...message.attachments.values()].filter(isImage);
}

function imagesOf(message: INewsMessage): INewsImagePayload[] {
  return newsImageAttachments(message)
    .map((image) => ({ url: image.url, expires_at: expiresAt(image.url) }));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Tidies the gaps a removed address leaves: spaces collapsed, lines and ends trimmed. */
function tidy(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The text without the item's link address. A masked link `[label](url)` keeps its label,
 * and `<url>` (a link with its preview suppressed) loses its brackets too. Empty is null.
 */
function commentWithout(text: string, url: string | undefined): string | null {
  let comment = text;
  if (url) {
    const address = escapeRegExp(url);
    comment = comment
      .replace(new RegExp(`\\[([^\\]]*)\\]\\(<?${address}>?\\)`, "g"), "$1")
      .replace(new RegExp(`<${address}>|${address}`, "g"), "");
  }
  return tidy(comment) || null;
}

/**
 * Posted by a member in a place for news: not a bot, a webhook or Discord itself. In a forum
 * thread the opening message shares the thread's ID; it describes the thread, not news.
 */
function isMemberPostIn(message: INewsMessage, places: NewsPlaces): boolean {
  if (!places.has(message.channelId) || message.id === message.channelId) return false;
  return !message.system && message.webhookId === null && !message.author.bot;
}

function authorName(message: INewsMessage): string {
  return message.member?.displayName ?? message.author.globalName ?? message.author.username;
}

/**
 * The News Item a message is, or null when it is not one. `places` maps each channel where
 * news is posted to the News Category its messages take (see {@link NewsPlaces}): live
 * recording passes the News Channel and the News Import its archive, both with no category
 * (null), which the bot picks or staff assign. Pure: a fetched discord.js Message is a valid `message`.
 */
export function newsItemFrom(
  message: INewsMessage,
  places: NewsPlaces,
): INewsItemPayload | null {
  if (!isMemberPostIn(message, places)) return null;
  const links = findLinks(message.cleanContent);
  const url = links[0];
  const images = imagesOf(message);
  if (!url && images.length === 0) return null;
  return {
    message_id: message.id,
    channel_id: message.channelId,
    category_key: places.get(message.channelId) ?? null,
    author_id: message.author.id,
    author_name: authorName(message),
    comment: commentWithout(message.cleanContent, url),
    posted_at: message.createdAt.toISOString(),
    edited_at: message.editedAt?.toISOString() ?? null,
    link: url ? linkOf(url, previewOf(url, links.length, message.embeds)) : null,
    images,
  };
}
