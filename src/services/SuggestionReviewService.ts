import axios from "axios";
import {
  approveSuggestion,
  rejectSuggestion,
  type ISuggestionItem,
} from "../classes/Suggestion.js";
import type { SuggestionTargetRepo } from "../config/suggestions.js";
import { buildApiErrorMessage, buildCaughtErrorMessage } from "../utilities/ApiErrorUtils.js";

/** The two review calls, so the review flow can be tested without the API. */
export interface ISuggestionReviewApi {
  approve(
    suggestionId: number,
    targetRepo: SuggestionTargetRepo,
    reviewedBy: string,
  ): Promise<ISuggestionItem>;
  reject(suggestionId: number, reason: string, reviewedBy: string): Promise<ISuggestionItem>;
}

export const SUGGESTION_REVIEW_API: ISuggestionReviewApi = {
  approve: approveSuggestion,
  reject: rejectSuggestion,
};

export type SuggestionReviewRequest =
  | {
    decision: "accept";
    suggestionId: number;
    reviewerId: string;
    targetRepo: SuggestionTargetRepo;
  }
  | { decision: "reject"; suggestionId: number; reviewerId: string; reason: string };

/** What the reviewer is told. `ok` false is a failure to show as an error reply. */
export interface ISuggestionReviewResult {
  ok: boolean;
  message: string;
}

function responseStatus(err: unknown): number | undefined {
  return axios.isAxiosError(err) ? err.response?.status : undefined;
}

function responseField(err: unknown, field: "error" | "message"): string {
  if (!axios.isAxiosError(err)) return "";
  const data: unknown = err.response?.data;
  if (data && typeof data === "object" && field in data) {
    return String((data as Record<string, unknown>)[field]);
  }
  return "";
}

/** The API's error codes for a GitHub issue that could not be opened (502 and 503). */
const GITHUB_ERROR_CODES: ReadonlySet<string> = new Set([
  "github_issue_failed",
  "github_not_configured",
]);

/**
 * Approves or rejects a Suggestion through the API with the reviewer's Discord id. The
 * API opens any GitHub issue and queues the `suggestion_outcome` job that tells the
 * author, so nothing is announced here.
 */
export async function reviewSuggestion(
  api: ISuggestionReviewApi,
  request: SuggestionReviewRequest,
): Promise<ISuggestionReviewResult> {
  const { suggestionId, reviewerId } = request;
  try {
    if (request.decision === "accept") {
      const suggestion = await api.approve(suggestionId, request.targetRepo, reviewerId);
      const issue = suggestion.githubIssueNumber
        ? ` GitHub issue #${suggestion.githubIssueNumber}: ${suggestion.githubIssueUrl ?? ""}`
        : "";
      return { ok: true, message: `Accepted.${issue}`.trimEnd() };
    }
    await api.reject(suggestionId, request.reason, reviewerId);
    return { ok: true, message: "Rejected." };
  } catch (err: unknown) {
    const status = responseStatus(err);
    if (status === 409) {
      return {
        ok: false,
        message: buildApiErrorMessage(`Suggestion #${suggestionId} was already reviewed.`, err),
      };
    }
    if (status === 404) {
      return {
        ok: false,
        message: buildApiErrorMessage(`Suggestion #${suggestionId} no longer exists.`, err),
      };
    }
    if (GITHUB_ERROR_CODES.has(responseField(err, "error"))) {
      return {
        ok: false,
        message: buildApiErrorMessage(
          `Could not open the GitHub issue: ${responseField(err, "message") || "no message"}`,
          err,
        ),
      };
    }
    const verb = request.decision === "accept" ? "approve" : "reject";
    return {
      ok: false,
      message: buildCaughtErrorMessage(`Failed to ${verb} suggestion #${suggestionId}`, err),
    };
  }
}
