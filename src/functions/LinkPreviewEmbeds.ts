import axios from "axios";
import * as cheerio from "cheerio";
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

export interface IOpenGraphData {
  title: string | undefined;
  description: string | undefined;
  imageUrl: string | undefined;
  url: string;
}

export function extractFirstUrl(content: string): string | undefined {
  return content.match(URL_PATTERN)?.[0];
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

export function buildLinkPreviewContainer(data: IOpenGraphData): ContainerBuilder {
  const title = data.title ? truncateWithEllipsis(data.title, TITLE_MAX_LENGTH) : data.url;
  const bodyParts: string[] = [];
  if (data.description) {
    bodyParts.push(truncateWithEllipsis(data.description, DESCRIPTION_MAX_LENGTH));
  }
  bodyParts.push(data.url);

  const container = buildTitledContainer(title, bodyParts.join("\n\n"), { color: COLOR_PRIMARY });
  if (data.imageUrl) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(data.imageUrl)),
    );
  }
  return container;
}
