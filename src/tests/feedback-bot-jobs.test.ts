import assert from "node:assert/strict";
import test from "node:test";
import { AxiosError, AxiosHeaders } from "axios";
import type { IFeedbackItem } from "../classes/Feedback.js";
import { BOT_JOB_HANDLERS, type IBotJobSurface } from "../services/BotJobHandlers.js";
import { processBotJobs } from "../services/BotJobService.js";
import type { IBotJob, IBotJobApi } from "../classes/BotJobs.js";
import { BOT_DEV_CHANNEL_ID, GAMEDB_UPDATES_CHANNEL_ID } from "../config/channels.js";
import { BOT_DEV_PING_USER_ID } from "../config/users.js";
import { feedbackBoardUrl } from "../config/website.js";

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

interface IFeedbackSurface extends IBotJobSurface {
  posts: { channelId: string; content: string }[];
  pings: (readonly string[])[];
  feedbackFetches: number[];
}

function storedFeedback(overrides: Partial<IFeedbackItem> = {}): IFeedbackItem {
  return {
    feedbackId: 7,
    kind: "feature_request",
    title: "Dark mode",
    details: "Please",
    createdBy: "author-1",
    createdByName: "Ayla",
    status: "pending",
    createdAt: new Date("2026-11-01T10:00:00Z"),
    updatedAt: new Date("2026-11-01T10:00:00Z"),
    ...overrides,
  };
}

function fakeSurface(options: {
  feedback?: IFeedbackItem | null;
  fetchError?: unknown;
  postError?: unknown;
} = {}): IFeedbackSurface {
  const feedback = options.feedback === undefined ? storedFeedback() : options.feedback;
  const surface: IFeedbackSurface = {
    posts: [],
    pings: [],
    feedbackFetches: [],
    requestVotingEventPoll: () => {},
    fetchGameKey: async () => null,
    runGiveawayClaimSideEffects: async () => "",
    sendDm: async () => {},
    refreshGiveawayHub: async () => {},
    fetchFeedback: async (id) => {
      surface.feedbackFetches.push(id);
      if (options.fetchError) throw options.fetchError;
      return feedback;
    },
    sendChannelMessage: async (channelId, content, pingUserIds) => {
      if (options.postError) throw options.postError;
      surface.posts.push({ channelId, content });
      surface.pings.push(pingUserIds);
    },
    reloadGotmRound: async () => {},
    announceNominationChange: async () => {},
    fetchCompletionForUser: async () => null,
    publishVotingResults: async () => {},
    repostVotingPanels: async () => ({ status: "no_round" }),
    announceTieBreak: async () => [],
    fetchGame: async () => null,
    announceCompletion: async () => {},
    fetchLiveEvent: async () => null,
    recordLiveEventStep: async () => {},
    fetchLiveEventImage: async () => Buffer.alloc(0),
    createLiveEventThread: async () => "",
    createLiveEventScheduledEvent: async () => "",
    applyLatestPresence: async () => {},
    sendSayMessage: async () => {},
    sharedStateRefusal: () => null,
    runMemberScan: async () => ({ upserted: 0, failed: 0, departed: 0 }),
    featureState: async () => null,
    featureFlagsChanged: () => undefined,
    giveawayHubLeftPreview: async () => undefined,
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
  feedback_id: 7, kind: "feature_request",
  outcome: "approved",
  created_by: "author-1",
  title: "Dark mode",
  github_issue_number: 321,
  github_issue_url: "https://github.com/TheRPGClub/TheRPGClub-www/issues/321",
  rejection_reason: null,
};

const duplicatePayload = {
  feedback_id: 7, kind: "bug_report",
  outcome: "duplicate",
  created_by: "author-1",
  title: "Login loops",
  github_issue_number: null,
  github_issue_url: null,
  rejection_reason: null,
  duplicate_of_id: 3,
  duplicate_of_title: "Login redirects forever",
};

const donePayload = {
  feedback_id: 7, kind: "suggestion",
  outcome: "done",
  created_by: "author-1",
  title: "Bigger covers",
  github_issue_number: 321,
  github_issue_url: "https://github.com/TheRPGClub/TheRPGClub-www/issues/321",
  rejection_reason: null,
};

const rejectedPayload = {
  feedback_id: 7, kind: "feature_request",
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
    job(1, "feedback_submitted", {
      feedback_id: 7, kind: "feature_request", created_by: "author-1",
    }),
  ]);
  assert.deepEqual(acks, [{ id: 1, status: "done" }]);
  assert.deepEqual(surface.feedbackFetches, [7]);
  assert.deepEqual(surface.posts, [{
    channelId: BOT_DEV_CHANNEL_ID,
    content: `<@${BOT_DEV_PING_USER_ID}> Ayla has submitted a feature request!`,
  }]);
});

test("submitted ping mentions the author when the Feedback has no name", async () => {
  const surface = fakeSurface({ feedback: storedFeedback({ createdByName: null }) });
  await run(surface, [
    job(1, "feedback_submitted", {
      feedback_id: 7, kind: "feature_request", created_by: "author-1",
    }),
  ]);
  assert.equal(
    surface.posts[0]?.content,
    `<@${BOT_DEV_PING_USER_ID}> <@author-1> has submitted a feature request!`,
  );
});

test("submitted ping fails the job when the Feedback is gone", async () => {
  const surface = fakeSurface({ feedback: null });
  const acks = await run(surface, [
    job(1, "feedback_submitted", {
      feedback_id: 7, kind: "feature_request", created_by: "author-1",
    }),
  ]);
  assert.match(failure(acks), /Feedback 7 no longer exists/);
  assert.equal(surface.posts.length, 0);
});

test("submitted ping rejects a payload without a feedback id", async () => {
  const surface = fakeSurface();
  const acks = await run(surface, [job(1, "feedback_submitted", { created_by: "a" })]);
  assert.match(failure(acks), /feedback_id must be a positive integer/);
  assert.equal(surface.feedbackFetches.length, 0);
});

test("submitted ping reports the API request and response when the fetch fails", async () => {
  const request = { method: "get", url: "/api/v1/feedback/7", data: undefined };
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
    job(1, "feedback_submitted", {
      feedback_id: 7, kind: "feature_request", created_by: "author-1",
    }),
  ]);
  const error = failure(acks);
  assert.match(error, /\/api\/v1\/feedback\/7/);
  assert.match(error, /boom/);
});

test("approved outcome mentions the author with the GitHub issue", async () => {
  const surface = fakeSurface();
  const acks = await run(surface, [job(1, "feedback_outcome", approvedPayload)]);
  assert.deepEqual(acks, [{ id: 1, status: "done" }]);
  assert.deepEqual(surface.posts, [{
    channelId: GAMEDB_UPDATES_CHANNEL_ID,
    content: "<@author-1> Your feature request was accepted and logged as GitHub issue #321: " +
      "https://github.com/TheRPGClub/TheRPGClub-www/issues/321",
  }]);
});

test("rejected outcome mentions the author with the title and reason", async () => {
  const surface = fakeSurface();
  await run(surface, [job(1, "feedback_outcome", rejectedPayload)]);
  assert.deepEqual(surface.posts, [{
    channelId: GAMEDB_UPDATES_CHANNEL_ID,
    content: "<@author-1> Your feature request \"Dark mode\" was not accepted. Reason: Out of scope",
  }]);
});

test("outcome without an author says Unknown user", async () => {
  const surface = fakeSurface();
  await run(surface, [job(1, "feedback_outcome", { ...rejectedPayload, created_by: null })]);
  assert.match(surface.posts[0]?.content ?? "", /^Unknown user Your feature request "Dark mode"/);
});

test("outcome never fetches the Feedback: the payload carries everything", async () => {
  const surface = fakeSurface();
  await run(surface, [job(1, "feedback_outcome", approvedPayload)]);
  assert.equal(surface.feedbackFetches.length, 0);
});

test("outcome rejects an unknown outcome value", async () => {
  const surface = fakeSurface();
  const acks = await run(surface, [
    job(1, "feedback_outcome", { ...approvedPayload, outcome: "withdrawn" }),
  ]);
  assert.match(failure(acks), /outcome must be "approved", "rejected", "duplicate" or "done"/);
  assert.equal(surface.posts.length, 0);
});

test("approved outcome rejects a payload without the issue url", async () => {
  const surface = fakeSurface();
  const acks = await run(surface, [
    job(1, "feedback_outcome", { ...approvedPayload, github_issue_url: null }),
  ]);
  assert.match(failure(acks), /github_issue_url must be a non-empty string/);
});

test("rejected outcome rejects a payload without a reason", async () => {
  const surface = fakeSurface();
  const acks = await run(surface, [
    job(1, "feedback_outcome", { ...rejectedPayload, rejection_reason: null }),
  ]);
  assert.match(failure(acks), /rejection_reason must be a non-empty string/);
});

test("outcome fails the job when Discord refuses the post", async () => {
  const surface = fakeSurface({ postError: new Error("Missing Access") });
  const acks = await run(surface, [job(1, "feedback_outcome", approvedPayload)]);
  assert.match(failure(acks), /Missing Access/);
});

test("website text in an outcome post can only ping the author", async () => {
  // The title and reason come from the website, which /feedback's sanitizer never sees.
  const surface = fakeSurface();
  await run(surface, [job(1, "feedback_outcome", {
    ...rejectedPayload,
    title: "@everyone free keys",
    rejection_reason: "<@&123> see <@999>",
  })]);
  assert.deepEqual(surface.pings, [["author-1"]]);
});

test("an outcome post without an author pings nobody", async () => {
  const surface = fakeSurface();
  await run(surface, [job(1, "feedback_outcome", { ...approvedPayload, created_by: null })]);
  assert.deepEqual(surface.pings, [[]]);
});

test("a submitted ping can only ping the bot dev and the author", async () => {
  const surface = fakeSurface({ feedback: storedFeedback({ createdByName: "@everyone" }) });
  await run(surface, [
    job(1, "feedback_submitted", {
      feedback_id: 7, kind: "feature_request", created_by: "author-1",
    }),
  ]);
  assert.deepEqual(surface.pings, [[BOT_DEV_PING_USER_ID, "author-1"]]);
});

test("a rejected notice fits Discord's 2000 character limit", async () => {
  // The API caps neither the title nor a website reviewer's reason.
  const surface = fakeSurface();
  const acks = await run(surface, [job(1, "feedback_outcome", {
    ...rejectedPayload,
    title: "t".repeat(600),
    rejection_reason: "r".repeat(2000),
  })]);
  assert.deepEqual(acks, [{ id: 1, status: "done" }]);
  const content = surface.posts[0]?.content ?? "";
  assert.ok(content.length <= 2000, `posted ${content.length} characters`);
  assert.match(content, /^<@author-1> Your feature request "t+\.\.\." was not accepted\. /);
  assert.match(content, /Reason: r+/);
});

test("submitted ping names the Feedback's kind", async () => {
  const surface = fakeSurface({ feedback: storedFeedback({ kind: "bug_report" }) });
  await run(surface, [
    job(1, "feedback_submitted", { feedback_id: 7, kind: "bug_report", created_by: "author-1" }),
  ]);
  assert.equal(
    surface.posts[0]?.content,
    `<@${BOT_DEV_PING_USER_ID}> Ayla has submitted a bug report!`,
  );
});

test("approved and rejected notices name each kind", async () => {
  for (const [kind, noun] of [
    ["feature_request", "feature request"],
    ["suggestion", "suggestion"],
    ["bug_report", "bug report"],
  ] as const) {
    const surface = fakeSurface();
    await run(surface, [
      job(1, "feedback_outcome", { ...approvedPayload, kind }),
      job(2, "feedback_outcome", { ...rejectedPayload, kind }),
    ]);
    assert.match(surface.posts[0]?.content ?? "", new RegExp(`^<@author-1> Your ${noun} was accepted`));
    assert.match(surface.posts[1]?.content ?? "", new RegExp(`^<@author-1> Your ${noun} "Dark mode"`));
  }
});

test("an outcome for an unknown kind says feedback", async () => {
  const surface = fakeSurface();
  await run(surface, [job(1, "feedback_outcome", { ...approvedPayload, kind: "praise" })]);
  assert.match(surface.posts[0]?.content ?? "", /^<@author-1> Your feedback was accepted/);
});

test("duplicate outcome names the original, its upvotes moved, and links the Board", async () => {
  const surface = fakeSurface();
  const acks = await run(surface, [job(1, "feedback_outcome", duplicatePayload)]);
  assert.deepEqual(acks, [{ id: 1, status: "done" }]);
  assert.deepEqual(surface.posts, [{
    channelId: GAMEDB_UPDATES_CHANNEL_ID,
    content: "<@author-1> Your bug report \"Login loops\" was marked a duplicate of " +
      "\"Login redirects forever\". Its upvotes moved there. " +
      feedbackBoardUrl(3),
  }]);
  assert.ok(feedbackBoardUrl(3).endsWith("/feedback?pinned=3"));
  assert.doesNotMatch(surface.posts[0]?.content ?? "", /Your upvote/);
  assert.deepEqual(surface.pings, [["author-1"]]);
});

test("duplicate outcome rejects a payload without the original", async () => {
  const surface = fakeSurface();
  const noId = await run(surface, [
    job(1, "feedback_outcome", { ...duplicatePayload, duplicate_of_id: null }),
  ]);
  assert.match(failure(noId), /duplicate_of_id must be a positive integer/);
  const noTitle = await run(surface, [
    job(2, "feedback_outcome", { ...duplicatePayload, duplicate_of_title: null }),
  ]);
  assert.match(failure(noTitle), /duplicate_of_title must be a non-empty string/);
  assert.equal(surface.posts.length, 0);
});

test("done outcome celebrates with the GitHub issue", async () => {
  const surface = fakeSurface();
  const acks = await run(surface, [job(1, "feedback_outcome", donePayload)]);
  assert.deepEqual(acks, [{ id: 1, status: "done" }]);
  assert.deepEqual(surface.posts, [{
    channelId: GAMEDB_UPDATES_CHANNEL_ID,
    content: "<@author-1> Your suggestion \"Bigger covers\" is done! 🎉 GitHub issue #321: " +
      "https://github.com/TheRPGClub/TheRPGClub-www/issues/321",
  }]);
});

test("done outcome rejects a payload without the issue url", async () => {
  const surface = fakeSurface();
  const acks = await run(surface, [
    job(1, "feedback_outcome", { ...donePayload, github_issue_url: null }),
  ]);
  assert.match(failure(acks), /github_issue_url must be a non-empty string/);
});

test("duplicate and done notices with long titles fit one Discord message", async () => {
  const surface = fakeSurface();
  const long = "t".repeat(3000);
  const acks = await run(surface, [
    job(1, "feedback_outcome", { ...duplicatePayload, title: long, duplicate_of_title: long }),
    job(2, "feedback_outcome", { ...donePayload, title: long }),
  ]);
  assert.deepEqual(acks, [{ id: 1, status: "done" }, { id: 2, status: "done" }]);
  for (const post of surface.posts) {
    assert.ok(post.content.length <= 2000, `posted ${post.content.length} characters`);
    assert.match(post.content, /"t+\.\.\."/);
  }
});
