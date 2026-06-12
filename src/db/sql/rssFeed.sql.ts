import type { ISqlEntry } from "./types.js";

export const RssFeedSql = {
  listFeeds: {
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
    postgres: `DELETE FROM rpg_club_rss_feeds WHERE feed_id = :id`,
  } satisfies ISqlEntry,

  // Caller must pass lowercase column=value expressions for Postgres (e.g. "feed_name = :feedName")
  updateFeed: (sets: string[]) =>
    ({
      postgres: `UPDATE rpg_club_rss_feeds
        SET ${sets.join(", ")}
      WHERE feed_id = :feedId`,
    }) satisfies ISqlEntry,

  markItemsSeen: {
    postgres: `INSERT INTO rpg_club_rss_feed_items
       (feed_id, item_id_hash, item_guid, item_link, published_at, first_seen_at)
       VALUES (:feedId, :itemIdHash, :itemGuid, :itemLink, :publishedAt, NOW())
       ON CONFLICT (feed_id, item_id_hash) DO NOTHING`,
  } satisfies ISqlEntry,

  isItemSeen: {
    postgres: `SELECT 1 AS found
       FROM rpg_club_rss_feed_items
      WHERE feed_id = :feedId
        AND item_id_hash = :hash`,
  } satisfies ISqlEntry,

  getSeenItemHashes: (bindPlaceholders: string) =>
    ({
      postgres: `SELECT item_id_hash
           FROM rpg_club_rss_feed_items
          WHERE feed_id = :feedId
            AND item_id_hash IN (${bindPlaceholders})`,
    }) satisfies ISqlEntry,
};
