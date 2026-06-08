import oracledb from "oracledb";
import { oraQuery, oraMutate } from "../db/SqlManager.js";

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

const GAME_KEY_COLS = `KEY_ID,
        GAME_TITLE,
        PLATFORM,
        KEY_VALUE,
        DONOR_USER_ID,
        CLAIMED_BY_USER_ID,
        CLAIMED_AT,
        CREATED_AT,
        UPDATED_AT`;

export async function createGameKey(
  title: string,
  platform: string,
  keyValue: string,
  donorUserId: string,
): Promise<IGameKey> {
  const result = await oraMutate(
    `INSERT INTO RPG_CLUB_GAME_KEYS (GAME_TITLE, PLATFORM, KEY_VALUE, DONOR_USER_ID)
     VALUES (:title, :platform, :keyValue, :donorUserId)
     RETURNING KEY_ID INTO :id`,
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
  const rows = await oraQuery(
    `SELECT ${GAME_KEY_COLS}
       FROM RPG_CLUB_GAME_KEYS
      WHERE KEY_ID = :id`,
    { id: keyId },
    mapGameKeyRow,
  );
  return rows[0] ?? null;
}

export async function countAvailableGameKeys(): Promise<number> {
  const rows = await oraQuery(
    `SELECT COUNT(*) AS TOTAL
       FROM RPG_CLUB_GAME_KEYS
      WHERE CLAIMED_BY_USER_ID IS NULL`,
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
  return oraQuery(
    `SELECT ${GAME_KEY_COLS}
       FROM RPG_CLUB_GAME_KEYS
      WHERE CLAIMED_BY_USER_ID IS NULL
      ORDER BY UPPER(GAME_TITLE), KEY_ID
      OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
    { offset: safeOffset, limit: safeLimit },
    mapGameKeyRow,
  );
}

export async function listKeysByDonor(userId: string): Promise<IGameKey[]> {
  return oraQuery(
    `SELECT ${GAME_KEY_COLS}
       FROM RPG_CLUB_GAME_KEYS
      WHERE DONOR_USER_ID = :userId
      ORDER BY CREATED_AT DESC, KEY_ID DESC`,
    { userId },
    mapGameKeyRow,
  );
}

export async function claimGameKey(
  keyId: number,
  userId: string,
): Promise<boolean> {
  const result = await oraMutate(
    `UPDATE RPG_CLUB_GAME_KEYS
        SET CLAIMED_BY_USER_ID = :userId,
            CLAIMED_AT = SYSTIMESTAMP
      WHERE KEY_ID = :keyId
        AND CLAIMED_BY_USER_ID IS NULL`,
    { keyId, userId },
  );
  return (result.rowsAffected ?? 0) > 0;
}

export async function revokeGameKey(keyId: number): Promise<boolean> {
  const result = await oraMutate(
    `DELETE FROM RPG_CLUB_GAME_KEYS WHERE KEY_ID = :keyId`,
    { keyId },
  );
  return (result.rowsAffected ?? 0) > 0;
}
