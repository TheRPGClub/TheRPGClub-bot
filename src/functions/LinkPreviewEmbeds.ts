import axios from "axios";
import * as cheerio from "cheerio";
import { AttachmentBuilder } from "discord.js";
import {
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
} from "@discordjs/builders";
import { COLOR_PRIMARY } from "../config/colors.js";
import { logWarn } from "../utilities/LogUtils.js";
import { truncateWithEllipsis } from "../utilities/ValidationUtils.js";
import { buildTitledContainer } from "./ComponentsV2Utils.js";

const URL_PATTERN = /https?:\/\/[^\s<>"]+/;
const FETCH_TIMEOUT_MS = 8000;
const TITLE_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 500;
const PREVIEW_IMAGE_NAME = "link-preview.png";

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
  const title = data.title ? truncateWithEllipsis(data.title, TITLE_MAX_LENGTH) : data.url;
  const bodyParts: string[] = [];
  if (data.description) {
    bodyParts.push(truncateWithEllipsis(data.description, DESCRIPTION_MAX_LENGTH));
  }
  bodyParts.push(data.url);

  const container = buildTitledContainer(title, bodyParts.join("\n\n"), { color: COLOR_PRIMARY });

  const files: AttachmentBuilder[] = [];
  if (data.imageUrl) {
    const attachment = await downloadPreviewImage(data.imageUrl);
    if (attachment) {
      files.push(attachment);
      container.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
          new MediaGalleryItemBuilder().setURL(`attachment://${PREVIEW_IMAGE_NAME}`),
        ),
      );
    }
  }
  return { container, files };
}
