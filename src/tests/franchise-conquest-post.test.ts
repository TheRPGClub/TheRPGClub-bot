import assert from "node:assert/strict";
import test from "node:test";

import type { IBotJob, IBotJobApi } from "../classes/BotJobs.js";
import { BOT_DEV_CHANNEL_ID, WHATCHA_PLAYING_CHANNEL_ID } from "../config/channels.js";
import { POST_FEATURE_KEYS } from "../config/featureGate.js";
import { franchisePageUrl } from "../config/website.js";
import type { IComponentsV2View } from "../functions/ComponentsV2Utils.js";
import type { FeatureState } from "../functions/FeatureGate.js";
import { BOT_JOB_HANDLERS, type IBotJobSurface } from "../services/BotJobHandlers.js";
import { processBotJobs } from "../services/BotJobService.js";
import {
  buildConquestCard,
  conquestFooterLine,
  formatConquestDate,
  formatConquestPlaytime,
  parseFranchiseConquest,
  type IConquestPostDeps,
} from "../services/FranchiseConquestPost.js";

// The Conquest post (bot#1574, design pick 4B): the franchise_conquest job's card, its
// Feature routing, and that it pings nobody.

type Ack =
  | { id: number; status: "done"; resultText?: string }
  | { id: number; status: "failed"; error: string };

function fakeJobApi(): IBotJobApi & { acks: Ack[] } {
  const acks: Ack[] = [];
  return {
    acks,
    claim: async () => [],
    done: async (id, resultText) => {
      acks.push(
        resultText === undefined ? { id, status: "done" } : { id, status: "done", resultText },
      );
    },
    failed: async (id, error) => {
      acks.push({ id, status: "failed", error });
    },
  };
}

const FF_COVERS = ["XVI", "XV", "XIV", "XIII", "XII", "X", "IX", "VIII", "VII", "VI", "V"];

/** Mara Conquers Final Fantasy (the mock's numbers), as the API enqueues it. */
function payload(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    user_id: "111",
    franchise_id: 42,
    completion_id: 31,
    franchise_name: "Final Fantasy",
    conquered_at: "2026-11-25T17:00:00Z",
    playtime_minutes: 812 * 60,
    mainline_playtime_minutes: 700 * 60,
    mainline_total: 16,
    covers: FF_COVERS.map((numeral, i) => ({
      game_id: 100 + i,
      title: `Final Fantasy ${numeral}`,
      release_year: 2023 - i,
      cover_url: `https://img.example/ff${i}.jpg`,
    })),
    also_conquered: [
      { user_id: "222", name: "Loot Hoarder", conquered_at: "2025-01-02T17:00:00Z" },
      { user_id: "333", name: "Rowan", conquered_at: "2025-06-02T17:00:00Z" },
      { user_id: "444", name: "Jun", conquered_at: "2026-02-02T17:00:00Z" },
    ],
    also_conquered_count: 3,
    feature_key: "franchise_progress",
    ...extra,
  };
}

interface IFakeDeps extends IConquestPostDeps {
  posts: { channelId: string; post: IComponentsV2View }[];
}

function fakeDeps(): IFakeDeps {
  const deps: IFakeDeps = {
    posts: [],
    postMessage: async (channelId, post) => {
      deps.posts.push({ channelId, post });
    },
  };
  return deps;
}

async function run(
  deps: IConquestPostDeps,
  state: FeatureState | null = "live",
  jobPayload: Record<string, unknown> = payload(),
): Promise<Ack[]> {
  const api = fakeJobApi();
  const surface = { conquests: deps, featureState: async () => state } as unknown as
    IBotJobSurface;
  const job: IBotJob = { id: 7, kind: "franchise_conquest", payload: jobPayload, attempts: 1,
    requestedByUserId: null };
  await processBotJobs([job], BOT_JOB_HANDLERS, surface, api);
  return api.acks;
}

type Json = Record<string, unknown>;

function childrenOf(view: IComponentsV2View): { container: Json; rest: Json[] } {
  const [container, ...rest] = view.components as unknown as Json[];
  assert.ok(container);
  return { container, rest };
}

function textsOf(container: Json): string[] {
  return (container.components as Json[])
    .filter((c) => typeof c.content === "string")
    .map((c) => c.content as string);
}

function galleryUrls(container: Json): string[] {
  const gallery = (container.components as Json[]).find((c) => Array.isArray(c.items));
  return ((gallery?.items ?? []) as Json[]).map((item) => (item.media as Json).url as string);
}

test("franchise_progress is a post Feature key", () => {
  assert.equal(POST_FEATURE_KEYS.franchiseConquest, "franchise_progress");
});

test("the card: headline, date, 10 covers, Playtime, who else, and the Franchise link", () => {
  const view = buildConquestCard(parseFranchiseConquest(payload()));
  const { container, rest } = childrenOf(view);

  assert.equal(container.accent_color, 0xf4f4f0);
  assert.deepEqual(textsOf(container), [
    "## <@111> Conquered Final Fantasy",
    "-# Every Mainline game · 16 of 16 · 25 Nov 2026",
    "**812 h** of Playtime in the Franchise. Joins Loot Hoarder, Rowan and Jun.",
  ]);
  const urls = galleryUrls(container);
  assert.equal(urls.length, 10);
  assert.equal(urls[0], "https://img.example/ff0.jpg");

  const button = ((rest[0]?.components ?? []) as Json[])[0];
  assert.equal(button?.label, "Open Final Fantasy");
  assert.equal(button?.url, franchisePageUrl(42));
});

test("the card pings nobody", () => {
  const view = buildConquestCard(parseFranchiseConquest(payload()));
  assert.deepEqual(view.allowedMentions, { parse: [] });
});

test("the first member to Conquer it, with no Playtime and no covers", () => {
  const conquest = parseFranchiseConquest(payload({
    playtime_minutes: 0,
    covers: [],
    also_conquered: [],
    also_conquered_count: 0,
  }));
  assert.equal(conquestFooterLine(conquest), "The first member to Conquer it.");
  assert.deepEqual(galleryUrls(childrenOf(buildConquestCard(conquest)).container), []);
});

test("more members than the API named end in 'and N more'", () => {
  const conquest = parseFranchiseConquest(payload({ also_conquered_count: 14 }));
  assert.equal(
    conquestFooterLine(conquest),
    "**812 h** of Playtime in the Franchise. Joins Loot Hoarder, Rowan, Jun and 11 more.",
  );
});

test("names and the Franchise are escaped for Discord markdown", () => {
  const conquest = parseFranchiseConquest(payload({
    franchise_name: "*Star* Ocean",
    also_conquered: [{ user_id: "222", name: "x_y_", conquered_at: "2025-01-02T17:00:00Z" }],
    also_conquered_count: 1,
  }));
  const { container } = childrenOf(buildConquestCard(conquest));
  assert.equal(textsOf(container)[0], "## <@111> Conquered \\*Star\\* Ocean");
  assert.match(conquestFooterLine(conquest), /Joins x\\_y\\_\.$/);
});

test("Playtime and the date read as on the website, in the club's time zone", () => {
  assert.equal(formatConquestPlaytime(45), "45 m");
  assert.equal(formatConquestPlaytime(1240 * 60), "1,240 h");
  // 02:00 UTC on 26 November is still 25 November in New York.
  assert.equal(formatConquestDate("2026-11-26T02:00:00Z"), "25 Nov 2026");
});

test("a payload without the Franchise name fails the job", () => {
  assert.throws(
    () => parseFranchiseConquest(payload({ franchise_name: null })),
    /missing franchise_name/,
  );
});

test("franchise_conquest posts the card in the completions channel and acks", async () => {
  const deps = fakeDeps();
  const acks = await run(deps);

  assert.equal(acks[0]?.status, "done", JSON.stringify(acks));
  assert.deepEqual(deps.posts.map((p) => p.channelId), [WHATCHA_PLAYING_CHANNEL_ID]);
});

test("franchise_conquest in Preview posts in the bot-dev channel", async () => {
  const deps = fakeDeps();
  const acks = await run(deps, "preview");

  assert.equal(acks[0]?.status, "done", JSON.stringify(acks));
  assert.deepEqual(deps.posts.map((p) => p.channelId), [BOT_DEV_CHANNEL_ID]);
});

test("franchise_conquest with the Feature Off acks without posting", async () => {
  const deps = fakeDeps();
  const acks = await run(deps, "off");

  assert.deepEqual(acks, [{
    id: 7,
    status: "done",
    resultText: "Not posted: the franchise_progress Feature is Off.",
  }]);
  assert.deepEqual(deps.posts, []);
});
