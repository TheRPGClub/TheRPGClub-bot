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

async function fetchPrimaryCover(gameId: number): Promise<ApiGameImage | null> {
  const result = await apiGet<{ data: ApiGameImage[] }>(`/api/v1/games/${gameId}/images`);
  return selectPrimaryCover(result?.data ?? []);
}

/** The cover's URL only, for a thumbnail Discord fetches itself. */
export async function fetchGameCoverUrl(gameId: number): Promise<string | null> {
  try {
    return (await fetchPrimaryCover(gameId))?.url ?? null;
  } catch (error) {
    logError(`GameImageService.fetchGameCoverUrl(${gameId})`, error);
    return null;
  }
}

/** Cover URLs by game id; games with no cover are left out. */
export async function fetchGameCoverUrls(gameIds: number[]): Promise<Map<number, string>> {
  const urls = await Promise.all(gameIds.map((gameId) => fetchGameCoverUrl(gameId)));
  const byGame = new Map<number, string>();
  gameIds.forEach((gameId, index) => {
    const url = urls[index];
    if (url) byGame.set(gameId, url);
  });
  return byGame;
}

export async function fetchGameCoverBuffer(
  gameId: number,
): Promise<GameCoverResult | null> {
  try {
    const cover = await fetchPrimaryCover(gameId);
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
