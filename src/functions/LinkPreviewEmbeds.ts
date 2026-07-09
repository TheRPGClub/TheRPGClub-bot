import axios from "axios";
import * as cheerio from "cheerio";
import { AttachmentBuilder } from "discord.js";
import {
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "@discordjs/builders";
import { COLOR_PRIMARY } from "../config/colors.js";
import { logWarn } from "../utilities/LogUtils.js";
import { truncateWithEllipsis } from "../utilities/ValidationUtils.js";
import { safeV2TextContent } from "./ComponentsV2Utils.js";

const URL_PATTERN = /https?:\/\/[^\s<>"]+/;
const FETCH_TIMEOUT_MS = 8000;
const TITLE_MAX_LENGTH = 200;
const DESCRIPTION_MAX_WORDS = 150;
const PREVIEW_IMAGE_NAME = "link-preview.png";

function truncateWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text;
  return `${words.slice(0, maxWords).join(" ")}...`;
}

export interface IOpenGraphData {
  title: string | undefined;
  description: string | undefined;
  imageUrl: string | undefined;
  url: string;
}

export interface ILinkPreview {
  container: ContainerBuilder;
  files: AttachmentBuilder[];
}

export function extractFirstUrl(content: string): string | undefined {
  return content.match(URL_PATTERN)?.[0];
}

async function downloadPreviewImage(imageUrl: string): Promise<AttachmentBuilder | undefined> {
  try {
    const response = await axios.get<ArrayBuffer>(imageUrl, {
      timeout: FETCH_TIMEOUT_MS,
      responseType: "arraybuffer",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TheRPGClubBot/1.0)" },
    });
    return new AttachmentBuilder(Buffer.from(response.data), { name: PREVIEW_IMAGE_NAME });
  } catch (error) {
    logWarn("LinkPreviewEmbeds", `Failed to download preview image ${imageUrl}: ${error}`);
    return undefined;
  }
}

export async function fetchOpenGraphData(url: string): Promise<IOpenGraphData | undefined> {
  try {
    const response = await axios.get<string>(url, {
      timeout: FETCH_TIMEOUT_MS,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TheRPGClubBot/1.0)" },
    });
    const $ = cheerio.load(response.data);
    const ogTag = (property: string): string | undefined =>
      $(`meta[property="${property}"]`).attr("content") ?? undefined;

    const title = ogTag("og:title") ?? ($("title").text().trim() || undefined);
    const description = ogTag("og:description");
    const imageUrl = ogTag("og:image");

    if (!title && !description && !imageUrl) return undefined;
    return { title, description, imageUrl, url };
  } catch (error) {
    logWarn("LinkPreviewEmbeds", `Failed to fetch Open Graph data for ${url}: ${error}`);
    return undefined;
  }
}

export async function buildLinkPreviewContainer(data: IOpenGraphData): Promise<ILinkPreview> {
  const title = data.title ? truncateWithEllipsis(data.title, TITLE_MAX_LENGTH) : undefined;
  const bodyParts: string[] = [];
  if (title) bodyParts.push(`**${title}**`);
  if (data.description) bodyParts.push(truncateWords(data.description, DESCRIPTION_MAX_WORDS));

  const container = new ContainerBuilder()
    .setAccentColor(COLOR_PRIMARY)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(safeV2TextContent(data.url, 500)),
    );

  const files: AttachmentBuilder[] = [];
  const bodyText = new TextDisplayBuilder().setContent(
    safeV2TextContent(bodyParts.join("\n"), 3500),
  );

  let thumbnailUrl: string | undefined;
  if (data.imageUrl) {
    const attachment = await downloadPreviewImage(data.imageUrl);
    if (attachment) {
      files.push(attachment);
      thumbnailUrl = `attachment://${PREVIEW_IMAGE_NAME}`;
    }
  }

  if (thumbnailUrl) {
    const section = new SectionBuilder().addTextDisplayComponents(bodyText);
    section.setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnailUrl));
    container.addSectionComponents(section);
  } else {
    container.addTextDisplayComponents(bodyText);
  }

  return { container, files };
}
