import assert from "node:assert/strict";
import test from "node:test";
import type { IBotJob, IBotJobApi } from "../classes/BotJobs.js";
import { BOT_DEV_CHANNEL_ID, FUN_FACT_CHANNEL_ID } from "../config/channels.js";
import type { FeatureState } from "../functions/FeatureGate.js";
import { BOT_JOB_HANDLERS, type IBotJobSurface } from "../services/BotJobHandlers.js";
import { processBotJobs } from "../services/BotJobService.js";
import type { ICodexEntry, IFunFactApi } from "../services/CodexApi.js";
import {
  drawFunFactReply,
  type ICodexJobDeps,
  type IFunFactPost,
} from "../services/CodexFunFactPosts.js";
import { apiError, buttonsOf, textOf } from "./challengeFixtures.js";

// The Daily Fun Fact BotJob and /funfact (bot#1562): design 1B, the pink card. The API
// draws the Fun Fact; the bot reads it back, posts it, and never pings anyone.

const AUTHOR = "222";
const MENTIONED = "333";

function funFact(overrides: Partial<ICodexEntry> = {}): ICodexEntry {
  return {
    id: 5,
    part: "fun_fact",
    title: null,
    rich_body: null,
    body: `<@${MENTIONED}> was first called Sir Grindsalot.`,
    occurred_on: null,
    date_precision: null,
    kind: null,
    author: { user_id: AUTHOR, name: "Lufia", avatar_url: `/api/v1/users/${AUTHOR}/avatar` },
    mentions: {
      [MENTIONED]: {
        user_id: MENTIONED,
        name: "Kaiserkaze",
        avatar_url: `/api/v1/users/${MENTIONED}/avatar`,
      },
    },
    images: [],
    links: [],
    viewer: { can_edit: false, can_delete: false },
    created_at: "2026-11-18T14:00:00.000Z",
    updated_at: "2026-11-18T14:00:00.000Z",
    ...overrides,
  };
}

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

interface IFakeCodexDeps extends ICodexJobDeps {
  posts: { channelId: string; post: IFunFactPost }[];
  reads: number[];
}

/** 15:00 in New York on 18 November 2026. */
const DAILY_RUN = new Date("2026-11-18T20:00:00.000Z");

function fakeDeps(facts: ICodexEntry[], now: Date = DAILY_RUN): IFakeCodexDeps {
  const deps: IFakeCodexDeps = {
    posts: [],
    reads: [],
    fetchFunFact: async (id) => {
      deps.reads.push(id);
      return facts.find((f) => f.id === id) ?? null;
    },
    postMessage: async (channelId, post) => {
      deps.posts.push({ channelId, post });
    },
    now: () => now,
  };
  return deps;
}

function surface(codex: ICodexJobDeps, state: FeatureState | null): IBotJobSurface {
  return { codex, featureState: async () => state } as unknown as IBotJobSurface;
}

function daily(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { club_date: "2026-11-18", entry_id: 5, feature_key: "club_codex", ...extra };
}

async function runDaily(
  deps: ICodexJobDeps,
  payload: Record<string, unknown> = daily(),
  state: FeatureState | null = "live",
): Promise<Ack[]> {
  const api = fakeJobApi();
  const job: IBotJob = { id: 1, kind: "daily_fun_fact", payload, attempts: 1,
    requestedByUserId: null };
  await processBotJobs([job], BOT_JOB_HANDLERS, surface(deps, state), api);
  return api.acks;
}

function doneText(acks: Ack[]): string {
  const ack = acks[0];
  assert.equal(ack?.status, "done", JSON.stringify(acks));
  return ack.status === "done" ? ack.resultText ?? "" : "";
}

test("daily_fun_fact posts the Fun Fact once in general chat as the pink card", async () => {
  const deps = fakeDeps([funFact()]);
  const acks = await runDaily(deps);

  assert.match(doneText(acks), /Fun Fact 5/);
  assert.deepEqual(deps.reads, [5]);
  assert.equal(deps.posts.length, 1);
  const [{ channelId, post }] = deps.posts;
  assert.equal(channelId, FUN_FACT_CHANNEL_ID);
  assert.equal(
    textOf(post.components),
    [
      "-# Daily Fun Fact",
      `## <@${MENTIONED}> was first called Sir Grindsalot.`,
      `-# Added by <@${AUTHOR}>`,
    ].join("\n"),
  );
  assert.deepEqual(post.allowedMentions, { parse: [] });
  assert.deepEqual(buttonsOf(post.components), []);
});

test("daily_fun_fact drops a job whose club day has passed in New York, unposted", async () => {
  // 00:30 on 19 November in New York: the 18 November job came too late.
  const deps = fakeDeps([funFact()], new Date("2026-11-19T05:30:00.000Z"));
  const acks = await runDaily(deps);

  assert.match(doneText(acks), /^Not posted: the Daily Fun Fact for 2026-11-18 is stale/);
  assert.deepEqual(deps.reads, []);
  assert.deepEqual(deps.posts, []);
});

test("daily_fun_fact still posts late on its own club day in New York", async () => {
  // 23:30 on 18 November in New York is already 19 November in UTC.
  const deps = fakeDeps([funFact()], new Date("2026-11-19T04:30:00.000Z"));
  await runDaily(deps);

  assert.equal(deps.posts.length, 1);
});

test("daily_fun_fact drops a job whose Fun Fact was deleted since, unposted", async () => {
  const deps = fakeDeps([]);
  const acks = await runDaily(deps);

  assert.match(doneText(acks), /^Not posted: Fun Fact 5 was deleted/);
  assert.deepEqual(deps.reads, [5]);
  assert.deepEqual(deps.posts, []);
});

test("daily_fun_fact: Read the story opens the linked Lore Entry's page", async () => {
  const deps = fakeDeps([funFact({
    links: [
      { id: 2, part: "history_event", title: "The 2020 wipe" },
      { id: 9, part: "lore_entry", title: "The pineapple pizza poll" },
    ],
  })]);
  await runDaily(deps);

  assert.deepEqual(
    buttonsOf(deps.posts[0]?.post.components).map((b) => [b.label, b.url]),
    [["Read the story", "https://the-rpg-club-www.vercel.app/codex/lore/9"]],
  );
});

test("daily_fun_fact: no Read the story when it links to no Lore Entry", async () => {
  const deps = fakeDeps([funFact({
    links: [{ id: 2, part: "history_event", title: "The 2020 wipe" }],
  })]);
  await runDaily(deps);

  assert.deepEqual(buttonsOf(deps.posts[0]?.post.components), []);
});

test("daily_fun_fact: Preview posts in the bot-dev channel and says so", async () => {
  const deps = fakeDeps([funFact()]);
  const acks = await runDaily(deps, daily(), "preview");

  assert.deepEqual(deps.posts.map((p) => p.channelId), [BOT_DEV_CHANNEL_ID]);
  assert.match(doneText(acks), /^Preview: posted to the bot-dev channel instead\./);
});

test("daily_fun_fact: Off posts nothing and reads nothing", async () => {
  const deps = fakeDeps([funFact()]);
  const acks = await runDaily(deps, daily(), "off");

  assert.equal(doneText(acks), "Not posted: the club_codex Feature is Off.");
  assert.deepEqual(deps.reads, []);
  assert.deepEqual(deps.posts, []);
});

test("daily_fun_fact fails a payload with no usable club date", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const deps = fakeDeps([funFact()]);
  const acks = await runDaily(deps, daily({ club_date: "18 November" }));

  assert.equal(acks[0]?.status, "failed");
  assert.deepEqual(deps.posts, []);
});

test("daily_fun_fact: a multi-line Fun Fact heads every line", async () => {
  const deps = fakeDeps([funFact({ body: "First line.\n\nSecond line." })]);
  await runDaily(deps);

  assert.match(textOf(deps.posts[0]?.post.components), /^## First line\.\n## Second line\.$/m);
});

/** A Fun Fact API that only draws: the next Fun Fact, or null, or the error. */
function drawingApi(drawn: ICodexEntry | null, error?: unknown): IFunFactApi & {
  draws: string[];
} {
  const unused = async (): Promise<never> => {
    throw new Error("/funfact only draws.");
  };
  const api = {
    draws: [] as string[],
    list: unused,
    get: unused,
    create: unused,
    edit: unused,
    remove: unused,
    draw: async (actingUserId: string) => {
      api.draws.push(actingUserId);
      if (error) throw error;
      return drawn;
    },
  };
  return api;
}

const ASKER = "444";

test("/funfact draws as the member and posts the card for all, crediting the author", async () => {
  const api = drawingApi(funFact({
    links: [{ id: 9, part: "lore_entry", title: "The pineapple pizza poll" }],
  }));
  const reply = await drawFunFactReply({ actingUserId: ASKER }, { api });

  assert.deepEqual(api.draws, [ASKER]);
  assert.ok("post" in reply, JSON.stringify(reply));
  assert.equal(
    textOf(reply.post.components),
    [
      "-# Fun Fact",
      `## <@${MENTIONED}> was first called Sir Grindsalot.`,
      `-# Added by <@${AUTHOR}>`,
    ].join("\n"),
  );
  assert.ok(!textOf(reply.post.components).includes(ASKER), "the asker is not named");
  assert.deepEqual(reply.post.allowedMentions, { parse: [] });
  assert.deepEqual(
    buttonsOf(reply.post.components).map((b) => b.label),
    ["Read the story"],
  );
});

test("/funfact with no Fun Facts replies privately that there aren't any yet", async () => {
  const reply = await drawFunFactReply({ actingUserId: ASKER }, { api: drawingApi(null) });

  assert.ok("empty" in reply, JSON.stringify(reply));
  assert.match(textOf(reply.empty.components), /^There aren't any Fun Facts yet\./);
  assert.match(textOf(reply.empty.components), /\/codex fun-fact add/);
  assert.ok((reply.empty.flags & 64) !== 0, "the reply is private");
});

test("/funfact shows a failed draw privately with the request and the response", async () => {
  const error = apiError(
    500,
    { error: "boom" },
    {
      method: "post",
      url: "/api/v1/codex/fun_facts/draw",
      data: { data: { acting_user_id: ASKER } },
    },
  );
  const reply = await drawFunFactReply({ actingUserId: ASKER }, {
    api: drawingApi(null, error),
  });

  assert.ok("error" in reply, JSON.stringify(reply));
  assert.match(reply.error, /^Could not draw a Fun Fact\./);
  assert.match(reply.error, /\/api\/v1\/codex\/fun_facts\/draw/);
  assert.match(reply.error, /"boom"/);
});
