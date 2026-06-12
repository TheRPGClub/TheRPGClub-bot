import type pg from "pg";
import {
  dbQuery,
  dbWithConnection,
  dbTransaction,
  dbQueryConn,
  dbMutateConn,
} from "../db/SqlManager.js";
import { GameSearchSynonymSql } from "../db/sql/index.js";
import { requirePositiveInt } from "../utilities/ValidationUtils.js";
import { apiGet, apiPost, apiPatch } from "../services/RpgClubApiClient.js";

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

function mapSynonymRow(row: any): IGameSearchSynonym {
  return {
    termId: Number(row.TERM_ID),
    groupId: Number(row.GROUP_ID),
    termText: String(row.TERM_TEXT),
    termNorm: String(row.TERM_NORM),
    createdAt: row.CREATED_AT instanceof Date ? row.CREATED_AT : new Date(row.CREATED_AT),
    createdBy: row.CREATED_BY ? String(row.CREATED_BY) : null,
  };
}

export default class GameSearchSynonym {
  static normalizeTerm(text: string): string {
    return normalizeSearchTerm(text);
  }

  // Blocked: needs GET /api/v1/search_synonyms?term=<text> endpoint
  static async getGroupIdsForTerm(
    termText: string,
    conn?: pg.PoolClient,
  ): Promise<number[]> {
    const norm = normalizeSearchTerm(termText);
    if (!norm) return [];
    if (conn) {
      return dbQueryConn(
        conn,
        GameSearchSynonymSql.getGroupIdsForTerm,
        { termNorm: norm },
        (row: { GROUP_ID: number }) => Number(row.GROUP_ID),
      );
    }
    return dbQuery(
      GameSearchSynonymSql.getGroupIdsForTerm,
      { termNorm: norm },
      (row: { GROUP_ID: number }) => Number(row.GROUP_ID),
    );
  }

  // Blocked: shares conn with addSynonymPair and updateGroupTerms (both still on SQL)
  static async listGroupTerms(
    groupId: number,
    conn?: pg.PoolClient,
  ): Promise<IGameSearchSynonym[]> {
    if (conn) {
      return dbQueryConn(conn, GameSearchSynonymSql.listGroupTerms, { groupId }, mapSynonymRow);
    }
    return dbQuery(GameSearchSynonymSql.listGroupTerms, { groupId }, mapSynonymRow);
  }

  // Blocked: depends on getGroupIdsForTerm (needs term= filter endpoint)
  static async getTermsForQuery(query: string): Promise<string[]> {
    const norm = normalizeSearchTerm(query);
    if (!norm) return [];
    return dbWithConnection(async (conn) => {
      const groupIds = await GameSearchSynonym.getGroupIdsForTerm(query, conn);
      if (!groupIds.length) return [];
      const binds: Record<string, number> = {};
      const placeholders = groupIds.map((groupId, index) => {
        const key = `groupId${index}`;
        binds[key] = groupId;
        return `:${key}`;
      });
      return dbQueryConn(
        conn,
        GameSearchSynonymSql.getTermsForQuery(placeholders.join(", ")),
        binds,
        (row: { TERM_TEXT: string }) => String(row.TERM_TEXT),
      );
    });
  }

  // Blocked: needs q= text-search param on GET /api/v1/search_synonyms
  static async listSynonyms(
    options: { query?: string; limit?: number } = {},
  ): Promise<IGameSearchSynonym[]> {
    const query = options.query?.trim().toLowerCase() ?? "";
    const searchQuery = query ? `%${query}%` : null;
    const normalizedQuery = query ? `%${normalizeSearchTerm(query)}%` : null;
    const limit = options.limit ?? 50;
    return dbQuery(
      GameSearchSynonymSql.listSynonyms,
      { searchQuery, normalizedQuery, limit },
      mapSynonymRow,
    );
  }

  // Blocked: needs q= text-search param on GET /api/v1/search_synonym_groups
  static async countSynonymGroups(query?: string): Promise<number> {
    const cleanedQuery = query?.trim().toLowerCase() ?? "";
    const searchQuery = cleanedQuery ? `%${cleanedQuery}%` : null;
    const normalizedQuery = cleanedQuery
      ? `%${normalizeSearchTerm(cleanedQuery)}%`
      : null;
    const rows = await dbQuery(
      GameSearchSynonymSql.countSynonymGroups,
      { searchQuery, normalizedQuery },
      (row: { CNT: number }) => Number(row.CNT ?? 0),
    );
    return rows[0] ?? 0;
  }

  // Blocked: needs q= text-search param on GET /api/v1/search_synonym_groups
  static async listSynonymGroups(
    options: { query?: string; limit?: number; offset?: number } = {},
  ): Promise<IGameSearchSynonym[]> {
    const cleanedQuery = options.query?.trim().toLowerCase() ?? "";
    const searchQuery = cleanedQuery ? `%${cleanedQuery}%` : null;
    const normalizedQuery = cleanedQuery
      ? `%${normalizeSearchTerm(cleanedQuery)}%`
      : null;
    const limit = options.limit ?? 10;
    const offset = options.offset ?? 0;

    return dbWithConnection(async (conn) => {
      const groupIds = await dbQueryConn(
        conn,
        GameSearchSynonymSql.listGroupIdsForSearch,
        { searchQuery, normalizedQuery, offset, limit },
        (row: { GROUP_ID: number }) => Number(row.GROUP_ID),
      );
      if (!groupIds.length) return [];

      const binds: Record<string, number> = {};
      const placeholders = groupIds.map((groupId, index) => {
        const key = `groupId${index}`;
        binds[key] = groupId;
        return `:${key}`;
      });
      return dbQueryConn(
        conn,
        GameSearchSynonymSql.listTermsInGroups(placeholders.join(", ")),
        binds,
        mapSynonymRow,
      );
    });
  }

  // Partially migrated: group/term creation via API; getGroupIdsForTerm still SQL
  // (blocked by missing GET /api/v1/search_synonyms?term= endpoint)
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

    return dbTransaction(async (conn) => {
      const termGroups = await GameSearchSynonym.getGroupIdsForTerm(trimmedTerm, conn);
      const matchGroups = await GameSearchSynonym.getGroupIdsForTerm(trimmedMatch, conn);
      const sharedGroup = termGroups.find((groupId) => matchGroups.includes(groupId));
      let groupId: number | null = sharedGroup ?? null;

      if (!groupId) {
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

      return {
        groupId: groupId as number,
        terms: await GameSearchSynonym.listGroupTerms(groupId as number, conn),
      };
    });
  }

  // Migrated to API
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

  // Blocked: needs DELETE /api/v1/search_synonym_groups/:id/terms (bulk delete)
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

    return dbTransaction(async (conn) => {
      const existsRows = await dbQueryConn(
        conn,
        GameSearchSynonymSql.checkGroupExists,
        { groupId },
        (row: { CNT: number }) => Number(row.CNT ?? 0),
      );
      if ((existsRows[0] ?? 0) === 0) {
        throw new Error("Synonym group not found.");
      }

      await dbMutateConn(conn, GameSearchSynonymSql.deleteSynonymsByGroup, { groupId });

      for (const text of cleaned) {
        const norm = normalizeSearchTerm(text);
        if (!norm) {
          throw new Error("Synonym terms must include letters or numbers.");
        }
        try {
          await dbMutateConn(
            conn,
            GameSearchSynonymSql.insertSynonymTerm,
            { groupId, termText: text, termNorm: norm, createdBy: updatedBy },
          );
        } catch (err: any) {
          const msg = err?.message ?? "";
          if (!/ORA-00001/i.test(msg) && !/unique/i.test(msg)) {
            throw err;
          }
        }
      }

      return {
        groupId,
        terms: await GameSearchSynonym.listGroupTerms(groupId, conn),
      };
    });
  }

  // Migrated to API
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

    return {
      groupId,
      terms: await GameSearchSynonym.listGroupTerms(groupId),
    };
  }

  // Blocked: group-cleanup logic needs atomic transaction; defer until
  // DELETE /api/v1/search_synonym_groups/:id/terms endpoint is available
  static async deleteSynonym(termId: number): Promise<boolean> {
    return dbTransaction(async (conn) => {
      const groupRows = await dbQueryConn(
        conn,
        GameSearchSynonymSql.getSynonymGroupId,
        { termId },
        (row: { GROUP_ID: number }) => Number(row.GROUP_ID),
      );
      const groupId = groupRows[0] ?? null;

      const rowsAffected = await dbMutateConn(
        conn,
        GameSearchSynonymSql.deleteSynonymById,
        { termId },
      );

      if (groupId) {
        const countRows = await dbQueryConn(
          conn,
          GameSearchSynonymSql.countSynonymsInGroup,
          { groupId },
          (row: { CNT: number }) => Number(row.CNT ?? 0),
        );
        if ((countRows[0] ?? 0) === 0) {
          await dbMutateConn(conn, GameSearchSynonymSql.deleteGroup, { groupId });
        }
      }

      return rowsAffected > 0;
    });
  }

  // Blocked: depends on DELETE /api/v1/search_synonym_groups/:id/terms
  // or confirmed cascade behavior on DELETE /api/v1/search_synonym_groups/:id
  static async deleteGroup(groupId: number): Promise<boolean> {
    return dbTransaction(async (conn) => {
      const existsRows = await dbQueryConn(
        conn,
        GameSearchSynonymSql.checkGroupExists,
        { groupId },
        (row: { CNT: number }) => Number(row.CNT ?? 0),
      );
      if ((existsRows[0] ?? 0) === 0) return false;

      await dbMutateConn(conn, GameSearchSynonymSql.deleteSynonymsByGroup, { groupId });
      await dbMutateConn(conn, GameSearchSynonymSql.deleteGroup, { groupId });
      return true;
    });
  }

  // Migrated to API
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
