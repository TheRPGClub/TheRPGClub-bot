import type { ISqlEntry } from "./types.js";

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
    postgres: `INSERT INTO rpg_club_game_keys (game_title, platform, key_value, donor_user_id)
     VALUES (:title, :platform, :keyValue, :donorUserId)
     RETURNING key_id`,
  } satisfies ISqlEntry,

  getById: {
    postgres: `SELECT ${GAME_KEY_COLS_PG}
       FROM rpg_club_game_keys
      WHERE key_id = :id`,
  } satisfies ISqlEntry,

  countAvailable: {
    postgres: `SELECT COUNT(*) AS total
       FROM rpg_club_game_keys
      WHERE claimed_by_user_id IS NULL`,
  } satisfies ISqlEntry,

  listAvailable: {
    postgres: `SELECT ${GAME_KEY_COLS_PG}
       FROM rpg_club_game_keys
      WHERE claimed_by_user_id IS NULL
      ORDER BY UPPER(game_title), key_id
      LIMIT :limit OFFSET :offset`,
  } satisfies ISqlEntry,

  listByDonor: {
    postgres: `SELECT ${GAME_KEY_COLS_PG}
       FROM rpg_club_game_keys
      WHERE donor_user_id = :userId
      ORDER BY created_at DESC, key_id DESC`,
  } satisfies ISqlEntry,

  claim: {
    postgres: `UPDATE rpg_club_game_keys
        SET claimed_by_user_id = :userId,
            claimed_at = NOW()
      WHERE key_id = :keyId
        AND claimed_by_user_id IS NULL`,
  } satisfies ISqlEntry,

  revoke: {
    postgres: `DELETE FROM rpg_club_game_keys WHERE key_id = :keyId`,
  } satisfies ISqlEntry,
};
