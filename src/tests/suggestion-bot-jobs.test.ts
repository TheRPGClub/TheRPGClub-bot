import assert from "node:assert/strict";
import test from "node:test";
import { AxiosError, AxiosHeaders } from "axios";
import type { ISuggestionItem } from "../classes/Suggestion.js";
import { BOT_JOB_HANDLERS, type IBotJobSurface } from "../services/BotJobHandlers.js";
import { processBotJobs } from "../services/BotJobService.js";
import type { IBotJob, IBotJobApi } from "../classes/BotJobs.js";
import { BOT_DEV_CHANNEL_ID, GAMEDB_UPDATES_CHANNEL_ID } from "../config/channels.js";
import { BOT_DEV_PING_USER_ID } from "../config/users.js";

type Ack = { id: number; status: "done" } | { id: number; status: "failed"; error: string };

function fakeApi(): IBotJobApi & { acks: Ack[] } {
  const acks: Ack[] = [];
  return {
    acks,
    claim: async () => [],
    done: async (id) => {
      acks.push({ id, status: "done" });
    },
    failed: async (id, error) => {
      acks.push({ id, status: "failed", error });
    },
  };
}

interface ISuggestionSurface extends IBotJobSurface {
  posts: { channelId: string; content: string }[];
  pings: (readonly string[])[];
  suggestionFetches: number[];
}

function storedSuggestion(overrides: Partial<ISuggestionItem> = {}): ISuggestionItem {
  return {
    suggestionId: 7,
    title: "Dark mode",
    details: "Please",
    labels: "New Feature",
    createdBy: "author-1",
    createdByName: "Ayla",
    status: "pending",
    createdAt: new Date("2026-11-01T10:00:00Z"),
    updatedAt: new Date("2026-11-01T10:00:00Z"),
    ...overrides,
  };
}

function fakeSurface(options: {
  suggestion?: ISuggestionItem | null;
  fetchError?: unknown;
  postError?: unknown;
} = {}): ISuggestionSurface {
  const suggestion = options.suggestion === undefined ? storedSuggestion() : options.suggestion;
  const surface: ISuggestionSurface = {
    posts: [],
    pings: [],
    suggestionFetches: [],
    requestVotingEventPoll: () => {},
    fetchGameKey: async () => null,
    runGiveawayClaimSideEffects: async () => "",
    sendDm: async () => {},
    refreshGiveawayHub: async () => {},
    fetchSuggestion: async (id) => {
      surface.suggestionFetches.push(id);
      if (options.fetchError) throw options.fetchError;
      return suggestion;
    },
    sendChannelMessage: async (channelId, content, pingUserIds) => {
      if (options.postError) throw options.postError;
      surface.posts.push({ channelId, content });
      surface.pings.push(pingUserIds);
    },
    fetchCompletionForUser: async () => null,
    fetchGame: async () => null,
    announceCompletion: async () => {},
  };
  return surface;
}

function job(id: number, kind: string, payload: Record<string, unknown>): IBotJob {
  return { id, kind, payload, attempts: 1, requestedByUserId: null };
}

async function run(surface: IBotJobSurface, jobs: IBotJob[]): Promise<Ack[]> {
  const api = fakeApi();
  await processBotJobs(jobs, BOT_JOB_HANDLERS, surface, api);
  return api.acks;
}

function failure(acks: Ack[]): string {
  const [ack] = acks;
  assert.equal(ack?.status, "failed");
  return ack.status === "failed" ? ack.error : "";
}

const approvedPayload = {
  suggestion_id: 7,
  outcome: "approved",
  created_by: "author-1",
  title: "Dark mode",
  github_issue_number: 321,
  github_issue_url: "https://github.com/TheRPGClub/TheRPGClub-www/issues/321",
  rejection_reason: null,
};

const rejectedPayload = {
  suggestion_id: 7,
  outcome: "rejected",
  created_by: "author-1",
  title: "Dark mode",
  github_issue_number: null,
  github_issue_url: null,
  rejection_reason: "Out of scope",
};

test("submitted ping names the author and pings the bot dev in the bot dev channel", async () => {
  const surface = fakeSurface();
  const acks = await run(surface, [
    job(1, "suggestion_submitted", { suggestion_id: 7, created_by: "author-1" }),
  ]);
  assert.deepEqual(acks, [{ id: 1, status: "done" }]);
  assert.deepEqual(surface.suggestionFetches, [7]);
  assert.deepEqual(surface.posts, [{
    channelId: BOT_DEV_CHANNEL_ID,
    content: `<@${BOT_DEV_PING_USER_ID}> Ayla has submitted a suggestion!`,
  }]);
});

test("submitted ping mentions the author when the suggestion has no name", async () => {
  const surface = fakeSurface({ suggestion: storedSuggestion({ createdByName: null }) });
  await run(surface, [
    job(1, "suggestion_submitted", { suggestion_id: 7, created_by: "author-1" }),
  ]);
  assert.equal(
    surface.posts[0]?.content,
    `<@${BOT_DEV_PING_USER_ID}> <@author-1> has submitted a suggestion!`,
  );
});

test("submitted ping fails the job when the suggestion is gone", async () => {
  const surface = fakeSurface({ suggestion: null });
  const acks = await run(surface, [
    job(1, "suggestion_submitted", { suggestion_id: 7, created_by: "author-1" }),
  ]);
  assert.match(failure(acks), /Suggestion 7 no longer exists/);
  assert.equal(surface.posts.length, 0);
});

test("submitted ping rejects a payload without a suggestion id", async () => {
  const surface = fakeSurface();
  const acks = await run(surface, [job(1, "suggestion_submitted", { created_by: "a" })]);
  assert.match(failure(acks), /suggestion_id must be a positive integer/);
  assert.equal(surface.suggestionFetches.length, 0);
});

test("submitted ping reports the API request and response when the fetch fails", async () => {
  const request = { method: "get", url: "/api/v1/suggestions/7", data: undefined };
  const response: any = {
    status: 500,
    statusText: "Internal Server Error",
    data: { error: "boom" },
    headers: {},
    config: { ...request, headers: new AxiosHeaders() },
  };
  const err = new AxiosError("Request failed", "ERR_BAD_RESPONSE", response.config, null,
    response);
  const surface = fakeSurface({ fetchError: err });
  const acks = await run(surface, [
    job(1, "suggestion_submitted", { suggestion_id: 7, created_by: "author-1" }),
  ]);
  const error = failure(acks);
  assert.match(error, /\/api\/v1\/suggestions\/7/);
  assert.match(error, /boom/);
});

test("approved outcome mentions the author with the GitHub issue", async () => {
  const surface = fakeSurface();
  const acks = await run(surface, [job(1, "suggestion_outcome", approvedPayload)]);
  assert.deepEqual(acks, [{ id: 1, status: "done" }]);
  assert.deepEqual(surface.posts, [{
    channelId: GAMEDB_UPDATES_CHANNEL_ID,
    content: "<@author-1> Your suggestion was accepted and logged as GitHub issue #321: " +
      "https://github.com/TheRPGClub/TheRPGClub-www/issues/321",
  }]);
});

test("rejected outcome mentions the author with the title and reason", async () => {
  const surface = fakeSurface();
  await run(surface, [job(1, "suggestion_outcome", rejectedPayload)]);
  assert.deepEqual(surface.posts, [{
    channelId: GAMEDB_UPDATES_CHANNEL_ID,
    content: "<@author-1> Your suggestion \"Dark mode\" was not accepted. Reason: Out of scope",
  }]);
});

test("outcome without an author says Unknown user", async () => {
  const surface = fakeSurface();
  await run(surface, [job(1, "suggestion_outcome", { ...rejectedPayload, created_by: null })]);
  assert.match(surface.posts[0]?.content ?? "", /^Unknown user Your suggestion "Dark mode"/);
});

test("outcome never fetches the suggestion: the payload carries everything", async () => {
  const surface = fakeSurface();
  await run(surface, [job(1, "suggestion_outcome", approvedPayload)]);
  assert.equal(surface.suggestionFetches.length, 0);
});

test("outcome rejects an unknown outcome value", async () => {
  const surface = fakeSurface();
  const acks = await run(surface, [
    job(1, "suggestion_outcome", { ...approvedPayload, outcome: "withdrawn" }),
  ]);
  assert.match(failure(acks), /outcome must be "approved" or "rejected"/);
  assert.equal(surface.posts.length, 0);
});

test("approved outcome rejects a payload without the issue url", async () => {
  const surface = fakeSurface();
  const acks = await run(surface, [
    job(1, "suggestion_outcome", { ...approvedPayload, github_issue_url: null }),
  ]);
  assert.match(failure(acks), /github_issue_url must be a non-empty string/);
});

test("rejected outcome rejects a payload without a reason", async () => {
  const surface = fakeSurface();
  const acks = await run(surface, [
    job(1, "suggestion_outcome", { ...rejectedPayload, rejection_reason: null }),
  ]);
  assert.match(failure(acks), /rejection_reason must be a non-empty string/);
});

test("outcome fails the job when Discord refuses the post", async () => {
  const surface = fakeSurface({ postError: new Error("Missing Access") });
  const acks = await run(surface, [job(1, "suggestion_outcome", approvedPayload)]);
  assert.match(failure(acks), /Missing Access/);
});

test("website text in an outcome post can only ping the author", async () => {
  // The title and reason come from the website, which /suggestion's sanitizer never sees.
  const surface = fakeSurface();
  await run(surface, [job(1, "suggestion_outcome", {
    ...rejectedPayload,
    title: "@everyone free keys",
    rejection_reason: "<@&123> see <@999>",
  })]);
  assert.deepEqual(surface.pings, [["author-1"]]);
});

test("an outcome post without an author pings nobody", async () => {
  const surface = fakeSurface();
  await run(surface, [job(1, "suggestion_outcome", { ...approvedPayload, created_by: null })]);
  assert.deepEqual(surface.pings, [[]]);
});

test("a submitted ping can only ping the bot dev and the author", async () => {
  const surface = fakeSurface({ suggestion: storedSuggestion({ createdByName: "@everyone" }) });
  await run(surface, [
    job(1, "suggestion_submitted", { suggestion_id: 7, created_by: "author-1" }),
  ]);
  assert.deepEqual(surface.pings, [[BOT_DEV_PING_USER_ID, "author-1"]]);
});

test("a rejected notice fits Discord's 2000 character limit", async () => {
  // The API caps neither the title nor a website reviewer's reason.
  const surface = fakeSurface();
  const acks = await run(surface, [job(1, "suggestion_outcome", {
    ...rejectedPayload,
    title: "t".repeat(600),
    rejection_reason: "r".repeat(2000),
  })]);
  assert.deepEqual(acks, [{ id: 1, status: "done" }]);
  const content = surface.posts[0]?.content ?? "";
  assert.ok(content.length <= 2000, `posted ${content.length} characters`);
  assert.match(content, /^<@author-1> Your suggestion "t+\.\.\." was not accepted\. Reason: r+/);
});
