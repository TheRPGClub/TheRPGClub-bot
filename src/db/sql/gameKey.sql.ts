import type { SqlEntry } from "./types.js";

const GAME_KEY_COLS = `KEY_ID,
        GAME_TITLE,
        PLATFORM,
        KEY_VALUE,
        DONOR_USER_ID,
        CLAIMED_BY_USER_ID,
        CLAIMED_AT,
        CREATED_AT,
        UPDATED_AT`;

export const GameKeySql = {
  create: {
    oracle: `INSERT INTO RPG_CLUB_GAME_KEYS (GAME_TITLE, PLATFORM, KEY_VALUE, DONOR_USER_ID)
     VALUES (:title, :platform, :keyValue, :donorUserId)
     RETURNING KEY_ID INTO :id`,
    postgres: ``,
  } satisfies SqlEntry,

  getById: {
    oracle: `SELECT ${GAME_KEY_COLS}
       FROM RPG_CLUB_GAME_KEYS
      WHERE KEY_ID = :id`,
    postgres: ``,
  } satisfies SqlEntry,

  countAvailable: {
    oracle: `SELECT COUNT(*) AS TOTAL
       FROM RPG_CLUB_GAME_KEYS
      WHERE CLAIMED_BY_USER_ID IS NULL`,
    postgres: ``,
  } satisfies SqlEntry,

  listAvailable: {
    oracle: `SELECT ${GAME_KEY_COLS}
       FROM RPG_CLUB_GAME_KEYS
      WHERE CLAIMED_BY_USER_ID IS NULL
      ORDER BY UPPER(GAME_TITLE), KEY_ID
      OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
    postgres: ``,
  } satisfies SqlEntry,

  listByDonor: {
    oracle: `SELECT ${GAME_KEY_COLS}
       FROM RPG_CLUB_GAME_KEYS
      WHERE DONOR_USER_ID = :userId
      ORDER BY CREATED_AT DESC, KEY_ID DESC`,
    postgres: ``,
  } satisfies SqlEntry,

  claim: {
    oracle: `UPDATE RPG_CLUB_GAME_KEYS
        SET CLAIMED_BY_USER_ID = :userId,
            CLAIMED_AT = SYSTIMESTAMP
      WHERE KEY_ID = :keyId
        AND CLAIMED_BY_USER_ID IS NULL`,
    postgres: ``,
  } satisfies SqlEntry,

  revoke: {
    oracle: `DELETE FROM RPG_CLUB_GAME_KEYS WHERE KEY_ID = :keyId`,
    postgres: ``,
  } satisfies SqlEntry,
};
