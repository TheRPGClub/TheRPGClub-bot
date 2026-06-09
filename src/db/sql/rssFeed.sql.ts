import type { ISqlEntry } from "./types.js";

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
    postgres: `SELECT feed_id,
            feed_name,
            feed_url,
            channel_id,
            include_keywords,
            exclude_keywords
       FROM rpg_club_rss_feeds
      ORDER BY feed_id`,
  } satisfies ISqlEntry,

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
    postgres: `INSERT INTO rpg_club_rss_feeds (
       feed_name,
       feed_url,
       channel_id,
       include_keywords,
       exclude_keywords
     ) VALUES (
       :feedName,
       :feedUrl,
       :channelId,
       :includes,
       :excludes
     )
     RETURNING feed_id`,
  } satisfies ISqlEntry,

  removeFeed: {
    oracle: `DELETE FROM RPG_CLUB_RSS_FEEDS WHERE FEED_ID = :id`,
    postgres: `DELETE FROM rpg_club_rss_feeds WHERE feed_id = :id`,
  } satisfies ISqlEntry,

  // Caller must pass lowercase column=value expressions for Postgres (e.g. "feed_name = :feedName")
  updateFeed: (sets: string[]) =>
    ({
      oracle: `UPDATE RPG_CLUB_RSS_FEEDS
        SET ${sets.join(", ")}
      WHERE FEED_ID = :feedId`,
      postgres: `UPDATE rpg_club_rss_feeds
        SET ${sets.join(", ")}
      WHERE feed_id = :feedId`,
    }) satisfies ISqlEntry,

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
    postgres: `INSERT INTO rpg_club_rss_feed_items
       (feed_id, item_id_hash, item_guid, item_link, published_at, first_seen_at)
       VALUES (:feedId, :itemIdHash, :itemGuid, :itemLink, :publishedAt, NOW())
       ON CONFLICT (feed_id, item_id_hash) DO NOTHING`,
  } satisfies ISqlEntry,

  isItemSeen: {
    oracle: `SELECT 1 AS FOUND
       FROM RPG_CLUB_RSS_FEED_ITEMS
      WHERE FEED_ID = :feedId
        AND ITEM_ID_HASH = :hash`,
    postgres: `SELECT 1 AS found
       FROM rpg_club_rss_feed_items
      WHERE feed_id = :feedId
        AND item_id_hash = :hash`,
  } satisfies ISqlEntry,

  getSeenItemHashes: (bindPlaceholders: string) =>
    ({
      oracle: `SELECT ITEM_ID_HASH
           FROM RPG_CLUB_RSS_FEED_ITEMS
          WHERE FEED_ID = :feedId
            AND ITEM_ID_HASH IN (${bindPlaceholders})`,
      postgres: `SELECT item_id_hash
           FROM rpg_club_rss_feed_items
          WHERE feed_id = :feedId
            AND item_id_hash IN (${bindPlaceholders})`,
    }) satisfies ISqlEntry,
};
