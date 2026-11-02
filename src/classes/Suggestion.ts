import { apiGet, apiPost, apiPostOrThrow } from "../services/RpgClubApiClient.js";
import type { SuggestionTargetRepo } from "../config/suggestions.js";

export type SuggestionStatus = "pending" | "approved" | "rejected" | "withdrawn";

export interface ISuggestionItem {
  suggestionId: number;
  title: string;
  details: string | null;
  labels: string | null;
  createdBy: string | null;
  createdByName: string | null;
  status: SuggestionStatus;
  githubIssueNumber?: number | null;
  githubIssueUrl?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type SuggestionApiData = {
  suggestion_id: number;
  title: string;
  details: string | null;
  labels: string | null;
  created_by: string | null;
  created_by_name: string | null;
  status?: SuggestionStatus;
  github_issue_number?: number | null;
  github_issue_url?: string | null;
  created_at: string;
  updated_at: string;
};

type SuggestionResponse = { data: SuggestionApiData };
type SuggestionsListResponse = {
  data: SuggestionApiData[];
  meta: { count: number };
};

function mapSuggestion(d: SuggestionApiData): ISuggestionItem {
  return {
    suggestionId: Number(d.suggestion_id),
    title: d.title,
    details: d.details ?? null,
    labels: d.labels ?? null,
    createdBy: d.created_by ?? null,
    createdByName: d.created_by_name ?? null,
    status: d.status ?? "pending",
    githubIssueNumber: d.github_issue_number ?? null,
    githubIssueUrl: d.github_issue_url ?? null,
    createdAt: new Date(d.created_at),
    updatedAt: new Date(d.updated_at),
  };
}

export async function createSuggestion(
  title: string,
  details: string | null,
  labels: string | null,
  createdBy: string | null,
  createdByName: string | null,
): Promise<ISuggestionItem> {
  const response = await apiPost<SuggestionResponse>("/api/v1/suggestions", {
    data: { title, details, labels, created_by: createdBy, created_by_name: createdByName },
  });
  if (!response) throw new Error("Failed to create suggestion.");
  return mapSuggestion(response.data);
}

/** The review queue: only pending rows, most upvoted first, then newest. */
export async function listSuggestions(limit: number = 50): Promise<ISuggestionItem[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const response = await apiGet<SuggestionsListResponse>("/api/v1/suggestions", {
    params: { per: safeLimit, status: "pending" },
  });
  if (!response) return [];
  return response.data.map(mapSuggestion);
}

/** How many suggestions are waiting for review. */
export async function countSuggestions(): Promise<number> {
  const response = await apiGet<SuggestionsListResponse>("/api/v1/suggestions", {
    params: { per: 1, status: "pending" },
  });
  return response?.meta?.count ?? 0;
}

export async function getSuggestionById(
  suggestionId: number,
): Promise<ISuggestionItem | null> {
  const response = await apiGet<SuggestionResponse>(`/api/v1/suggestions/${suggestionId}`);
  if (!response) return null;
  return mapSuggestion(response.data);
}

/**
 * POST /suggestions/:id/approve. The API opens the GitHub issue in `targetRepo` and queues
 * the `suggestion_outcome` job that announces it. Throws the AxiosError on any non-2xx
 * (409 already reviewed, 502/503 GitHub, 404 gone).
 */
export async function approveSuggestion(
  suggestionId: number,
  targetRepo: SuggestionTargetRepo,
  reviewedBy: string,
): Promise<ISuggestionItem> {
  const response = await apiPostOrThrow<SuggestionResponse>(
    `/api/v1/suggestions/${suggestionId}/approve`,
    { data: { target_repo: targetRepo, reviewed_by: reviewedBy } },
  );
  return mapSuggestion(response.data);
}

/**
 * POST /suggestions/:id/reject. The API queues the `suggestion_outcome` job that tells the
 * author. Throws the AxiosError on any non-2xx (409 already reviewed, 422 bad reason).
 */
export async function rejectSuggestion(
  suggestionId: number,
  rejectionReason: string,
  reviewedBy: string,
): Promise<ISuggestionItem> {
  const response = await apiPostOrThrow<SuggestionResponse>(
    `/api/v1/suggestions/${suggestionId}/reject`,
    { data: { rejection_reason: rejectionReason, reviewed_by: reviewedBy } },
  );
  return mapSuggestion(response.data);
}
