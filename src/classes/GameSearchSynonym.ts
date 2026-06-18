import { requirePositiveInt } from "../utilities/ValidationUtils.js";
import {
  apiGet,
  apiPost,
  apiPatch,
  apiDelete,
} from "../services/RpgClubApiClient.js";

export type IGameSearchSynonym = {
  termId: number;
  groupId: number;
  termText: string;
  termNorm: string;
  createdAt: Date;
  createdBy: string | null;
};

type SearchSynonymApiData = {
  term_id: number;
  group_id: number;
  term_text: string;
  term_norm: string;
  created_at: string;
  created_by: string | null;
};

type SearchSynonymGroupApiData = {
  group_id: number;
  created_at: string;
  created_by: string | null;
};

type SearchSynonymResponse = { data: SearchSynonymApiData };
type SearchSynonymGroupResponse = { data: SearchSynonymGroupApiData };
type SearchSynonymListResponse = {
  data: SearchSynonymApiData[];
  meta: { count: number };
};
type SearchSynonymGroupListResponse = {
  data: SearchSynonymGroupApiData[];
  meta: { count: number };
};

function mapSynonymFromApi(d: SearchSynonymApiData): IGameSearchSynonym {
  return {
    termId: Number(d.term_id),
    groupId: Number(d.group_id),
    termText: String(d.term_text),
    termNorm: String(d.term_norm),
    createdAt: new Date(d.created_at),
    createdBy: d.created_by ?? null,
  };
}

export function normalizeSearchTerm(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export default class GameSearchSynonym {
  static normalizeTerm(text: string): string {
    return normalizeSearchTerm(text);
  }

  static async getGroupIdsForTerm(termText: string): Promise<number[]> {
    const norm = normalizeSearchTerm(termText);
    if (!norm) return [];
    const response = await apiGet<SearchSynonymListResponse>(
      "/api/v1/search_synonyms",
      { params: { term: norm, limit: 100 } },
    );
    if (!response) return [];
    return [...new Set(response.data.map((d) => Number(d.group_id)))];
  }

  static async listGroupTerms(groupId: number): Promise<IGameSearchSynonym[]> {
    const response = await apiGet<SearchSynonymListResponse>(
      "/api/v1/search_synonyms",
      { params: { group_id: groupId, limit: 200 } },
    );
    if (!response) return [];
    return response.data.map(mapSynonymFromApi);
  }

  static async getTermsForQuery(query: string): Promise<string[]> {
    const norm = normalizeSearchTerm(query);
    if (!norm) return [];
    const groupIds = await GameSearchSynonym.getGroupIdsForTerm(query);
    if (!groupIds.length) return [];
    const responses = await Promise.all(
      groupIds.map((groupId) =>
        apiGet<SearchSynonymListResponse>("/api/v1/search_synonyms", {
          params: { group_id: groupId, limit: 200 },
        }),
      ),
    );
    const seen = new Set<string>();
    const result: string[] = [];
    for (const res of responses) {
      if (!res) continue;
      for (const d of res.data) {
        const text = String(d.term_text);
        if (!seen.has(text)) {
          seen.add(text);
          result.push(text);
        }
      }
    }
    return result.sort();
  }

  static async listSynonyms(
    options: { query?: string; limit?: number } = {},
  ): Promise<IGameSearchSynonym[]> {
    const params: Record<string, unknown> = { limit: options.limit ?? 50 };
    const q = options.query?.trim().toLowerCase() ?? "";
    if (q) params.q = q;
    const response = await apiGet<SearchSynonymListResponse>(
      "/api/v1/search_synonyms",
      { params },
    );
    if (!response) return [];
    return response.data.map(mapSynonymFromApi);
  }

  static async countSynonymGroups(query?: string): Promise<number> {
    const params: Record<string, unknown> = { limit: 1 };
    const q = query?.trim().toLowerCase() ?? "";
    if (q) params.q = q;
    const response = await apiGet<SearchSynonymGroupListResponse>(
      "/api/v1/search_synonym_groups",
      { params },
    );
    return response?.meta?.count ?? 0;
  }

  static async listSynonymGroups(
    options: { query?: string; limit?: number; offset?: number } = {},
  ): Promise<IGameSearchSynonym[]> {
    const params: Record<string, unknown> = {
      limit: options.limit ?? 10,
      offset: options.offset ?? 0,
    };
    const q = options.query?.trim().toLowerCase() ?? "";
    if (q) params.q = q;
    const groupResponse = await apiGet<SearchSynonymGroupListResponse>(
      "/api/v1/search_synonym_groups",
      { params },
    );
    if (!groupResponse?.data.length) return [];
    const termResponses = await Promise.all(
      groupResponse.data.map((g) =>
        apiGet<SearchSynonymListResponse>("/api/v1/search_synonyms", {
          params: { group_id: g.group_id, limit: 200 },
        }),
      ),
    );
    return termResponses.flatMap((res) =>
      res ? res.data.map(mapSynonymFromApi) : [],
    );
  }

  static async addSynonymPair(
    termText: string,
    matchText: string,
    createdBy: string | null,
  ): Promise<{ groupId: number; terms: IGameSearchSynonym[] }> {
    const trimmedTerm = termText.trim();
    const trimmedMatch = matchText.trim();
    if (!trimmedTerm || !trimmedMatch) {
      throw new Error("Both term and match text are required.");
    }

    const [termGroups, matchGroups] = await Promise.all([
      GameSearchSynonym.getGroupIdsForTerm(trimmedTerm),
      GameSearchSynonym.getGroupIdsForTerm(trimmedMatch),
    ]);
    const sharedGroup = termGroups.find((id) => matchGroups.includes(id));
    let groupId: number;

    if (sharedGroup !== undefined) {
      groupId = sharedGroup;
    } else {
      const groupResponse = await apiPost<SearchSynonymGroupResponse>(
        "/api/v1/search_synonym_groups",
        { data: { created_by: createdBy } },
      );
      if (!groupResponse) throw new Error("Failed to create synonym group.");
      groupId = groupResponse.data.group_id;
    }

    for (const text of [trimmedTerm, trimmedMatch]) {
      const norm = normalizeSearchTerm(text);
      if (!norm) {
        throw new Error("Synonyms must include letters or numbers.");
      }
      try {
        await apiPost<SearchSynonymResponse>("/api/v1/search_synonyms", {
          data: {
            group_id: groupId,
            term_text: text,
            term_norm: norm,
            created_by: createdBy,
          },
        });
      } catch (err: any) {
        const status = err?.response?.status ?? 0;
        if (status !== 422) throw err;
      }
    }

    return { groupId, terms: await GameSearchSynonym.listGroupTerms(groupId) };
  }

  static async updateSynonym(
    termId: number,
    termText: string,
  ): Promise<IGameSearchSynonym | null> {
    const trimmed = termText.trim();
    if (!trimmed) {
      throw new Error("Term text cannot be empty.");
    }
    const termNorm = normalizeSearchTerm(trimmed);
    if (!termNorm) {
      throw new Error("Term text must include letters or numbers.");
    }

    const response = await apiPatch<SearchSynonymResponse>(
      `/api/v1/search_synonyms/${termId}`,
      { data: { term_text: trimmed, term_norm: termNorm } },
    );
    if (!response) return null;
    return mapSynonymFromApi(response.data);
  }

  static async updateGroupTerms(
    groupId: number,
    terms: string[],
    updatedBy: string | null,
  ): Promise<{ groupId: number; terms: IGameSearchSynonym[] }> {
    requirePositiveInt(groupId, "synonym group");
    const cleaned = terms.map((term) => term.trim()).filter(Boolean);
    if (cleaned.length < 2) {
      throw new Error("A synonym group must contain at least two terms.");
    }

    const groupCheck = await apiGet<SearchSynonymGroupResponse>(
      `/api/v1/search_synonym_groups/${groupId}`,
    );
    if (!groupCheck) {
      throw new Error("Synonym group not found.");
    }

    await apiDelete(`/api/v1/search_synonym_groups/${groupId}/terms`);

    for (const text of cleaned) {
      const norm = normalizeSearchTerm(text);
      if (!norm) {
        throw new Error("Synonym terms must include letters or numbers.");
      }
      try {
        await apiPost<SearchSynonymResponse>("/api/v1/search_synonyms", {
          data: { group_id: groupId, term_text: text, term_norm: norm, created_by: updatedBy },
        });
      } catch (err: any) {
        const status = err?.response?.status ?? 0;
        if (status !== 422) throw err;
      }
    }

    return { groupId, terms: await GameSearchSynonym.listGroupTerms(groupId) };
  }

  static async createGroupTerms(
    terms: string[],
    createdBy: string | null,
  ): Promise<{ groupId: number; terms: IGameSearchSynonym[] }> {
    const cleaned: string[] = [];
    const seen = new Set<string>();
    for (const term of terms) {
      const trimmed = term.trim();
      if (!trimmed) continue;
      const norm = normalizeSearchTerm(trimmed);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      cleaned.push(trimmed);
    }
    if (cleaned.length < 2) {
      throw new Error("A synonym group must contain at least two terms.");
    }

    const groupResponse = await apiPost<SearchSynonymGroupResponse>(
      "/api/v1/search_synonym_groups",
      { data: { created_by: createdBy } },
    );
    if (!groupResponse) throw new Error("Failed to create synonym group.");
    const groupId = groupResponse.data.group_id;

    for (const text of cleaned) {
      const norm = normalizeSearchTerm(text);
      await apiPost<SearchSynonymResponse>("/api/v1/search_synonyms", {
        data: { group_id: groupId, term_text: text, term_norm: norm, created_by: createdBy },
      });
    }

    return { groupId, terms: await GameSearchSynonym.listGroupTerms(groupId) };
  }

  static async deleteSynonym(termId: number): Promise<boolean> {
    const synonym = await apiGet<SearchSynonymResponse>(
      `/api/v1/search_synonyms/${termId}`,
    );
    if (!synonym) return false;
    const groupId = synonym.data.group_id;

    const deleted = await apiDelete(`/api/v1/search_synonyms/${termId}`);
    if (!deleted) return false;

    const remaining = await apiGet<SearchSynonymListResponse>(
      "/api/v1/search_synonyms",
      { params: { group_id: groupId, limit: 1 } },
    );
    if (remaining && remaining.meta.count === 0) {
      await apiDelete(`/api/v1/search_synonym_groups/${groupId}`);
    }

    return true;
  }

  static async deleteGroup(groupId: number): Promise<boolean> {
    const groupCheck = await apiGet<SearchSynonymGroupResponse>(
      `/api/v1/search_synonym_groups/${groupId}`,
    );
    if (!groupCheck) return false;

    await apiDelete(`/api/v1/search_synonym_groups/${groupId}/terms`);
    await apiDelete(`/api/v1/search_synonym_groups/${groupId}`);
    return true;
  }

  static async getSynonymById(
    termId: number,
  ): Promise<IGameSearchSynonym | null> {
    const response = await apiGet<SearchSynonymResponse>(
      `/api/v1/search_synonyms/${termId}`,
    );
    if (!response) return null;
    return mapSynonymFromApi(response.data);
  }
}
