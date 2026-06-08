import type { SqlEntry } from "./types.js";

export const RssFeedSql = {
  listFeeds: {
    oracle: `SELECT FEED_ID,
            FEED_NAME,
            FEED_URL,
            CHANNEL_ID,
            INCLUDE_KEYWORDS,
            EXCLUDE_KEYWORDS
       FROM RPG_CLUB_RSS_FEEDS
      ORDER BY FEED_ID`,
    postgres: ``,
  } satisfies SqlEntry,

  addFeed: {
    oracle: `INSERT INTO RPG_CLUB_RSS_FEEDS (
       FEED_NAME,
       FEED_URL,
       CHANNEL_ID,
       INCLUDE_KEYWORDS,
       EXCLUDE_KEYWORDS
     ) VALUES (
       :feedName,
       :feedUrl,
       :channelId,
       :includes,
       :excludes
     )
     RETURNING FEED_ID INTO :id`,
    postgres: ``,
  } satisfies SqlEntry,

  removeFeed: {
    oracle: `DELETE FROM RPG_CLUB_RSS_FEEDS WHERE FEED_ID = :id`,
    postgres: ``,
  } satisfies SqlEntry,

  updateFeed: (sets: string[]) =>
    ({
      oracle: `UPDATE RPG_CLUB_RSS_FEEDS
        SET ${sets.join(", ")}
      WHERE FEED_ID = :feedId`,
      postgres: ``,
    }) satisfies SqlEntry,

  markItemsSeen: {
    oracle: `MERGE INTO RPG_CLUB_RSS_FEED_ITEMS t
    USING (
      SELECT :feedId AS feed_id,
             :itemIdHash AS item_id_hash,
             :itemGuid AS item_guid,
             :itemLink AS item_link,
             :publishedAt AS published_at
        FROM dual
    ) s
       ON (t.FEED_ID = s.feed_id AND t.ITEM_ID_HASH = s.item_id_hash)
     WHEN NOT MATCHED THEN
       INSERT (FEED_ID, ITEM_ID_HASH, ITEM_GUID, ITEM_LINK, PUBLISHED_AT, FIRST_SEEN_AT)
       VALUES (s.feed_id, s.item_id_hash, s.item_guid, s.item_link, s.published_at, SYSTIMESTAMP)`,
    postgres: ``,
  } satisfies SqlEntry,

  isItemSeen: {
    oracle: `SELECT 1 AS FOUND
       FROM RPG_CLUB_RSS_FEED_ITEMS
      WHERE FEED_ID = :feedId
        AND ITEM_ID_HASH = :hash`,
    postgres: ``,
  } satisfies SqlEntry,

  getSeenItemHashes: (bindPlaceholders: string) =>
    ({
      oracle: `SELECT ITEM_ID_HASH
           FROM RPG_CLUB_RSS_FEED_ITEMS
          WHERE FEED_ID = :feedId
            AND ITEM_ID_HASH IN (${bindPlaceholders})`,
      postgres: ``,
    }) satisfies SqlEntry,
};
