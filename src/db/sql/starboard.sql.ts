import type { SqlEntry } from "./types.js";

export const StarboardSql = {
  getByMessageId: {
    oracle: `SELECT MESSAGE_ID,
              CHANNEL_ID,
              STARBOARD_MESSAGE_ID,
              AUTHOR_ID,
              STAR_COUNT,
              CREATED_AT
         FROM RPG_CLUB_STARBOARD
        WHERE MESSAGE_ID = :messageId`,
    postgres: ``,
  } satisfies SqlEntry,

  insert: {
    oracle: `INSERT INTO RPG_CLUB_STARBOARD
        (MESSAGE_ID, CHANNEL_ID, STARBOARD_MESSAGE_ID, AUTHOR_ID, STAR_COUNT)
       VALUES (:messageId, :channelId, :starboardMessageId, :authorId, :starCount)`,
    postgres: ``,
  } satisfies SqlEntry,
};
