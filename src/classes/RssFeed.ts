import oracledb from "oracledb";
import { oraQuery, oraMutate, oraWithConnection } from "../db/SqlManager.js";

export interface IRssFeed {
  feedId: number;
  feedName: string | null;
  feedUrl: string;
  channelId: string;
  includeKeywords: string[];
  excludeKeywords: string[];
}

export interface IRssFeedItem {
  feedId: number;
  itemIdHash: string;
  itemGuid: string | null;
  itemLink: string | null;
  publishedAt: Date | null;
}

export function normalizeKeywords(
  input: string | (string | null | undefined)[] | null | undefined): string[] {
  if (!input) return [];
  const values = typeof input === "string" ? input.split(",") : input;
  return values
    .map((k) => (k ?? "").trim().toLowerCase())
    .filter((k) => k.length > 0);
}

type FeedRow = {
  FEED_ID: number;
  FEED_NAME: string | null;
  FEED_URL: string;
  CHANNEL_ID: string;
  INCLUDE_KEYWORDS: string | null;
  EXCLUDE_KEYWORDS: string | null;
};

function mapFeedRow(row: FeedRow): IRssFeed {
  return {
    feedId: row.FEED_ID,
    feedName: row.FEED_NAME ?? null,
    feedUrl: row.FEED_URL,
    channelId: row.CHANNEL_ID,
    includeKeywords: normalizeKeywords(row.INCLUDE_KEYWORDS),
    excludeKeywords: normalizeKeywords(row.EXCLUDE_KEYWORDS),
  };
}

export async function listFeeds(existingConnection?: oracledb.Connection): Promise<IRssFeed[]> {
  return oraQuery(
    `SELECT FEED_ID,
            FEED_NAME,
            FEED_URL,
            CHANNEL_ID,
            INCLUDE_KEYWORDS,
            EXCLUDE_KEYWORDS
       FROM RPG_CLUB_RSS_FEEDS
      ORDER BY FEED_ID`,
    {},
    mapFeedRow,
    existingConnection,
  );
}

export async function addFeed(
  feedName: string | null,
  feedUrl: string,
  channelId: string,
  includeKeywords: string[],
  excludeKeywords: string[],
): Promise<number> {
  const normalizedInclude = normalizeKeywords(includeKeywords);
  const normalizedExclude = normalizeKeywords(excludeKeywords);
  const result = await oraMutate(
    `INSERT INTO RPG_CLUB_RSS_FEEDS (
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
    {
      feedName,
      feedUrl,
      channelId,
      includes: normalizedInclude.join(", "),
      excludes: normalizedExclude.join(", "),
      id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
    },
  );
  const id = (result.outBinds as { id?: number[] })?.id?.[0];
  return typeof id === "number" ? id : 0;
}

export async function removeFeed(feedId: number): Promise<boolean> {
  const result = await oraMutate(
    `DELETE FROM RPG_CLUB_RSS_FEEDS WHERE FEED_ID = :id`,
    { id: feedId },
  );
  return (result.rowsAffected ?? 0) > 0;
}

export async function updateFeed(
  feedId: number,
  updates: Partial<
    Pick<IRssFeed, "feedUrl" | "channelId" | "includeKeywords" | "excludeKeywords" | "feedName">
  >,
): Promise<boolean> {
  const sets: string[] = [];
  const params: Record<string, string | number | null> = { feedId };

  if (updates.feedUrl !== undefined) {
    sets.push("FEED_URL = :feedUrl");
    params.feedUrl = updates.feedUrl;
  }
  if (updates.feedName !== undefined) {
    sets.push("FEED_NAME = :feedName");
    params.feedName = updates.feedName;
  }
  if (updates.channelId !== undefined) {
    sets.push("CHANNEL_ID = :channelId");
    params.channelId = updates.channelId;
  }
  if (updates.includeKeywords !== undefined) {
    sets.push("INCLUDE_KEYWORDS = :includes");
    params.includes = normalizeKeywords(updates.includeKeywords).join(", ");
  }
  if (updates.excludeKeywords !== undefined) {
    sets.push("EXCLUDE_KEYWORDS = :excludes");
    params.excludes = normalizeKeywords(updates.excludeKeywords).join(", ");
  }

  if (!sets.length) return false;

  const result = await oraMutate(
    `UPDATE RPG_CLUB_RSS_FEEDS
        SET ${sets.join(", ")}
      WHERE FEED_ID = :feedId`,
    params,
  );
  return (result.rowsAffected ?? 0) > 0;
}

export async function markItemsSeen(
  items: IRssFeedItem[],
  existingConnection?: oracledb.Connection,
): Promise<void> {
  if (!items.length) return;
  const normalized = items.map((item) => ({
    ...item,
    itemGuid: item.itemGuid ? item.itemGuid.slice(0, 512) : null,
    itemLink: item.itemLink ? item.itemLink.slice(0, 512) : null,
  }));
  const sql = `MERGE INTO RPG_CLUB_RSS_FEED_ITEMS t
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
       VALUES (s.feed_id, s.item_id_hash, s.item_guid, s.item_link, s.published_at, SYSTIMESTAMP)`;
  const opts = {
    autoCommit: true,
    bindDefs: {
      feedId: { type: oracledb.NUMBER },
      itemIdHash: { type: oracledb.STRING, maxSize: 128 },
      itemGuid: { type: oracledb.STRING, maxSize: 1024 },
      itemLink: { type: oracledb.STRING, maxSize: 1024 },
      publishedAt: { type: oracledb.DATE },
    },
  };
  const doExecute = async (conn: oracledb.Connection): Promise<void> => {
    await conn.executeMany(sql, normalized as never[], opts);
  };
  if (existingConnection) {
    await doExecute(existingConnection);
  } else {
    await oraWithConnection(doExecute);
  }
}

export async function isItemSeen(
  feedId: number,
  itemIdHash: string,
  existingConnection?: oracledb.Connection,
): Promise<boolean> {
  const rows = await oraQuery(
    `SELECT 1 AS FOUND
       FROM RPG_CLUB_RSS_FEED_ITEMS
      WHERE FEED_ID = :feedId
        AND ITEM_ID_HASH = :hash`,
    { feedId, hash: itemIdHash },
    (row: { FOUND: number }) => row,
    existingConnection,
  );
  return rows.length > 0;
}

export async function getSeenItemHashes(
  feedId: number,
  itemIdHashes: string[],
  existingConnection?: oracledb.Connection,
): Promise<Set<string>> {
  if (!itemIdHashes.length) return new Set();

  const doQuery = async (conn: oracledb.Connection): Promise<Set<string>> => {
    const foundHashes = new Set<string>();
    const CHUNK_SIZE = 900;

    for (let i = 0; i < itemIdHashes.length; i += CHUNK_SIZE) {
      const chunk = itemIdHashes.slice(i, i + CHUNK_SIZE);
      const bindVars: Record<string, string | number> = { feedId };
      const bindPlaceholders: string[] = [];

      chunk.forEach((hash, idx) => {
        const key = `h${idx}`;
        bindVars[key] = hash;
        bindPlaceholders.push(`:${key}`);
      });

      const rows = await oraQuery(
        `SELECT ITEM_ID_HASH
           FROM RPG_CLUB_RSS_FEED_ITEMS
          WHERE FEED_ID = :feedId
            AND ITEM_ID_HASH IN (${bindPlaceholders.join(", ")})`,
        bindVars,
        (row: { ITEM_ID_HASH: string }) => row,
        conn,
      );
      rows.forEach((row) => foundHashes.add(row.ITEM_ID_HASH));
    }

    return foundHashes;
  };

  if (existingConnection) {
    return doQuery(existingConnection);
  }
  return oraWithConnection(doQuery);
}
