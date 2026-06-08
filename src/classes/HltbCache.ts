import { oraQuery, oraMutate } from "../db/SqlManager.js";
import { getDialect } from "../db/dialect.js";
import { getSql } from "../db/SqlManager.js";
import { HltbCacheSql } from "../db/sql/index.js";

const dialect = getDialect();

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

function mapRow(row: {
  GAMEDB_GAME_ID: number;
  HLTB_NAME: string | null;
  HLTB_URL: string | null;
  HLTB_IMAGE_URL: string | null;
  MAIN: string | null;
  MAIN_SIDES: string | null;
  COMPLETIONIST: string | null;
  SINGLE_PLAYER: string | null;
  CO_OP: string | null;
  VS: string | null;
  SOURCE_QUERY: string | null;
  SCRAPED_AT: Date | string | null;
  UPDATED_AT: Date | string | null;
}): HltbCacheEntry {
  const toDate = (value: Date | string | null): Date | null => {
    if (!value) return null;
    return value instanceof Date ? value : new Date(value);
  };
  return {
    gameId: Number(row.GAMEDB_GAME_ID),
    name: row.HLTB_NAME ?? null,
    url: row.HLTB_URL ?? null,
    imageUrl: row.HLTB_IMAGE_URL ?? null,
    main: row.MAIN ?? null,
    mainSides: row.MAIN_SIDES ?? null,
    completionist: row.COMPLETIONIST ?? null,
    singlePlayer: row.SINGLE_PLAYER ?? null,
    coOp: row.CO_OP ?? null,
    vs: row.VS ?? null,
    sourceQuery: row.SOURCE_QUERY ?? null,
    scrapedAt: toDate(row.SCRAPED_AT ?? null),
    updatedAt: toDate(row.UPDATED_AT ?? null),
  };
}

export async function getHltbCacheByGameId(
  gameId: number,
): Promise<HltbCacheEntry | null> {
  const rows = await oraQuery(
    getSql(HltbCacheSql.getByGameId, dialect),
    { gameId },
    mapRow,
  );
  return rows[0] ?? null;
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
  await oraMutate(
    getSql(HltbCacheSql.upsertCache, dialect),
    {
      gameId,
      name: payload.name ?? null,
      url: payload.url ?? null,
      imageUrl: payload.imageUrl ?? null,
      main: payload.main ?? null,
      mainSides: payload.mainSides ?? null,
      completionist: payload.completionist ?? null,
      singlePlayer: payload.singlePlayer ?? null,
      coOp: payload.coOp ?? null,
      vs: payload.vs ?? null,
      sourceQuery: payload.sourceQuery ?? null,
    },
  );
}
