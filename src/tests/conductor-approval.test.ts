import test from "node:test";
import assert from "node:assert/strict";
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from "axios";

import {
  CONDUCTOR_APPROVAL_MARKER,
  buildApprovalBody,
  decideApproval,
} from "../conductor/ConductorApproval.js";
import type { StepVerdict } from "../conductor/ConductorObservation.js";
import { publishRunResult, type PublishClient } from "../conductor/ConductorPublish.js";
import type { IConductorRun } from "../conductor/ConductorState.js";
import { GitHubPullClient, type IPullRequestInfo } from "../conductor/GitHubPullClient.js";

const HEAD = "0123456789abcdef0123456789abcdef01234567";
const REPO = { owner: "TheRPGClub", name: "TheRPGClub-bot" };

function run(verdicts: StepVerdict[], overrides: Partial<IConductorRun> = {}): IConductorRun {
  return {
    runId: "555",
    pr: 1354,
    headSha: HEAD,
    steps: [1, 2].map((number) => ({
      number,
      label: `Step ${number}`,
      command: `/command${number}`,
      expected: "It works",
      ephemeral: false,
    })),
    current: 2,
    windowStart: 0,
    results: verdicts.map((verdict, index) => ({
      stepNumber: index + 1,
      verdict,
      reason: "checked",
      observed: [],
      unattributed: [],
    })),
    status: "finished",
    ...overrides,
  };
}

function pull(overrides: Partial<IPullRequestInfo> = {}): IPullRequestInfo {
  return {
    number: 1354,
    state: "open",
    headSha: HEAD,
    body: "",
    htmlUrl: "https://example.test/pr",
    authorLogin: "author",
    ...overrides,
  };
}

test("a finished run with every step passed approves", () => {
  assert.deepEqual(decideApproval(run(["pass", "pass"]), pull(), "conductor"), {
    kind: "approve",
  });
});

const NOT_PASSED: [string, IConductorRun][] = [
  ["a failed step", run(["pass", "fail"])],
  ["a step that needs eyes", run(["pass", "unverified"])],
  ["an aborted run", run(["pass", "pass"], { status: "aborted" })],
  ["a run missing a step's result", run(["pass"])],
];

for (const [name, value] of NOT_PASSED) {
  test(`${name} does not approve`, () => {
    assert.deepEqual(decideApproval(value, pull(), "conductor"), { kind: "not-passed" });
  });
}

test("a head that moved since the run started skips the approval", () => {
  const moved = "fedcba9876543210fedcba9876543210fedcba98";
  const decision = decideApproval(run(["pass", "pass"]), pull({ headSha: moved }), "conductor");
  assert.equal(decision.kind, "skip");
  assert.match(decision.kind === "skip" ? decision.reason : "", /0123456.*fedcba9/);
});

test("a token that opened the PR skips the approval", () => {
  const decision = decideApproval(run(["pass", "pass"]), pull(), "Author");
  assert.equal(decision.kind, "skip");
  assert.match(decision.kind === "skip" ? decision.reason : "", /author approve/);
});

test("a token with no user, such as a GitHub App's, still approves", () => {
  assert.deepEqual(decideApproval(run(["pass", "pass"]), pull(), null), { kind: "approve" });
});

test("a PR that is no longer open skips the approval", () => {
  const decision = decideApproval(run(["pass", "pass"]), pull({ state: "closed" }), "x");
  assert.equal(decision.kind, "skip");
});

test("a run already approved at its head does not approve again", () => {
  const approved = run(["pass", "pass"], { approvedSha: HEAD });
  assert.equal(decideApproval(approved, pull(), "conductor").kind, "skip");
});

test("the approval body is marked and links the report", () => {
  const body = buildApprovalBody(run(["pass", "pass"]), "https://example.test/report");
  assert.ok(body.startsWith(CONDUCTOR_APPROVAL_MARKER));
  assert.match(body, /`555` passed all 2 step\(s\) against `0123456`/);
  assert.match(body, /Report: https:\/\/example\.test\/report/);
});

/** Records each request and answers it with `data`. */
function recordingAdapter(
  requests: InternalAxiosRequestConfig[],
  data: unknown,
): AxiosAdapter {
  return async (config) => {
    requests.push(config);
    return { data, status: 200, statusText: "OK", headers: {}, config };
  };
}

test("approve posts an APPROVE review pinned to the tested commit", async () => {
  const requests: InternalAxiosRequestConfig[] = [];
  const adapter = recordingAdapter(requests, { html_url: "https://example.test/review" });
  const client = new GitHubPullClient("token", REPO, { adapter });

  const url = await client.approve(1354, HEAD, "body text");

  assert.equal(url, "https://example.test/review");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "post");
  assert.equal(requests[0].url, "/repos/TheRPGClub/TheRPGClub-bot/pulls/1354/reviews");
  assert.deepEqual(JSON.parse(String(requests[0].data)), {
    commit_id: HEAD,
    event: "APPROVE",
    body: "body text",
  });
});

test("getViewerLogin reads the token's user once", async () => {
  const requests: InternalAxiosRequestConfig[] = [];
  const adapter = recordingAdapter(requests, { login: "conductor" });
  const client = new GitHubPullClient("token", REPO, { adapter });

  assert.equal(await client.getViewerLogin(), "conductor");
  assert.equal(await client.getViewerLogin(), "conductor");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/user");
});

test("getViewerLogin answers null for a token GitHub refuses /user with 403", async () => {
  let calls = 0;
  const adapter: AxiosAdapter = async (config) => {
    calls += 1;
    const response = { data: {}, status: 403, statusText: "Forbidden", headers: {}, config };
    throw new AxiosError("Forbidden", "ERR_BAD_REQUEST", config, null, response);
  };
  const client = new GitHubPullClient("token", REPO, { adapter });

  assert.equal(await client.getViewerLogin(), null);
  assert.equal(await client.getViewerLogin(), null);
  assert.equal(calls, 1);
});

interface IFakeGitHub {
  client: PublishClient;
  calls: string[];
}

/** A GitHub client that records its calls in order and fails the ones named. */
function fakeGitHub(fail: string[] = []): IFakeGitHub {
  const calls: string[] = [];
  const call = async <T>(name: string, value: T): Promise<T> => {
    calls.push(name);
    if (fail.includes(name)) throw new Error(`${name} refused`);
    return value;
  };
  const client: PublishClient = {
    postComment: async () => call("postComment", "https://example.test/report"),
    getPullRequest: async () => call("getPullRequest", pull()),
    getViewerLogin: async () => call("getViewerLogin", "conductor"),
    approve: async () => call("approve", "https://example.test/review"),
  };
  return { client, calls };
}

test("a passed run posts the report before approving", async () => {
  const github = fakeGitHub();
  const passed = run(["pass", "pass"]);

  const outcome = await publishRunResult(github.client, passed);

  assert.equal(github.calls[0], "postComment");
  assert.equal(github.calls.at(-1), "approve");
  assert.equal(outcome.retry, undefined);
  assert.match(outcome.text, /posted: https:\/\/example\.test\/report\nApproved PR #1354/);
  assert.equal(passed.reportUrl, "https://example.test/report");
  assert.equal(passed.approvedSha, HEAD);
});

test("a failed approval keeps the report and offers the approval retry", async () => {
  const github = fakeGitHub(["approve"]);
  const passed = run(["pass", "pass"]);

  const outcome = await publishRunResult(github.client, passed);

  assert.equal(outcome.retry, "approve");
  assert.match(outcome.text, /posted: https:\/\/example\.test\/report/);
  assert.match(outcome.text, /Approving PR #1354 failed/);
  assert.equal(passed.reportUrl, "https://example.test/report");
  assert.equal(passed.approvedSha, undefined);
});

test("a failed report offers the report retry and does not approve", async () => {
  const github = fakeGitHub(["postComment"]);

  const outcome = await publishRunResult(github.client, run(["pass", "pass"]));

  assert.equal(outcome.retry, "report");
  assert.deepEqual(github.calls, ["postComment"]);
});

test("a run with a failed step posts the report and never reads the PR", async () => {
  const github = fakeGitHub();

  const outcome = await publishRunResult(github.client, run(["pass", "fail"]));

  assert.deepEqual(github.calls, ["postComment"]);
  assert.equal(outcome.text, "Report for PR #1354 posted: https://example.test/report");
});
