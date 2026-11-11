import assert from "node:assert/strict";
import test from "node:test";
import type { NewsPlaces } from "../config/newsHub.js";
import { newsItemFrom, type INewsMessage } from "../functions/NewsItem.js";

const RELEASES_THREAD = "500000000000000001";
const RELEASES_DISCUSSION = "500000000000000002";
const ARCHIVE_CHANNEL = "500000000000000003";
const OTHER_CHANNEL = "500000000000000004";
const MESSAGE_ID = "600000000000000001";
const AUTHOR_ID = "700000000000000001";
const POSTED = new Date("2026-11-10T12:00:00.000Z");

const PLACES: NewsPlaces = new Map([
  [RELEASES_THREAD, "releases"],
  [ARCHIVE_CHANNEL, null],
]);

// Discord's signed CDN address; `ex` is the expiry in hex unix seconds (0x69120000).
const IMAGE_URL =
  "https://cdn.discordapp.com/attachments/1/2/shot.png?ex=69120000&is=69100000&hm=ab";
const IMAGE_EXPIRES = new Date(0x69120000 * 1000).toISOString();

function message(overrides: Partial<INewsMessage> = {}): INewsMessage {
  return {
    id: MESSAGE_ID,
    channelId: RELEASES_THREAD,
    system: false,
    webhookId: null,
    author: { id: AUTHOR_ID, bot: false, username: "pixelpal", globalName: "Pixel Pal" },
    member: { displayName: "Pixel (club name)" },
    cleanContent: "",
    createdAt: POSTED,
    editedAt: null,
    attachments: new Map(),
    embeds: [],
    ...overrides,
  };
}

test("a bare link in a category thread is a News Item of that thread's category", () => {
  const item = newsItemFrom(message({ cleanContent: "https://example.com/news/1" }), PLACES);

  assert.deepEqual(item, {
    message_id: MESSAGE_ID,
    channel_id: RELEASES_THREAD,
    category_key: "releases",
    author_id: AUTHOR_ID,
    author_name: "Pixel (club name)",
    comment: null,
    posted_at: "2026-11-10T12:00:00.000Z",
    edited_at: null,
    link: {
      url: "https://example.com/news/1",
      title: null,
      site_name: null,
      description: null,
      image_url: null,
    },
    images: [],
  });
});

test("the comment is the text a reader sees, without the item's link address", () => {
  const item = newsItemFrom(
    message({ cleanContent: "Huge news @Pixel Pal :hype:\nhttps://example.com/news/1 out now!" }),
    PLACES,
  );

  assert.equal(item?.link?.url, "https://example.com/news/1");
  assert.equal(item?.comment, "Huge news @Pixel Pal :hype:\nout now!");
});

function attachments(
  ...files: { url: string; contentType: string | null; name: string }[]
): INewsMessage["attachments"] {
  return new Map(files.map((file, index) => [String(index), file]));
}

test("an image alone is a News Item with no link, its expiry read from its address", () => {
  const image = { url: IMAGE_URL, contentType: "image/png", name: "s.png" };
  const item = newsItemFrom(
    message({ attachments: attachments(image) }),
    PLACES,
  );

  assert.equal(item?.link, null);
  assert.equal(item?.comment, null);
  assert.deepEqual(item?.images, [{ url: IMAGE_URL, expires_at: IMAGE_EXPIRES }]);
});

test("an image address without an `ex` parameter does not expire", () => {
  const plain = "https://media.discordapp.net/attachments/1/2/plain.png";
  const odd = "https://cdn.discordapp.com/attachments/1/2/odd.png?ex=zz";
  const item = newsItemFrom(
    message({
      attachments: attachments(
        { url: plain, contentType: "image/png", name: "plain.png" },
        { url: odd, contentType: "image/png", name: "odd.png" },
      ),
    }),
    PLACES,
  );

  assert.deepEqual(item?.images, [
    { url: plain, expires_at: null },
    { url: odd, expires_at: null },
  ]);
});

test("a video or other file alone is not a News Item", () => {
  const video = "https://cdn.discordapp.com/attachments/1/2/clip.mp4?ex=69120000&is=1&hm=2";
  const item = newsItemFrom(
    message({
      cleanContent: "look at this",
      attachments: attachments({ url: video, contentType: "video/mp4", name: "clip.mp4" }),
    }),
    PLACES,
  );

  assert.equal(item, null);
});

function embed(url: string, overrides: Partial<INewsMessage["embeds"][number]> = {}) {
  return {
    url,
    title: "Game X launches",
    description: "The long-awaited sequel is out.",
    provider: { name: "Example News" },
    thumbnail: { url: "https://example.com/cover.jpg" },
    image: null,
    ...overrides,
  };
}

test("Discord's preview of the link fills in its title, site, description and image", () => {
  const url = "https://example.com/news/1";
  const item = newsItemFrom(message({ cleanContent: url, embeds: [embed(url)] }), PLACES);

  assert.deepEqual(item?.link, {
    url,
    title: "Game X launches",
    site_name: "Example News",
    description: "The long-awaited sequel is out.",
    image_url: "https://example.com/cover.jpg",
  });
});

test("a preview with a large image and no thumbnail uses the large image", () => {
  const url = "https://example.com/news/1";
  const preview = embed(url, { thumbnail: null, image: { url: "https://example.com/big.jpg" } });
  const item = newsItemFrom(message({ cleanContent: url, embeds: [preview] }), PLACES);

  assert.equal(item?.link?.image_url, "https://example.com/big.jpg");
});

test("a preview image is Discord's proxied copy when it has one", () => {
  // Many sites refuse images loaded from another site; Discord's copy always loads.
  const url = "https://example.com/news/1";
  const proxied = "https://images-ext-1.discordapp.net/external/abc/https/example.com/cover.jpg";
  const preview = embed(url, {
    thumbnail: { url: "https://example.com/cover.jpg", proxyURL: proxied },
  });
  const item = newsItemFrom(message({ cleanContent: url, embeds: [preview] }), PLACES);

  assert.equal(item?.link?.image_url, proxied);
});

test("a preview with no title, like a post on X or Bluesky, takes its author as title", () => {
  const url = "https://x.com/wario64/status/1";
  const preview = embed(url, {
    title: null,
    provider: null,
    author: { name: "Wario64 (@Wario64)" },
    description: "Persona 3 Reload is $29.99 today",
  });
  const item = newsItemFrom(message({ cleanContent: url, embeds: [preview] }), PLACES);

  assert.equal(item?.link?.title, "Wario64 (@Wario64)");
  assert.equal(item?.link?.description, "Persona 3 Reload is $29.99 today");
});

test("with several links the first is the item's link and the rest stay in the comment", () => {
  const first = "https://example.com/news/1";
  const second = "https://other.example/story";
  const item = newsItemFrom(
    message({
      cleanContent: `Two takes: ${first} and ${second}`,
      embeds: [embed(second, { title: "The other story" })],
    }),
    PLACES,
  );

  assert.equal(item?.link?.url, first);
  assert.equal(item?.link?.title, null, "the second link's preview is not the first's");
  assert.equal(item?.comment, `Two takes: and ${second}`);
});

test("a link's trailing punctuation, brackets and masked label are not part of its address", () => {
  const url = "https://example.com/news/1";
  const cases: [string, string | null][] = [
    [`Read this: ${url}.`, "Read this: ."],
    [`(see ${url})`, "(see )"],
    [`no preview <${url}>`, "no preview"],
    [`[Game X is out](${url}) today`, "Game X is out today"],
  ];
  for (const [text, comment] of cases) {
    const item = newsItemFrom(message({ cleanContent: text }), PLACES);
    assert.equal(item?.link?.url, url, text);
    assert.equal(item?.comment, comment, text);
  }
});

test("a link and images together make one News Item with every image in order", () => {
  const second = IMAGE_URL.replace("shot.png", "two.webp");
  const item = newsItemFrom(
    message({
      cleanContent: "Trailer and screens https://example.com/trailer",
      editedAt: new Date("2026-11-10T12:05:00.000Z"),
      attachments: attachments(
        { url: IMAGE_URL, contentType: "image/png", name: "shot.png" },
        {
          url: "https://cdn.discordapp.com/attachments/1/2/notes.txt?ex=1",
          contentType: "text/plain",
          name: "notes.txt",
        },
        { url: second, contentType: null, name: "two.webp" },
      ),
    }),
    PLACES,
  );

  assert.equal(item?.link?.url, "https://example.com/trailer");
  assert.equal(item?.comment, "Trailer and screens");
  assert.equal(item?.edited_at, "2026-11-10T12:05:00.000Z");
  assert.deepEqual(item?.images, [
    { url: IMAGE_URL, expires_at: IMAGE_EXPIRES },
    { url: second, expires_at: IMAGE_EXPIRES },
  ]);
});

test("messages that are not News Items", () => {
  const link = "https://example.com/news/1";
  const cases: [string, INewsMessage][] = [
    ["text only", message({ cleanContent: "anyone playing this?" })],
    ["a bot's message", message({
      cleanContent: link,
      author: { id: AUTHOR_ID, bot: true, username: "rss", globalName: null },
    })],
    ["a system message", message({ cleanContent: link, system: true })],
    ["a webhook's message", message({ cleanContent: link, webhookId: "800000000000000001" })],
    ["a discussion thread", message({ cleanContent: link, channelId: RELEASES_DISCUSSION })],
    ["an unrelated channel", message({ cleanContent: link, channelId: OTHER_CHANNEL })],
    ["the forum post's opening message", message({ cleanContent: link, id: RELEASES_THREAD })],
  ];
  for (const [label, candidate] of cases) {
    assert.equal(newsItemFrom(candidate, PLACES), null, label);
  }
});

test("a message in a place with no News Category is a News Item without one", () => {
  const item = newsItemFrom(
    message({ channelId: ARCHIVE_CHANNEL, cleanContent: "https://example.com/old" }),
    PLACES,
  );

  assert.equal(item?.channel_id, ARCHIVE_CHANNEL);
  assert.equal(item?.category_key, null);
});

test("the author's name falls back from server name to global name to username", () => {
  const link = "https://example.com/news/1";
  const departed = newsItemFrom(message({ cleanContent: link, member: null }), PLACES);
  const noGlobal = newsItemFrom(
    message({
      cleanContent: link,
      member: null,
      author: { id: AUTHOR_ID, bot: false, username: "pixelpal", globalName: null },
    }),
    PLACES,
  );

  assert.equal(departed?.author_name, "Pixel Pal");
  assert.equal(noGlobal?.author_name, "pixelpal");
});
