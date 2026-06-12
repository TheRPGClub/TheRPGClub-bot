import { apiGet, apiPost, apiPatch, apiDelete } from "../services/RpgClubApiClient.js";

export type ISynonymDraftPair = {
  term: string;
  match: string;
};

export type ISynonymDraft = {
  draftId: number;
  userId: string;
  pairs: ISynonymDraftPair[];
  createdAt: Date;
  updatedAt: Date;
};

type SearchSynonymDraftApiData = {
  draft_id: number;
  user_id: string;
  pairs_json: string | ISynonymDraftPair[];
  created_at: string;
  updated_at: string;
};

type SearchSynonymDraftResponse = { data: SearchSynonymDraftApiData };

function parsePairsJson(raw: string | ISynonymDraftPair[] | null | undefined): ISynonymDraftPair[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((item) => ({
        term: typeof item?.term === "string" ? item.term : "",
        match: typeof item?.match === "string" ? item.match : "",
      }))
      .filter((pair) => pair.term && pair.match);
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => ({
          term: typeof item?.term === "string" ? item.term : "",
          match: typeof item?.match === "string" ? item.match : "",
        }))
        .filter((pair) => pair.term && pair.match);
    }
  } catch {
    // ignore
  }
  return [];
}

function mapDraftFromApi(d: SearchSynonymDraftApiData): ISynonymDraft {
  return {
    draftId: Number(d.draft_id),
    userId: String(d.user_id),
    pairs: parsePairsJson(d.pairs_json),
    createdAt: new Date(d.created_at),
    updatedAt: new Date(d.updated_at),
  };
}

export default class GameSearchSynonymDraft {
  static async createDraft(userId: string): Promise<ISynonymDraft> {
    const response = await apiPost<SearchSynonymDraftResponse>(
      "/api/v1/search_synonym_drafts",
      { data: { user_id: userId, pairs_json: JSON.stringify([]) } },
    );
    if (!response) throw new Error("Failed to create synonym draft.");
    return mapDraftFromApi(response.data);
  }

  static async getDraft(draftId: number): Promise<ISynonymDraft | null> {
    const response = await apiGet<SearchSynonymDraftResponse>(
      `/api/v1/search_synonym_drafts/${draftId}`,
    );
    if (!response) return null;
    return mapDraftFromApi(response.data);
  }

  static async appendPairs(
    draftId: number,
    pairs: ISynonymDraftPair[],
  ): Promise<ISynonymDraft | null> {
    const existing = await this.getDraft(draftId);
    if (!existing) return null;
    const combined = [...existing.pairs, ...pairs];
    const response = await apiPatch<SearchSynonymDraftResponse>(
      `/api/v1/search_synonym_drafts/${draftId}`,
      { data: { pairs_json: JSON.stringify(combined) } },
    );
    if (!response) return null;
    return mapDraftFromApi(response.data);
  }

  static async deleteDraft(draftId: number): Promise<void> {
    await apiDelete(`/api/v1/search_synonym_drafts/${draftId}`);
  }
}
