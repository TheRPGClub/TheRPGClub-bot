import type pg from "pg";
import {
  dbQuery,
  dbMutate,
  dbInsert,
  dbQueryConn,
  dbMutateConn,
  dbTransaction,
} from "../db/SqlManager.js";
import { RssFeedSql } from "../db/sql/index.js";

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

function mapIsItemSeenRow(row: { FOUND: number }) { return row; }
function mapSeenItemHashRow(row: { ITEM_ID_HASH: string }) { return row; }

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

type AnyConn = pg.PoolClient;

export async function listFeeds(existingConnection?: AnyConn): Promise<IRssFeed[]> {
  if (existingConnection) {
    return dbQueryConn(existingConnection, RssFeedSql.listFeeds, {}, mapFeedRow);
  }
  return dbQuery(RssFeedSql.listFeeds, {}, mapFeedRow);
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
  return dbInsert(
    RssFeedSql.addFeed,
    {
      feedName,
      feedUrl,
      channelId,
      includes: normalizedInclude.join(", "),
      excludes: normalizedExclude.join(", "),
    },
    "id",
  );
}

export async function removeFeed(feedId: number): Promise<boolean> {
  const count = await dbMutate(RssFeedSql.removeFeed, { id: feedId });
  return count > 0;
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

  const count = await dbMutate(RssFeedSql.updateFeed(sets), params);
  return count > 0;
}

export async function markItemsSeen(
  items: IRssFeedItem[],
  existingConnection?: AnyConn,
): Promise<void> {
  if (!items.length) return;
  const normalized = items.map((item) => ({
    ...item,
    itemGuid: item.itemGuid ? item.itemGuid.slice(0, 512) : null,
    itemLink: item.itemLink ? item.itemLink.slice(0, 512) : null,
  }));

  if (existingConnection) {
    for (const row of normalized) {
      await dbMutateConn(existingConnection, RssFeedSql.markItemsSeen, row);
    }
    return;
  }

  await dbTransaction(async (conn) => {
    for (const row of normalized) {
      await dbMutateConn(conn, RssFeedSql.markItemsSeen, row);
    }
  });
}

export async function isItemSeen(
  feedId: number,
  itemIdHash: string,
  existingConnection?: AnyConn,
): Promise<boolean> {
  const rows = existingConnection
    ? await dbQueryConn(
        existingConnection, RssFeedSql.isItemSeen, { feedId, hash: itemIdHash }, mapIsItemSeenRow,
      )
    : await dbQuery(RssFeedSql.isItemSeen, { feedId, hash: itemIdHash }, mapIsItemSeenRow);
  return rows.length > 0;
}

export async function getSeenItemHashes(
  feedId: number,
  itemIdHashes: string[],
  existingConnection?: AnyConn,
): Promise<Set<string>> {
  if (!itemIdHashes.length) return new Set();

  const CHUNK_SIZE = 900;
  const foundHashes = new Set<string>();
  for (let i = 0; i < itemIdHashes.length; i += CHUNK_SIZE) {
    const chunk = itemIdHashes.slice(i, i + CHUNK_SIZE);
    const bindVars: Record<string, string | number> = { feedId };
    const bindPlaceholders: string[] = [];

    chunk.forEach((hash, idx) => {
      const key = `h${idx}`;
      bindVars[key] = hash;
      bindPlaceholders.push(`:${key}`);
    });

    const entry = RssFeedSql.getSeenItemHashes(bindPlaceholders.join(", "));
    const rows = existingConnection
      ? await dbQueryConn(existingConnection, entry, bindVars, mapSeenItemHashRow)
      : await dbQuery(entry, bindVars, mapSeenItemHashRow);
    rows.forEach((row) => foundHashes.add(row.ITEM_ID_HASH));
  }

  return foundHashes;
}
