import assert from "node:assert/strict";
import test from "node:test";
import { buildNewsCopy, type INewsCopySource } from "../functions/NewsCopy.js";

const ORIGINAL = "https://discord.com/channels/100/738040352274907225/610000000000000001";

function source(overrides: Partial<INewsCopySource> = {}): INewsCopySource {
  return {
    originalUrl: ORIGINAL,
    authorId: "710000000000000001",
    comment: "Big patch today",
    linkUrl: "https://example.com/news/1",
    images: [],
    postedAt: null,
    ...overrides,
  };
}

test("a News Copy credits the sharer, then shows the comment, link and original", () => {
  const copy = buildNewsCopy(source());

  assert.equal(
    copy.content,
    "<@710000000000000001> shared\n" +
      "Big patch today\n" +
      "https://example.com/news/1\n" +
      `-# Discuss: ${ORIGINAL}`,
  );
  assert.deepEqual(copy.files, []);
});

test("a News Copy never pings anyone", () => {
  const copy = buildNewsCopy(source({ comment: "@everyone look" }));

  assert.deepEqual(copy.allowedMentions, { parse: [] });
});

test("a News Copy uploads the images again under their own names", () => {
  const copy = buildNewsCopy(source({
    comment: null,
    linkUrl: null,
    images: [
      { url: "https://cdn.discordapp.com/a/1/shot.png?ex=1", name: "shot.png" },
      { url: "https://cdn.discordapp.com/a/2/SPOILER_x.jpg", name: "SPOILER_x.jpg" },
    ],
  }));

  assert.equal(copy.content, `<@710000000000000001> shared\n-# Discuss: ${ORIGINAL}`);
  assert.deepEqual(copy.files, [
    { attachment: "https://cdn.discordapp.com/a/1/shot.png?ex=1", name: "shot.png" },
    { attachment: "https://cdn.discordapp.com/a/2/SPOILER_x.jpg", name: "SPOILER_x.jpg" },
  ]);
});

test("a copy of an imported item shows the original date", () => {
  const copy = buildNewsCopy(source({ postedAt: new Date("2021-03-04T05:06:07.000Z") }));

  assert.match(copy.content, /^<@710000000000000001> shared on <t:1614834367:D>\n/);
});

test("a long comment is shortened so the copy fits in one Discord message", () => {
  const copy = buildNewsCopy(source({ comment: "x".repeat(4000) }));

  assert.equal(copy.content.length, 2000);
  assert.match(copy.content, /x…\nhttps:\/\/example\.com\/news\/1\n-# Discuss: /);
});

test("an image too large to upload is linked instead, so the copy can still post", () => {
  const limit = 10 * 1024 * 1024;
  const small = { url: "https://cdn.discordapp.com/a/1/small.png?ex=1", name: "small.png" };
  const huge = { url: "https://cdn.discordapp.com/a/2/huge.png?ex=1", name: "huge.png" };
  const copy = buildNewsCopy(source({
    images: [{ ...small, size: 2_000_000 }, { ...huge, size: limit + 1 }],
  }));

  assert.deepEqual(copy.files, [{ attachment: small.url, name: "small.png" }]);
  assert.equal(
    copy.content,
    "<@710000000000000001> shared\n" +
      "Big patch today\n" +
      "https://example.com/news/1\n" +
      `${huge.url}\n` +
      `-# Discuss: ${ORIGINAL}`,
  );
});

test("images that do not fit in what is left of the upload limit are linked", () => {
  const image = (n: number): { url: string; name: string; size: number } => ({
    url: `https://cdn.discordapp.com/a/${n}/shot${n}.png?ex=1`,
    name: `shot${n}.png`,
    size: 4 * 1024 * 1024,
  });
  const copy = buildNewsCopy(source({ linkUrl: null, images: [image(1), image(2), image(3)] }));

  assert.deepEqual(copy.files.map((file) => file.name), ["shot1.png", "shot2.png"]);
  assert.match(copy.content, /\nhttps:\/\/cdn\.discordapp\.com\/a\/3\/shot3\.png\?ex=1\n-# Discuss/);
});

test("an image of unknown size is uploaded", () => {
  const copy = buildNewsCopy(source({
    images: [{ url: "https://cdn.discordapp.com/a/1/shot.png", name: "shot.png" }],
  }));

  assert.equal(copy.files.length, 1);
});
