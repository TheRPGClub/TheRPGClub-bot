import assert from "node:assert/strict";
import test from "node:test";
import { SnowflakeUtil } from "discord.js";
import {
  findInNewsFeed,
  type INewsFeedPage,
  type IRecordedNewsItem,
} from "../services/NewsItemApi.js";

// The API has no read for one News Item, so its News Copy is found in the feed, newest first.

const id = (iso: string, increment = 0): string =>
  SnowflakeUtil.generate({ timestamp: Date.parse(iso), increment: BigInt(increment) }).toString();

function item(iso: string, increment = 0): IRecordedNewsItem {
  return {
    message_id: id(iso, increment),
    origin: "live",
    posted_at: iso,
    news_copy: { message_id: `9${increment}`, thread_id: "520000000000000001" },
  };
}

/** A feed of `items` (newest first) served `per` at a time; `reads` lists the pages read. */
function feed(items: IRecordedNewsItem[]) {
  const reads: number[] = [];
  const readPage = async (page: number, per: number): Promise<INewsFeedPage> => {
    reads.push(page);
    const pages = Math.max(1, Math.ceil(items.length / per));
    return { data: items.slice((page - 1) * per, page * per), meta: { page, pages } };
  };
  return { reads, readPage };
}

const NEWEST = [
  item("2026-11-10T12:00:00.000Z"),
  item("2026-11-10T11:00:00.000Z"),
  item("2026-11-10T10:00:00.000Z"),
  item("2026-11-10T09:00:00.000Z"),
  item("2026-11-10T08:00:00.000Z"),
];

test("a recent News Item is found on the first page", async () => {
  const { reads, readPage } = feed(NEWEST);
  const found = await findInNewsFeed(NEWEST[1].message_id, readPage, 2);

  assert.deepEqual(found, NEWEST[1]);
  assert.deepEqual(reads, [1]);
});

test("an older News Item is found by paging back", async () => {
  const { reads, readPage } = feed(NEWEST);
  const found = await findInNewsFeed(NEWEST[4].message_id, readPage, 2);

  assert.deepEqual(found, NEWEST[4]);
  assert.deepEqual(reads, [1, 2, 3]);
});

test("the search stops once the feed is older than the message", async () => {
  const { reads, readPage } = feed(NEWEST);
  const missing = id("2026-11-10T09:30:00.000Z");

  assert.equal(await findInNewsFeed(missing, readPage, 2), null);
  assert.deepEqual(reads, [1, 2]);
});

test("a recorded time a little off the message's own still finds it", async () => {
  const early = { ...item("2026-11-10T09:00:00.000Z", 1), posted_at: "2026-11-10T08:59:30.000Z" };
  const { readPage } = feed([NEWEST[0], NEWEST[1], NEWEST[2], early]);

  assert.deepEqual(await findInNewsFeed(early.message_id, readPage, 2), early);
});

test("a message newer than the whole feed, or an empty feed, reads one page", async () => {
  for (const items of [NEWEST, []]) {
    const { reads, readPage } = feed(items);
    assert.equal(await findInNewsFeed(id("2026-11-11T00:00:00.000Z"), readPage, 2), null);
    assert.deepEqual(reads, [1]);
  }
});
