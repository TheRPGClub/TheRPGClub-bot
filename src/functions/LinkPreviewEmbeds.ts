import axios from "axios";
import * as cheerio from "cheerio";
import { AttachmentBuilder } from "discord.js";
import {
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import { COLOR_PRIMARY } from "../config/colors.js";
import { logWarn } from "../utilities/LogUtils.js";
import { safeV2TextContent } from "./ComponentsV2Utils.js";

const URL_PATTERN = /https?:\/\/[^\s<>"]+/;
const FETCH_TIMEOUT_MS = 8000;
const DESCRIPTION_MAX_WORDS = 150;
const MAX_GALLERY_IMAGES = 10;
const REQUEST_HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; TheRPGClubBot/1.0)" };

/**
 * Titles served by anti-bot interstitials instead of the real page. Compared
 * against a normalized (lowercased, ellipsis-stripped) title prefix.
 */
export const INTERSTITIAL_TITLES: readonly string[] = [
  "verifying your browser",
  "just a moment",
  "attention required! | cloudflare",
  "checking your browser",
  "making sure you're not a bot",
  "ddos-guard",
];

/** Backoff schedule used when a fetch returns an interstitial instead of the page. */
export const INTERSTITIAL_RETRY_DELAYS_MS: readonly number[] = [10_000, 30_000, 60_000];

function truncateWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text;
  return `${words.slice(0, maxWords).join(" ")}...`;
}

export interface IOpenGraphData {
  siteName: string;
  homepageUrl: string;
  title: string | undefined;
  description: string | undefined;
  imageUrls: string[];
  url: string;
}

export interface ILinkPreview {
  container: ContainerBuilder;
  files: AttachmentBuilder[];
}

export function extractFirstUrl(content: string): string | undefined {
  return content.match(URL_PATTERN)?.[0];
}

const TITLE_LINE_PATTERN = /^\*\*\[(.+)\]\((\S+)\)\*\*$/;

function buildTitleLine(title: string, url: string): string {
  return `**[${title}](${url})**`;
}

/** Pull the preview title back out of an already-rendered container's text displays. */
export function extractPreviewTitle(textContents: readonly string[]): string | undefined {
  for (const content of textContents) {
    const match = content.trim().match(TITLE_LINE_PATTERN);
    if (match) return match[1];
  }
  return undefined;
}

function normalizeTitle(title: string): string {
  return title
    .replace(/[…]/g, "")
    .replace(/\.+$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function isInterstitialTitle(title: string | undefined): boolean {
  if (!title) return false;
  const normalized = normalizeTitle(title);
  return INTERSTITIAL_TITLES.some((known) => normalized.startsWith(known));
}

/**
 * An interstitial preview is a known bot-check title with nothing else scraped.
 * All three conditions are required so a real post with an odd title survives.
 */
export function isInterstitialPreview(data: IOpenGraphData): boolean {
  return isInterstitialTitle(data.title)
    && !data.description
    && data.imageUrls.length === 0;
}

function resolveImageUrls($: cheerio.CheerioAPI, pageUrl: string): string[] {
  const ogImages = $('meta[property="og:image"]')
    .map((_, el) => $(el).attr("content"))
    .get()
    .filter((src): src is string => Boolean(src));

  const sources = ogImages.length > 0
    ? ogImages
    : $("img")
      .map((_, el) => $(el).attr("src"))
      .get()
      .filter((src): src is string => Boolean(src));

  const resolved: string[] = [];
  for (const src of sources) {
    try {
      resolved.push(new URL(src, pageUrl).toString());
    } catch {
      // skip unresolvable image sources
    }
    if (resolved.length >= MAX_GALLERY_IMAGES) break;
  }
  return [...new Set(resolved)];
}

async function downloadImage(
  imageUrl: string,
  name: string,
): Promise<AttachmentBuilder | undefined> {
  try {
    const response = await axios.get<ArrayBuffer>(imageUrl, {
      timeout: FETCH_TIMEOUT_MS,
      responseType: "arraybuffer",
      headers: REQUEST_HEADERS,
    });
    return new AttachmentBuilder(Buffer.from(response.data), { name });
  } catch (error) {
    logWarn("LinkPreviewEmbeds", `Failed to download image ${imageUrl}: ${error}`);
    return undefined;
  }
}

export async function fetchOpenGraphData(url: string): Promise<IOpenGraphData | undefined> {
  try {
    const response = await axios.get<string>(url, {
      timeout: FETCH_TIMEOUT_MS,
      headers: REQUEST_HEADERS,
    });
    const $ = cheerio.load(response.data);
    const ogTag = (property: string): string | undefined =>
      $(`meta[property="${property}"]`).attr("content") ?? undefined;

    const title = ogTag("og:title") ?? ($("title").text().trim() || undefined);
    const description = ogTag("og:description");
    const imageUrls = resolveImageUrls($, url);
    const homepageUrl = new URL(url).origin;
    const siteName = ogTag("og:site_name") ?? new URL(url).hostname.replace(/^www\./, "");

    if (!title && !description && imageUrls.length === 0) return undefined;
    return { siteName, homepageUrl, title, description, imageUrls, url };
  } catch (error) {
    logWarn("LinkPreviewEmbeds", `Failed to fetch Open Graph data for ${url}: ${error}`);
    return undefined;
  }
}

export async function buildLinkPreviewContainer(data: IOpenGraphData): Promise<ILinkPreview> {
  const container = new ContainerBuilder().setAccentColor(COLOR_PRIMARY);

  const siteLine = `[${data.siteName}](${data.homepageUrl})`;
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(safeV2TextContent(siteLine, 500)),
  );

  if (data.title) {
    const titleLine = buildTitleLine(data.title, data.url);
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(safeV2TextContent(titleLine, 500)),
    );
  }

  if (data.description) {
    const description = truncateWords(data.description, DESCRIPTION_MAX_WORDS);
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(safeV2TextContent(description, 3500)),
    );
  }

  const files: AttachmentBuilder[] = [];
  const galleryItems: MediaGalleryItemBuilder[] = [];
  const downloads = await Promise.all(
    data.imageUrls.map((imageUrl, index) => downloadImage(imageUrl, `link-preview-${index}.png`)),
  );
  for (const attachment of downloads) {
    if (!attachment) continue;
    files.push(attachment);
    galleryItems.push(new MediaGalleryItemBuilder().setURL(`attachment://${attachment.name}`));
  }

  if (galleryItems.length > 0) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(...galleryItems),
    );
  }

  return { container, files };
}
