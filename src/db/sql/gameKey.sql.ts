import type { ISqlEntry } from "./types.js";

const GAME_KEY_COLS = `KEY_ID,
        GAME_TITLE,
        PLATFORM,
        KEY_VALUE,
        DONOR_USER_ID,
        CLAIMED_BY_USER_ID,
        CLAIMED_AT,
        CREATED_AT,
        UPDATED_AT`;

const GAME_KEY_COLS_PG = `key_id,
        game_title,
        platform,
        key_value,
        donor_user_id,
        claimed_by_user_id,
        claimed_at,
        created_at,
        updated_at`;

export const GameKeySql = {
  create: {
    oracle: `INSERT INTO RPG_CLUB_GAME_KEYS (GAME_TITLE, PLATFORM, KEY_VALUE, DONOR_USER_ID)
     VALUES (:title, :platform, :keyValue, :donorUserId)
     RETURNING KEY_ID INTO :id`,
    postgres: `INSERT INTO rpg_club_game_keys (game_title, platform, key_value, donor_user_id)
     VALUES (:title, :platform, :keyValue, :donorUserId)
     RETURNING key_id`,
  } satisfies ISqlEntry,

  getById: {
    oracle: `SELECT ${GAME_KEY_COLS}
       FROM RPG_CLUB_GAME_KEYS
      WHERE KEY_ID = :id`,
    postgres: `SELECT ${GAME_KEY_COLS_PG}
       FROM rpg_club_game_keys
      WHERE key_id = :id`,
  } satisfies ISqlEntry,

  countAvailable: {
    oracle: `SELECT COUNT(*) AS TOTAL
       FROM RPG_CLUB_GAME_KEYS
      WHERE CLAIMED_BY_USER_ID IS NULL`,
    postgres: `SELECT COUNT(*) AS total
       FROM rpg_club_game_keys
      WHERE claimed_by_user_id IS NULL`,
  } satisfies ISqlEntry,

  listAvailable: {
    oracle: `SELECT ${GAME_KEY_COLS}
       FROM RPG_CLUB_GAME_KEYS
      WHERE CLAIMED_BY_USER_ID IS NULL
      ORDER BY UPPER(GAME_TITLE), KEY_ID
      OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
    postgres: `SELECT ${GAME_KEY_COLS_PG}
       FROM rpg_club_game_keys
      WHERE claimed_by_user_id IS NULL
      ORDER BY UPPER(game_title), key_id
      LIMIT :limit OFFSET :offset`,
  } satisfies ISqlEntry,

  listByDonor: {
    oracle: `SELECT ${GAME_KEY_COLS}
       FROM RPG_CLUB_GAME_KEYS
      WHERE DONOR_USER_ID = :userId
      ORDER BY CREATED_AT DESC, KEY_ID DESC`,
    postgres: `SELECT ${GAME_KEY_COLS_PG}
       FROM rpg_club_game_keys
      WHERE donor_user_id = :userId
      ORDER BY created_at DESC, key_id DESC`,
  } satisfies ISqlEntry,

  claim: {
    oracle: `UPDATE RPG_CLUB_GAME_KEYS
        SET CLAIMED_BY_USER_ID = :userId,
            CLAIMED_AT = SYSTIMESTAMP
      WHERE KEY_ID = :keyId
        AND CLAIMED_BY_USER_ID IS NULL`,
    postgres: `UPDATE rpg_club_game_keys
        SET claimed_by_user_id = :userId,
            claimed_at = NOW()
      WHERE key_id = :keyId
        AND claimed_by_user_id IS NULL`,
  } satisfies ISqlEntry,

  revoke: {
    oracle: `DELETE FROM RPG_CLUB_GAME_KEYS WHERE KEY_ID = :keyId`,
    postgres: `DELETE FROM rpg_club_game_keys WHERE key_id = :keyId`,
  } satisfies ISqlEntry,
};
