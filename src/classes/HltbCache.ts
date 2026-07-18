import { apiGet, apiPost } from "../services/RpgClubApiClient.js";

export type HltbCacheEntry = {
  gameId: number;
  name: string | null;
  url: string | null;
  imageUrl: string | null;
  main: string | null;
  mainSides: string | null;
  completionist: string | null;
  singlePlayer: string | null;
  coOp: string | null;
  vs: string | null;
  sourceQuery: string | null;
  scrapedAt: Date | null;
  updatedAt: Date | null;
};

type HltbProfileApiData = {
  name: string | null;
  url: string | null;
  image_url: string | null;
  main: string | null;
  main_sides: string | null;
  completionist: string | null;
  single_player: string | null;
  co_op: string | null;
  vs: string | null;
  source_query: string | null;
  scraped_at: string | null;
  updated_at: string | null;
};

function mapEntry(data: HltbProfileApiData, gameId: number): HltbCacheEntry {
  const toDate = (value: string | null): Date | null =>
    value ? new Date(value) : null;
  return {
    gameId,
    name: data.name ?? null,
    url: data.url ?? null,
    imageUrl: data.image_url ?? null,
    main: data.main ?? null,
    mainSides: data.main_sides ?? null,
    completionist: data.completionist ?? null,
    singlePlayer: data.single_player ?? null,
    coOp: data.co_op ?? null,
    vs: data.vs ?? null,
    sourceQuery: data.source_query ?? null,
    scrapedAt: toDate(data.scraped_at),
    updatedAt: toDate(data.updated_at),
  };
}

export async function getHltbCacheByGameId(
  gameId: number,
): Promise<HltbCacheEntry | null> {
  const result = await apiGet<{ data: { hltb: HltbProfileApiData | null } }>(
    `/api/v1/games/${gameId}/profile`,
  );
  const hltb = result?.data?.hltb;
  return hltb ? mapEntry(hltb, gameId) : null;
}

export async function upsertHltbCache(
  gameId: number,
  payload: {
    name?: string | null;
    url?: string | null;
    imageUrl?: string | null;
    main?: string | null;
    mainSides?: string | null;
    completionist?: string | null;
    singlePlayer?: string | null;
    coOp?: string | null;
    vs?: string | null;
    sourceQuery?: string | null;
  },
): Promise<void> {
  await apiPost(`/api/v1/games/${gameId}/hltb`, {
    data: {
      name: payload.name ?? null,
      url: payload.url ?? null,
      image_url: payload.imageUrl ?? null,
      main: payload.main ?? null,
      main_sides: payload.mainSides ?? null,
      completionist: payload.completionist ?? null,
      single_player: payload.singlePlayer ?? null,
      co_op: payload.coOp ?? null,
      vs: payload.vs ?? null,
      source_query: payload.sourceQuery ?? null,
    },
  });
}
