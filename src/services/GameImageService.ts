import axios from "axios";
import { apiGet } from "./RpgClubApiClient.js";
import { logError } from "../utilities/LogUtils.js";

export type ApiGameImage = {
  image_id: number;
  game_id: number;
  kind: string;
  object_key: string;
  is_primary: boolean;
  position: number;
  url: string;
};

export type GameCoverResult = {
  buffer: Buffer;
  url: string;
};

function selectPrimaryCover(images: ApiGameImage[]): ApiGameImage | null {
  const covers = images.filter((img) => img.kind === "cover");
  return covers.find((img) => img.is_primary) ?? covers[0] ?? null;
}

export async function fetchGameCoverBuffer(
  gameId: number,
): Promise<GameCoverResult | null> {
  try {
    const result = await apiGet<{ data: ApiGameImage[] }>(
      `/api/v1/games/${gameId}/images`,
    );
    const cover = selectPrimaryCover(result?.data ?? []);
    if (!cover) {
      return null;
    }
    const response = await axios.get<ArrayBuffer>(cover.url, {
      responseType: "arraybuffer",
    });
    return { buffer: Buffer.from(response.data), url: cover.url };
  } catch (error) {
    logError(`GameImageService.fetchGameCoverBuffer(${gameId})`, error);
    return null;
  }
}

/**
 * How long an image download may take. Bot jobs run one after another, so a download that
 * never answers would hold up every later job.
 */
export const IMAGE_FETCH_TIMEOUT_MS = 10_000;

/**
 * The image at `url` (a game's `cover_url`, a member's avatar), or null when it can't be
 * read in time (logged).
 */
export async function fetchImageBuffer(
  url: string,
  timeoutMs = IMAGE_FETCH_TIMEOUT_MS,
): Promise<Buffer | null> {
  try {
    const response = await axios.get<ArrayBuffer>(url, {
      responseType: "arraybuffer",
      timeout: timeoutMs,
    });
    return Buffer.from(response.data);
  } catch (error) {
    logError(`GameImageService.fetchImageBuffer(${url})`, error);
    return null;
  }
}
