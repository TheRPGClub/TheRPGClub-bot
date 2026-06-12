import { apiGet, apiPost, apiDelete } from "../services/RpgClubApiClient.js";

export interface ISuggestionItem {
  suggestionId: number;
  title: string;
  details: string | null;
  labels: string | null;
  createdBy: string | null;
  createdByName: string | null;
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

export async function listSuggestions(limit: number = 50): Promise<ISuggestionItem[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const response = await apiGet<SuggestionsListResponse>("/api/v1/suggestions", {
    params: { per: safeLimit },
  });
  if (!response) return [];
  return response.data.map(mapSuggestion);
}

export async function countSuggestions(): Promise<number> {
  const response = await apiGet<SuggestionsListResponse>("/api/v1/suggestions", {
    params: { per: 1 },
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

export async function deleteSuggestion(suggestionId: number): Promise<boolean> {
  const response = await apiDelete<{ deleted: boolean }>(
    `/api/v1/suggestions/${suggestionId}`,
  );
  return response?.deleted === true;
}
