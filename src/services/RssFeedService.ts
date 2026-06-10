import Parser from "rss-parser";
import crypto from "node:crypto";
import type { Client } from "discordx";
import type oracledb from "oracledb";
import type pg from "pg";
import { dbWithConnection } from "../db/SqlManager.js";
import {
  listFeeds,
  markItemsSeen,
  getSeenItemHashes,
  type IRssFeedItem,
  type IRssFeed,
} from "../classes/RssFeed.js";
import { logError, logWarn } from "../utilities/LogUtils.js";

const POLL_INTERVAL_MS: number = 5 * 60 * 1000;
const ERROR_LOG_COOLDOWN = 60 * 60 * 1000; // 1 hour
const lastErrorLog = new Map<string, number>();

const parser = new Parser({
  timeout: 60_000,
});

function hashId(parts: (string | null | undefined)[]): string {
  const joined = parts.filter(Boolean).join("|");
  // eslint-disable-next-line local/no-direct-interaction-response-methods
  return crypto.createHash("sha256").update(joined).digest("hex");
}

function matchesKeywords(
  include: string[], exclude: string[], title: string, content: string,
): boolean {
  const haystack = `${title} ${content}`.toLowerCase();

  if (exclude.length && exclude.some((kw) => haystack.includes(kw))) {
    return false;
  }
  if (include.length && !include.some((kw) => haystack.includes(kw))) {
    return false;
  }
  return true;
}

async function processFeed(
  client: Client,
  feed: IRssFeed,
  connection: oracledb.Connection | pg.PoolClient,
): Promise<void> {
  let parsed;
  try {
    parsed = await parser.parseURL(feed.feedUrl);
  } catch (err: any) {
    const msg = String(err);
    if (msg.includes("Status code 500")) {
      const last = lastErrorLog.get(feed.feedUrl) || 0;
      if (Date.now() - last > ERROR_LOG_COOLDOWN) {
        logError("RssFeedService.500Error", feed.feedUrl);
        lastErrorLog.set(feed.feedUrl, Date.now());
      }
      return;
    }
    logError("RssFeedService.parseFeed", err);
    return;
  }

  const newItems: IRssFeedItem[] = [];
  const candidates: { item: IRssFeedItem; link: string; title: string }[] = [];
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  
  // Feed keywords are already normalized by listFeeds
  const include = feed.includeKeywords;
  const exclude = feed.excludeKeywords;

  for (const item of parsed.items ?? []) {
    const title = item.title ?? "(no title)";
    const link = item.link ?? item.guid ?? "";
    const guid = item.guid ?? link ?? title;
    const content = item.contentSnippet ?? item.content ?? "";
    const hash = hashId([guid, link, title]);
    const publishedAt = item.pubDate ? new Date(item.pubDate) : null;
    if (publishedAt && publishedAt.getTime() < cutoff) continue;
    if (!matchesKeywords(include, exclude, title, content)) continue;

    const itemRecord: IRssFeedItem = {
      feedId: feed.feedId,
      itemIdHash: hash,
      itemGuid: item.guid ?? null,
      itemLink: item.link ?? null,
      publishedAt,
    };
    candidates.push({ item: itemRecord, link: link || "No link provided", title });
  }

  if (!candidates.length) return;

  const candidateHashes = candidates.map((c) => c.item.itemIdHash);
  const seen = await getSeenItemHashes(feed.feedId, candidateHashes, connection);

  const toSend: { link: string; title: string }[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.item.itemIdHash)) continue;
    newItems.push(candidate.item);
    toSend.push({ link: candidate.link, title: candidate.title });
  }

  if (!newItems.length) return;

  await markItemsSeen(newItems);

  try {
    const channel = await client.channels.fetch(feed.channelId).catch(() => null);
    if (!channel) {
      logWarn("RssFeedService.processChannel", `Channel ${feed.channelId} not found for feed #${feed.feedId}`);
      return;
    }
    if (!(typeof (channel as any).isTextBased === "function" && (channel as any).isTextBased())) {
      logWarn("RssFeedService.processChannel", `Channel ${feed.channelId} is not text-based for feed #${feed.feedId}`);
      return;
    }

    if (toSend.length === 0) {
      return;
    }

    try {
      const textChannel: any = channel as any;
      for (const item of toSend) {
        await textChannel.send(`${item.title}\n${item.link}`);
      }
    } catch (err) {
      logError("RssFeedService.sendItems", err);
    }
  } catch (err) {
    logError("RssFeedService.fetchChannel", err);
  }
}

export function startRssFeedService(client: Client): void {
  let isPolling = false;

  const tick = async () => {
    if (isPolling) {
      logWarn("RssFeedService.tick", "Previous poll still running, skipping this cycle.");
      return;
    }
    isPolling = true;

    try {
      await dbWithConnection(async (conn) => {
        const feeds = await listFeeds(conn);
        for (const feed of feeds) {
          await processFeed(client, feed, conn);
        }
      });
    } catch (err) {
      logError("RssFeedService.polling", err);
    } finally {
      isPolling = false;
    }
  };

  void tick();
  setInterval(() => {
    void tick();
  }, POLL_INTERVAL_MS);
}
