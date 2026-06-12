import type pg from "pg";
import {
  dbQuery,
  dbQueryConn,
  dbMutateConn,
  dbTransaction,
} from "../db/SqlManager.js";
import { RssFeedSql } from "../db/sql/index.js";
import {
  apiGet,
  apiPost,
  apiPatch,
  apiDelete,
} from "../services/RpgClubApiClient.js";

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

type RssFeedApiData = {
  feed_id: number;
  feed_name: string | null;
  feed_url: string;
  channel_id: string;
  include_keywords: string | null;
  exclude_keywords: string | null;
};

type RssFeedApiSingleResponse = { data: RssFeedApiData };
type RssFeedApiListResponse = { data: RssFeedApiData[] };

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

function mapApiData(d: RssFeedApiData): IRssFeed {
  return {
    feedId: d.feed_id,
    feedName: d.feed_name ?? null,
    feedUrl: d.feed_url,
    channelId: d.channel_id,
    includeKeywords: normalizeKeywords(d.include_keywords),
    excludeKeywords: normalizeKeywords(d.exclude_keywords),
  };
}

type AnyConn = pg.PoolClient;

export async function listFeeds(): Promise<IRssFeed[]> {
  const response = await apiGet<RssFeedApiListResponse>("/api/v1/rss_feeds");
  if (!response) return [];
  return response.data.map(mapApiData);
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
  const response = await apiPost<RssFeedApiSingleResponse>("/api/v1/rss_feeds", {
    data: {
      feed_name: feedName,
      feed_url: feedUrl,
      channel_id: channelId,
      include_keywords: normalizedInclude.join(", ") || null,
      exclude_keywords: normalizedExclude.join(", ") || null,
    },
  });
  if (!response) throw new Error("Failed to create RSS feed: API returned null");
  return response.data.feed_id;
}

export async function removeFeed(feedId: number): Promise<boolean> {
  const response = await apiDelete<{ deleted: boolean }>(`/api/v1/rss_feeds/${feedId}`);
  return response?.deleted === true;
}

export async function updateFeed(
  feedId: number,
  updates: Partial<
    Pick<IRssFeed, "feedUrl" | "channelId" | "includeKeywords" | "excludeKeywords" | "feedName">
  >,
): Promise<boolean> {
  const body: Record<string, string | null> = {};

  if (updates.feedUrl !== undefined) body.feed_url = updates.feedUrl;
  if (updates.feedName !== undefined) body.feed_name = updates.feedName;
  if (updates.channelId !== undefined) body.channel_id = updates.channelId;
  if (updates.includeKeywords !== undefined) {
    body.include_keywords = normalizeKeywords(updates.includeKeywords).join(", ") || null;
  }
  if (updates.excludeKeywords !== undefined) {
    body.exclude_keywords = normalizeKeywords(updates.excludeKeywords).join(", ") || null;
  }

  if (!Object.keys(body).length) return false;

  const response = await apiPatch<RssFeedApiSingleResponse>(
    `/api/v1/rss_feeds/${feedId}`,
    { data: body },
  );
  return response !== null;
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
