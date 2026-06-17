import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
} from "../services/RpgClubApiClient.js";
import { isPositiveInt } from "../utilities/ValidationUtils.js";

export interface ISuggestionReviewSession {
  sessionId: string;
  reviewerId: string;
  suggestionIds: number[];
  index: number;
  totalCount: number;
  createdAt: Date;
  updatedAt: Date;
}

type ApiSessionData = {
  session_id: string;
  reviewer_id: string;
  suggestion_ids: string;
  current_index: number;
  total_count: number;
  created_at: string;
  updated_at: string;
};

type ApiSessionResponse = { data: ApiSessionData };
type ApiDeleteResponse = { deleted: boolean; count?: number };

function normalizeSuggestionIds(ids: number[]): number[] {
  return ids
    .map((id) => Number(id))
    .filter(isPositiveInt);
}

function serializeSuggestionIds(ids: number[]): string {
  const normalized = normalizeSuggestionIds(ids);
  const payload = JSON.stringify(normalized);
  if (payload.length > 4000) {
    throw new Error("Too many suggestion ids to persist.");
  }
  return payload;
}

function parseSuggestionIds(value: string | null): number[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return normalizeSuggestionIds(parsed as number[]);
  } catch {
    return [];
  }
}

function mapApiData(data: ApiSessionData): ISuggestionReviewSession {
  return {
    sessionId: data.session_id,
    reviewerId: data.reviewer_id,
    suggestionIds: parseSuggestionIds(data.suggestion_ids),
    index: Number(data.current_index ?? 0),
    totalCount: Number(data.total_count ?? 0),
    createdAt: new Date(data.created_at),
    updatedAt: new Date(data.updated_at),
  };
}

const BASE = "/api/v1/suggestions/review_sessions";

export async function createSuggestionReviewSessionRecord(session: {
  sessionId: string;
  reviewerId: string;
  suggestionIds: number[];
  index: number;
  totalCount: number;
}): Promise<ISuggestionReviewSession> {
  const suggestionIds = serializeSuggestionIds(session.suggestionIds);
  const response = await apiPost<ApiSessionResponse>(BASE, {
    data: {
      session_id: session.sessionId,
      reviewer_id: session.reviewerId,
      suggestion_ids: suggestionIds,
      current_index: Math.max(session.index, 0),
      total_count: Math.max(session.totalCount, 0),
    },
  });
  if (!response?.data) throw new Error("Failed to create suggestion review session.");
  return mapApiData(response.data);
}

export async function getSuggestionReviewSession(
  sessionId: string,
): Promise<ISuggestionReviewSession | null> {
  const response = await apiGet<ApiSessionResponse>(`${BASE}/${sessionId}`);
  if (!response?.data) return null;
  return mapApiData(response.data);
}

export async function updateSuggestionReviewSession(
  session: ISuggestionReviewSession,
): Promise<void> {
  const suggestionIds = serializeSuggestionIds(session.suggestionIds);
  await apiPatch(`${BASE}/${session.sessionId}`, {
    data: {
      reviewer_id: session.reviewerId,
      suggestion_ids: suggestionIds,
      current_index: Math.max(session.index, 0),
      total_count: Math.max(session.totalCount, 0),
    },
  });
}

export async function deleteSuggestionReviewSession(sessionId: string): Promise<boolean> {
  const response = await apiDelete<ApiDeleteResponse>(`${BASE}/${sessionId}`);
  return response?.deleted === true;
}

export async function deleteSuggestionReviewSessionsForReviewer(
  reviewerId: string,
): Promise<number> {
  const response = await apiDelete<ApiDeleteResponse>(BASE, {
    params: { reviewer_id: reviewerId },
  });
  return response?.count ?? 0;
}
