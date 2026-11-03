import assert from "node:assert/strict";
import test from "node:test";
import { AxiosError, AxiosHeaders } from "axios";
import type { ISuggestionItem } from "../classes/Suggestion.js";
import {
  reviewSuggestion,
  type ISuggestionReviewApi,
} from "../services/SuggestionReviewService.js";

type Call =
  | { kind: "approve"; id: number; repo: string; reviewedBy: string }
  | { kind: "reject"; id: number; reason: string; reviewedBy: string };

function reviewed(overrides: Partial<ISuggestionItem> = {}): ISuggestionItem {
  return {
    suggestionId: 7,
    title: "Dark mode",
    details: "Please",
    labels: "New Feature",
    createdBy: "author-1",
    createdByName: "Ayla",
    status: "approved",
    githubIssueNumber: 321,
    githubIssueUrl: "https://github.com/TheRPGClub/TheRPGClub-www/issues/321",
    createdAt: new Date("2026-11-01T10:00:00Z"),
    updatedAt: new Date("2026-11-02T10:00:00Z"),
    ...overrides,
  };
}

function fakeApi(error?: unknown): ISuggestionReviewApi & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    approve: async (id, repo, reviewedBy) => {
      calls.push({ kind: "approve", id, repo, reviewedBy });
      if (error) throw error;
      return reviewed();
    },
    reject: async (id, reason, reviewedBy) => {
      calls.push({ kind: "reject", id, reason, reviewedBy });
      if (error) throw error;
      return reviewed({ status: "rejected", githubIssueNumber: null, githubIssueUrl: null });
    },
  };
}

function apiError(status: number, data: unknown, url = "/api/v1/suggestions/7/approve") {
  const config: any = { method: "post", url, data: "{}", headers: new AxiosHeaders() };
  const response: any = { status, statusText: "", data, headers: {}, config };
  return new AxiosError(`Request failed with status code ${status}`, "ERR_BAD_RESPONSE",
    config, null, response);
}

test("accept approves through the API with the repo and the reviewer", async () => {
  const api = fakeApi();
  const result = await reviewSuggestion(api, {
    decision: "accept",
    suggestionId: 7,
    reviewerId: "reviewer-1",
    targetRepo: "TheRPGClub/TheRPGClub-www",
  });
  assert.deepEqual(api.calls, [{
    kind: "approve",
    id: 7,
    repo: "TheRPGClub/TheRPGClub-www",
    reviewedBy: "reviewer-1",
  }]);
  assert.equal(result.ok, true);
  assert.match(result.message, /GitHub issue #321/);
  assert.match(result.message, /issues\/321/);
});

test("reject rejects through the API with the reason and the reviewer", async () => {
  const api = fakeApi();
  const result = await reviewSuggestion(api, {
    decision: "reject",
    suggestionId: 7,
    reviewerId: "reviewer-1",
    reason: "Out of scope",
  });
  assert.deepEqual(api.calls, [{
    kind: "reject",
    id: 7,
    reason: "Out of scope",
    reviewedBy: "reviewer-1",
  }]);
  assert.equal(result.ok, true);
  assert.match(result.message, /^Rejected/);
});

test("a 409 says the suggestion was already reviewed", async () => {
  const api = fakeApi(apiError(409, { error: "not_pending", message: "Not pending" }));
  const result = await reviewSuggestion(api, {
    decision: "reject",
    suggestionId: 7,
    reviewerId: "reviewer-1",
    reason: "No",
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /^Suggestion #7 was already reviewed\./);
  assert.match(result.message, /"url": "\/api\/v1\/suggestions\/7\/approve"/);
  assert.match(result.message, /"status": 409/);
  assert.match(result.message, /not_pending/);
});

test("a 404 says the suggestion no longer exists", async () => {
  const api = fakeApi(apiError(404, { error: "not_found" }));
  const result = await reviewSuggestion(api, {
    decision: "accept",
    suggestionId: 7,
    reviewerId: "reviewer-1",
    targetRepo: "TheRPGClub/TheRPGClub-bot",
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /^Suggestion #7 no longer exists\./);
  assert.match(result.message, /"url": "\/api\/v1\/suggestions\/7\/approve"/);
  assert.match(result.message, /"status": 404/);
  assert.match(result.message, /not_found/);
});

for (const [status, code] of [[502, "github_issue_failed"], [503, "github_not_configured"]]) {
  test(`a ${status} shows GitHub's message with the request and response`, async () => {
    const api = fakeApi(apiError(Number(status), {
      error: code,
      message: "Resource not accessible by integration",
    }));
    const result = await reviewSuggestion(api, {
      decision: "accept",
      suggestionId: 7,
      reviewerId: "reviewer-1",
      targetRepo: "TheRPGClub/TheRPGClub-api",
    });
    assert.equal(result.ok, false);
    assert.match(result.message,
      /^Could not open the GitHub issue: Resource not accessible by integration/);
    assert.match(result.message, /\/api\/v1\/suggestions\/7\/approve/);
    assert.match(result.message, new RegExp(String(code)));
  });
}

test("any other API failure reports the full request and response", async () => {
  const api = fakeApi(apiError(422, { error: "invalid", message: "Reason too long" },
    "/api/v1/suggestions/7/reject"));
  const result = await reviewSuggestion(api, {
    decision: "reject",
    suggestionId: 7,
    reviewerId: "reviewer-1",
    reason: "x",
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /^Failed to reject suggestion #7/);
  assert.match(result.message, /\/api\/v1\/suggestions\/7\/reject/);
  assert.match(result.message, /Reason too long/);
});

test("a 503 that is not GitHub's is not labelled a GitHub failure", async () => {
  const api = fakeApi(apiError(503, { error: "service_unavailable" },
    "/api/v1/suggestions/7/reject"));
  const result = await reviewSuggestion(api, {
    decision: "reject",
    suggestionId: 7,
    reviewerId: "reviewer-1",
    reason: "x",
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /^Failed to reject suggestion #7/);
  assert.doesNotMatch(result.message, /GitHub/);
  assert.match(result.message, /service_unavailable/);
});
