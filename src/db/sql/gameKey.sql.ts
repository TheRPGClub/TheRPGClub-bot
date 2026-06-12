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
  getById: {
    postgres: `SELECT ${GAME_KEY_COLS_PG}
       FROM rpg_club_game_keys
      WHERE key_id = :id`,
  } satisfies ISqlEntry,

  revoke: {
    postgres: `DELETE FROM rpg_club_game_keys WHERE key_id = :keyId`,
  } satisfies ISqlEntry,
};
