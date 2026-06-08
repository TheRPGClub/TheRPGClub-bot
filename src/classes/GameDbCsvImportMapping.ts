import { oraQuery, oraMutate } from "../db/SqlManager.js";
import { getDialect } from "../db/dialect.js";
import { getSql } from "../db/SqlManager.js";
import { GameDbCsvImportMappingSql } from "../db/sql/index.js";

const dialect = getDialect();

export type GameDbCsvTitleMapStatus = "MAPPED" | "SKIPPED";

export interface IGameDbCsvTitleMap {
  mapId: number;
  titleRaw: string;
  titleNorm: string;
  gameDbGameId: number | null;
  status: GameDbCsvTitleMapStatus;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapRow(row: {
  MAP_ID: number;
  TITLE_RAW: string;
  TITLE_NORM: string;
  GAMEDB_GAME_ID: number | null;
  STATUS: GameDbCsvTitleMapStatus;
  CREATED_BY: string | null;
  CREATED_AT: Date | string;
  UPDATED_AT: Date | string;
}): IGameDbCsvTitleMap {
  return {
    mapId: Number(row.MAP_ID),
    titleRaw: row.TITLE_RAW,
    titleNorm: row.TITLE_NORM,
    gameDbGameId: row.GAMEDB_GAME_ID == null ? null : Number(row.GAMEDB_GAME_ID),
    status: row.STATUS,
    createdBy: row.CREATED_BY ?? null,
    createdAt: toDate(row.CREATED_AT),
    updatedAt: toDate(row.UPDATED_AT),
  };
}

export async function getGameDbCsvTitleMapByNorm(
  titleNorm: string,
): Promise<IGameDbCsvTitleMap | null> {
  const rows = await oraQuery(
    getSql(GameDbCsvImportMappingSql.getByTitleNorm, dialect),
    { titleNorm },
    mapRow,
  );
  return rows[0] ?? null;
}

export async function upsertGameDbCsvTitleMap(params: {
  titleRaw: string;
  titleNorm: string;
  gameDbGameId: number | null;
  status: GameDbCsvTitleMapStatus;
  createdBy: string | null;
}): Promise<void> {
  await oraMutate(
    getSql(GameDbCsvImportMappingSql.upsert, dialect),
    {
      titleRaw: params.titleRaw,
      titleNorm: params.titleNorm,
      gameDbGameId: params.gameDbGameId,
      status: params.status,
      createdBy: params.createdBy,
    },
  );
}
