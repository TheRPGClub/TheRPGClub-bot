import type { ISqlEntry } from "./types.js";

export const StarboardSql = {
  getByMessageId: {
    postgres: `SELECT message_id,
              channel_id,
              starboard_message_id,
              author_id,
              star_count,
              created_at
         FROM rpg_club_starboard
        WHERE message_id = :messageId`,
  } satisfies ISqlEntry,

  insert: {
    postgres: `INSERT INTO rpg_club_starboard
        (message_id, channel_id, starboard_message_id, author_id, star_count)
       VALUES (:messageId, :channelId, :starboardMessageId, :authorId, :starCount)`,
  } satisfies ISqlEntry,
};
