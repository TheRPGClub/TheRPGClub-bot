import { apiGet, apiPostOrThrow } from "../services/RpgClubApiClient.js";
import type { FeedbackKind, FeedbackWhere } from "../config/feedback.js";

export type FeedbackStatus = "pending" | "approved" | "rejected" | "duplicate" | "withdrawn";

export interface IFeedbackItem {
  feedbackId: number;
  kind: FeedbackKind;
  title: string;
  details: string | null;
  createdBy: string | null;
  createdByName: string | null;
  status: FeedbackStatus;
  githubIssueNumber?: number | null;
  githubIssueUrl?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type FeedbackApiData = {
  feedback_id: number;
  kind: FeedbackKind;
  title: string;
  details: string | null;
  created_by: string | null;
  created_by_name: string | null;
  status?: FeedbackStatus;
  github_issue_number?: number | null;
  github_issue_url?: string | null;
  created_at: string;
  updated_at: string;
};

type FeedbackResponse = { data: FeedbackApiData };
type FeedbackListResponse = {
  data: FeedbackApiData[];
  meta: { count: number };
};

function mapFeedback(d: FeedbackApiData): IFeedbackItem {
  return {
    feedbackId: Number(d.feedback_id),
    kind: d.kind,
    title: d.title,
    details: d.details ?? null,
    createdBy: d.created_by ?? null,
    createdByName: d.created_by_name ?? null,
    status: d.status ?? "pending",
    githubIssueNumber: d.github_issue_number ?? null,
    githubIssueUrl: d.github_issue_url ?? null,
    createdAt: new Date(d.created_at),
    updatedAt: new Date(d.updated_at),
  };
}

/** A Bug Report's own fields; `steps` is optional. */
export interface IBugReportFields {
  where: FeedbackWhere;
  whatHappened: string;
  expected: string;
  steps: string | null;
}

/** What /feedback files: a title and either details or a Bug Report's fields. */
export type FeedbackDraft =
  | { kind: "feature_request" | "suggestion"; title: string; details: string }
  | { kind: "bug_report"; title: string; bug: IBugReportFields };

/** The request body POST /feedback takes for a draft filed by `createdBy`. */
export function buildFeedbackCreateBody(
  draft: FeedbackDraft,
  createdBy: string,
  createdByName: string,
): { data: Record<string, string | null> } {
  const base = {
    kind: draft.kind,
    title: draft.title,
    created_by: createdBy,
    created_by_name: createdByName,
  };
  if (draft.kind === "bug_report") {
    return {
      data: {
        ...base,
        where: draft.bug.where,
        what_happened: draft.bug.whatHappened,
        expected: draft.bug.expected,
        steps: draft.bug.steps,
      },
    };
  }
  return { data: { ...base, details: draft.details } };
}

/** POST /feedback. Throws the AxiosError on any non-2xx (422 missing fields). */
export async function createFeedback(
  draft: FeedbackDraft,
  createdBy: string,
  createdByName: string,
): Promise<IFeedbackItem> {
  const response = await apiPostOrThrow<FeedbackResponse>(
    "/api/v1/feedback",
    buildFeedbackCreateBody(draft, createdBy, createdByName),
  );
  return mapFeedback(response.data);
}

/** How much Feedback is waiting for review. */
export async function countPendingFeedback(): Promise<number> {
  const response = await apiGet<FeedbackListResponse>("/api/v1/feedback", {
    params: { per: 1, status: "pending" },
  });
  return response?.meta?.count ?? 0;
}

export async function getFeedbackById(feedbackId: number): Promise<IFeedbackItem | null> {
  const response = await apiGet<FeedbackResponse>(`/api/v1/feedback/${feedbackId}`);
  if (!response) return null;
  return mapFeedback(response.data);
}
