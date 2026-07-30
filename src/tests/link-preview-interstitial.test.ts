import assert from "node:assert/strict";
import test from "node:test";
import { ComponentType, type Message } from "discord.js";
import { Collection } from "discord.js";
import {
  extractPreviewTitle,
  isInterstitialPreview,
  isInterstitialTitle,
  INTERSTITIAL_TITLES,
  type IOpenGraphData,
} from "../functions/LinkPreviewEmbeds.js";
import {
  findStuckPreviewReply,
  isStuckPreviewMessage,
} from "../services/LinkPreviewRecoveryService.js";
import { describeRerenderResult } from "../commands/mod.command.js";
import { isSnowflake } from "../utilities/ValidationUtils.js";

const POST_URL = "https://xcancel.com/ReticentY2K/status/2082451207650488402";

function buildPreviewData(overrides: Partial<IOpenGraphData> = {}): IOpenGraphData {
  return {
    siteName: "xcancel.com",
    homepageUrl: "https://xcancel.com",
    title: "Verifying your browser…",
    description: undefined,
    imageUrls: [],
    url: POST_URL,
    ...overrides,
  };
}

function makeContainerMessage(textLines: string[], overrides: Record<string, unknown> = {}) {
  const textDisplays: { type: number; content: string }[] = [];
  for (const content of textLines) {
    textDisplays.push({ type: ComponentType.TextDisplay, content });
  }

  return {
    id: "200000000000000000",
    author: { id: "999999999999999999" },
    reference: { messageId: "100000000000000000" },
    components: [
      { toJSON: () => ({ type: ComponentType.Container, components: textDisplays }) },
    ],
    ...overrides,
  } as unknown as Message;
}

const STUCK_LINES = [
  "[xcancel.com](https://xcancel.com)",
  `**[Verifying your browser…](${POST_URL})**`,
];

test("isInterstitialTitle matches every seeded title, ellipsis and case insensitive", () => {
  for (const known of INTERSTITIAL_TITLES) {
    assert.equal(isInterstitialTitle(known.toUpperCase()), true, known);
    assert.equal(isInterstitialTitle(`${known}…`), true, known);
    assert.equal(isInterstitialTitle(`  ${known}...  `), true, known);
  }
});

test("isInterstitialTitle ignores unrelated titles", () => {
  assert.equal(isInterstitialTitle("Baldur's Gate 3 patch 8 is live"), false);
  assert.equal(isInterstitialTitle(undefined), false);
});

test("isInterstitialPreview flags a bare bot-check page", () => {
  assert.equal(isInterstitialPreview(buildPreviewData()), true);
});

test("isInterstitialPreview spares a page that scraped a description", () => {
  const data = buildPreviewData({ description: "A real post body." });
  assert.equal(isInterstitialPreview(data), false);
});

test("isInterstitialPreview spares a page that scraped an image", () => {
  const data = buildPreviewData({ imageUrls: ["https://xcancel.com/pic.png"] });
  assert.equal(isInterstitialPreview(data), false);
});

test("extractPreviewTitle reads the bold link line, not the site line", () => {
  assert.equal(extractPreviewTitle(STUCK_LINES), "Verifying your browser…");
  assert.equal(extractPreviewTitle(["[xcancel.com](https://xcancel.com)"]), undefined);
});

test("isStuckPreviewMessage detects a rendered interstitial container", () => {
  assert.equal(isStuckPreviewMessage(makeContainerMessage(STUCK_LINES)), true);
});

test("isStuckPreviewMessage leaves a healthy preview alone", () => {
  const healthy = [
    "[xcancel.com](https://xcancel.com)",
    `**[Patch 8 is live](${POST_URL})**`,
    "Full patch notes inside.",
  ];
  assert.equal(isStuckPreviewMessage(makeContainerMessage(healthy)), false);
});

test("findStuckPreviewReply matches only the bot's stuck reply to the source", () => {
  const clientUserId = "999999999999999999";
  const sourceId = "100000000000000000";

  const otherAuthor = makeContainerMessage(STUCK_LINES, {
    id: "200000000000000001",
    author: { id: "111111111111111111" },
  });
  const otherSource = makeContainerMessage(STUCK_LINES, {
    id: "200000000000000002",
    reference: { messageId: "100000000000000009" },
  });
  const notAReply = makeContainerMessage(STUCK_LINES, {
    id: "200000000000000003",
    reference: undefined,
  });
  const stuckReply = makeContainerMessage(STUCK_LINES, { id: "200000000000000004" });

  const fetched = new Collection<string, Message>([
    [otherAuthor.id, otherAuthor],
    [otherSource.id, otherSource],
    [notAReply.id, notAReply],
    [stuckReply.id, stuckReply],
  ]);

  const sourceMessage = {
    id: sourceId,
    client: { user: { id: clientUserId } },
    channel: { messages: { fetch: async () => fetched } },
  } as unknown as Message;

  return findStuckPreviewReply(sourceMessage).then((found) => {
    assert.equal(found?.id, stuckReply.id);
  });
});

test("findStuckPreviewReply returns nothing when the channel holds no messages", async () => {
  const sourceMessage = {
    id: "100000000000000000",
    client: { user: { id: "999999999999999999" } },
    channel: {},
  } as unknown as Message;

  assert.equal(await findStuckPreviewReply(sourceMessage), undefined);
});

test("isSnowflake gates the /mod rerender-embed message_id option", () => {
  assert.equal(isSnowflake("2082451207650488402"), true);
  assert.equal(isSnowflake("not-an-id"), false);
  assert.equal(isSnowflake("123"), false);
  assert.equal(isSnowflake(""), false);
});

test("describeRerenderResult reports what happened for every outcome", () => {
  const rendered = describeRerenderResult(
    { status: "rendered", deletedStuckReply: true, url: POST_URL },
    POST_URL,
  );
  assert.match(rendered, /Deleted the stuck preview\./);
  assert.match(rendered, /Re-rendered the preview/);

  const stillStuck = describeRerenderResult(
    { status: "still-interstitial", deletedStuckReply: false, url: POST_URL },
    POST_URL,
  );
  assert.match(stillStuck, /No stuck preview found\./);
  assert.match(stillStuck, /still behind a browser check/);

  const noUrl = describeRerenderResult({ status: "no-url", deletedStuckReply: false }, POST_URL);
  assert.match(noUrl, /no link to preview/);
});
