import oracledb from "oracledb";
import { dbQuery, dbMutate, oraMutate } from "../db/SqlManager.js";
import { getDialect } from "../db/dialect.js";
import { getSql } from "../db/SqlManager.js";
import { GameKeySql } from "../db/sql/index.js";

const dialect = getDialect();

export interface IGameKey {
  keyId: number;
  gameTitle: string;
  platform: string;
  keyValue: string;
  donorUserId: string;
  claimedByUserId: string | null;
  claimedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toDate(value: Date | string | null): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

type GameKeyRow = {
  KEY_ID: number;
  GAME_TITLE: string;
  PLATFORM: string;
  KEY_VALUE: string;
  DONOR_USER_ID: string;
  CLAIMED_BY_USER_ID: string | null;
  CLAIMED_AT: Date | string | null;
  CREATED_AT: Date | string;
  UPDATED_AT: Date | string;
};

function mapGameKeyRow(row: GameKeyRow): IGameKey {
  return {
    keyId: Number(row.KEY_ID),
    gameTitle: row.GAME_TITLE,
    platform: row.PLATFORM,
    keyValue: row.KEY_VALUE,
    donorUserId: row.DONOR_USER_ID,
    claimedByUserId: row.CLAIMED_BY_USER_ID ?? null,
    claimedAt: toDate(row.CLAIMED_AT),
    createdAt: toDate(row.CREATED_AT) ?? new Date(),
    updatedAt: toDate(row.UPDATED_AT) ?? new Date(),
  };
}

export async function createGameKey(
  title: string,
  platform: string,
  keyValue: string,
  donorUserId: string,
): Promise<IGameKey> {
  const result = await oraMutate(
    getSql(GameKeySql.create, dialect),
    {
      title,
      platform,
      keyValue,
      donorUserId,
      id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
    },
  );
  const id = Number((result.outBinds as any)?.id?.[0] ?? 0);
  if (!id) {
    throw new Error("Failed to create game key.");
  }
  const key = await getGameKeyById(id);
  if (!key) {
    throw new Error("Failed to load game key after creation.");
  }
  return key;
}

export async function getGameKeyById(keyId: number): Promise<IGameKey | null> {
  const rows = await dbQuery(
    GameKeySql.getById,
    { id: keyId },
    mapGameKeyRow,
  );
  return rows[0] ?? null;
}

export async function countAvailableGameKeys(): Promise<number> {
  const rows = await dbQuery(
    GameKeySql.countAvailable,
    {},
    (row: { TOTAL: number | null }) => Number(row.TOTAL ?? 0),
  );
  return rows[0] ?? 0;
}

export async function listAvailableGameKeys(
  offset: number,
  limit: number,
): Promise<IGameKey[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  const safeOffset = Math.max(offset, 0);
  return dbQuery(
    GameKeySql.listAvailable,
    { offset: safeOffset, limit: safeLimit },
    mapGameKeyRow,
  );
}

export async function listKeysByDonor(userId: string): Promise<IGameKey[]> {
  return dbQuery(
    GameKeySql.listByDonor,
    { userId },
    mapGameKeyRow,
  );
}

export async function claimGameKey(
  keyId: number,
  userId: string,
): Promise<boolean> {
  const count = await dbMutate(
    GameKeySql.claim,
    { keyId, userId },
  );
  return count > 0;
}

export async function revokeGameKey(keyId: number): Promise<boolean> {
  const count = await dbMutate(
    GameKeySql.revoke,
    { keyId },
  );
  return count > 0;
}
