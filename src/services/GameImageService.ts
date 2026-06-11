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
