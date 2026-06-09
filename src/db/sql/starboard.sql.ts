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
    postgres: `SELECT message_id,
              channel_id,
              starboard_message_id,
              author_id,
              star_count,
              created_at
         FROM rpg_club_starboard
        WHERE message_id = :messageId`,
  } satisfies SqlEntry,

  insert: {
    oracle: `INSERT INTO RPG_CLUB_STARBOARD
        (MESSAGE_ID, CHANNEL_ID, STARBOARD_MESSAGE_ID, AUTHOR_ID, STAR_COUNT)
       VALUES (:messageId, :channelId, :starboardMessageId, :authorId, :starCount)`,
    postgres: `INSERT INTO rpg_club_starboard
        (message_id, channel_id, starboard_message_id, author_id, star_count)
       VALUES (:messageId, :channelId, :starboardMessageId, :authorId, :starCount)`,
  } satisfies SqlEntry,
};
