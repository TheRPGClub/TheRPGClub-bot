import oracledb from "oracledb";
import { oraQuery, oraMutate, oraWithConnection } from "../db/SqlManager.js";
import { getDialect } from "../db/dialect.js";
import { getSql } from "../db/SqlManager.js";
import { GameSearchSynonymSql } from "../db/sql/index.js";

const dialect = getDialect();

export type IGameSearchSynonym = {
  termId: number;
  groupId: number;
  termText: string;
  termNorm: string;
  createdAt: Date;
  createdBy: string | null;
};

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

  static async getGroupIdsForTerm(
    termText: string,
    conn?: oracledb.Connection,
  ): Promise<number[]> {
    const norm = normalizeSearchTerm(termText);
    if (!norm) return [];
    return oraQuery(
      getSql(GameSearchSynonymSql.getGroupIdsForTerm, dialect),
      { termNorm: norm },
      (row: { GROUP_ID: number }) => Number(row.GROUP_ID),
      conn,
    );
  }

  static async listGroupTerms(
    groupId: number,
    conn?: oracledb.Connection,
  ): Promise<IGameSearchSynonym[]> {
    return oraQuery(
      getSql(GameSearchSynonymSql.listGroupTerms, dialect),
      { groupId },
      mapSynonymRow,
      conn,
    );
  }

  static async getTermsForQuery(query: string): Promise<string[]> {
    const norm = normalizeSearchTerm(query);
    if (!norm) return [];
    return oraWithConnection(async (conn) => {
      const groupIds = await GameSearchSynonym.getGroupIdsForTerm(query, conn);
      if (!groupIds.length) return [];
      const binds: Record<string, number> = {};
      const placeholders = groupIds.map((groupId, index) => {
        const key = `groupId${index}`;
        binds[key] = groupId;
        return `:${key}`;
      });
      return oraQuery(
        GameSearchSynonymSql.getTermsForQuery(placeholders.join(", "))[dialect],
        binds,
        (row: { TERM_TEXT: string }) => String(row.TERM_TEXT),
        conn,
      );
    });
  }

  static async listSynonyms(
    options: { query?: string; limit?: number } = {},
  ): Promise<IGameSearchSynonym[]> {
    const query = options.query?.trim().toLowerCase() ?? "";
    const searchQuery = query ? `%${query}%` : null;
    const normalizedQuery = query ? `%${normalizeSearchTerm(query)}%` : null;
    const limit = options.limit ?? 50;
    return oraQuery(
      getSql(GameSearchSynonymSql.listSynonyms, dialect),
      { searchQuery, normalizedQuery, limit },
      mapSynonymRow,
    );
  }

  static async countSynonymGroups(query?: string): Promise<number> {
    const cleanedQuery = query?.trim().toLowerCase() ?? "";
    const searchQuery = cleanedQuery ? `%${cleanedQuery}%` : null;
    const normalizedQuery = cleanedQuery
      ? `%${normalizeSearchTerm(cleanedQuery)}%`
      : null;
    const rows = await oraQuery(
      getSql(GameSearchSynonymSql.countSynonymGroups, dialect),
      { searchQuery, normalizedQuery },
      (row: { CNT: number }) => Number(row.CNT ?? 0),
    );
    return rows[0] ?? 0;
  }

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

    return oraWithConnection(async (conn) => {
      const groupIds = await oraQuery(
        getSql(GameSearchSynonymSql.listGroupIdsForSearch, dialect),
        { searchQuery, normalizedQuery, offset, limit },
        (row: { GROUP_ID: number }) => Number(row.GROUP_ID),
        conn,
      );
      if (!groupIds.length) return [];

      const binds: Record<string, number> = {};
      const placeholders = groupIds.map((groupId, index) => {
        const key = `groupId${index}`;
        binds[key] = groupId;
        return `:${key}`;
      });
      return oraQuery(
        GameSearchSynonymSql.listTermsInGroups(placeholders.join(", "))[dialect],
        binds,
        mapSynonymRow,
        conn,
      );
    });
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

    return oraWithConnection(async (conn) => {
      const termGroups = await GameSearchSynonym.getGroupIdsForTerm(trimmedTerm, conn);
      const matchGroups = await GameSearchSynonym.getGroupIdsForTerm(trimmedMatch, conn);
      const sharedGroup = termGroups.find((groupId) => matchGroups.includes(groupId));
      let groupId = sharedGroup ?? null;

      if (!groupId) {
        const groupResult = await oraMutate(
          getSql(GameSearchSynonymSql.insertSynonymGroup, dialect),
          {
            createdBy,
            groupId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
          },
          conn,
        );
        groupId = Number((groupResult.outBinds as any)?.groupId?.[0]);
        await conn.commit();
      }

      for (const text of [trimmedTerm, trimmedMatch]) {
        const norm = normalizeSearchTerm(text);
        if (!norm) {
          throw new Error("Synonyms must include letters or numbers.");
        }
        try {
          await oraMutate(
            getSql(GameSearchSynonymSql.insertSynonymTerm, dialect),
            { groupId, termText: text, termNorm: norm, createdBy },
            conn,
          );
          await conn.commit();
        } catch (err: any) {
          const msg = err?.message ?? "";
          if (!/ORA-00001/i.test(msg)) {
            throw err;
          }
        }
      }

      return {
        groupId: groupId as number,
        terms: await GameSearchSynonym.listGroupTerms(groupId as number, conn),
      };
    });
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

    return oraWithConnection(async (conn) => {
      await oraMutate(
        getSql(GameSearchSynonymSql.updateSynonymTerm, dialect),
        { termId, termText: trimmed, termNorm },
        conn,
      );
      await conn.commit();
      return GameSearchSynonym.getSynonymById(termId, conn);
    });
  }

  static async updateGroupTerms(
    groupId: number,
    terms: string[],
    updatedBy: string | null,
  ): Promise<{ groupId: number; terms: IGameSearchSynonym[] }> {
    if (!Number.isInteger(groupId) || groupId <= 0) {
      throw new Error("Invalid synonym group.");
    }
    const cleaned = terms.map((term) => term.trim()).filter(Boolean);
    if (cleaned.length < 2) {
      throw new Error("A synonym group must contain at least two terms.");
    }

    return oraWithConnection(async (conn) => {
      const existsRows = await oraQuery(
        getSql(GameSearchSynonymSql.checkGroupExists, dialect),
        { groupId },
        (row: { CNT: number }) => Number(row.CNT ?? 0),
        conn,
      );
      if ((existsRows[0] ?? 0) === 0) {
        throw new Error("Synonym group not found.");
      }

      await oraMutate(
        getSql(GameSearchSynonymSql.deleteSynonymsByGroup, dialect),
        { groupId },
        conn,
      );
      await conn.commit();

      for (const text of cleaned) {
        const norm = normalizeSearchTerm(text);
        if (!norm) {
          throw new Error("Synonym terms must include letters or numbers.");
        }
        try {
          await oraMutate(
            getSql(GameSearchSynonymSql.insertSynonymTerm, dialect),
            { groupId, termText: text, termNorm: norm, createdBy: updatedBy },
            conn,
          );
          await conn.commit();
        } catch (err: any) {
          const msg = err?.message ?? "";
          if (!/ORA-00001/i.test(msg)) {
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

    return oraWithConnection(async (conn) => {
      const groupResult = await oraMutate(
        getSql(GameSearchSynonymSql.insertSynonymGroup, dialect),
        {
          createdBy,
          groupId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        },
        conn,
      );
      const groupId = Number((groupResult.outBinds as any)?.groupId?.[0]);
      if (!Number.isInteger(groupId) || groupId <= 0) {
        throw new Error("Failed to create synonym group.");
      }
      await conn.commit();

      for (const text of cleaned) {
        const norm = normalizeSearchTerm(text);
        await oraMutate(
          getSql(GameSearchSynonymSql.insertSynonymTerm, dialect),
          { groupId, termText: text, termNorm: norm, createdBy },
          conn,
        );
        await conn.commit();
      }

      return {
        groupId,
        terms: await GameSearchSynonym.listGroupTerms(groupId, conn),
      };
    });
  }

  static async deleteSynonym(termId: number): Promise<boolean> {
    return oraWithConnection(async (conn) => {
      const groupRows = await oraQuery(
        getSql(GameSearchSynonymSql.getSynonymGroupId, dialect),
        { termId },
        (row: { GROUP_ID: number }) => Number(row.GROUP_ID),
        conn,
      );
      const groupId = groupRows[0] ?? null;

      const result = await oraMutate(
        getSql(GameSearchSynonymSql.deleteSynonymById, dialect),
        { termId },
        conn,
      );
      await conn.commit();

      if (groupId) {
        const countRows = await oraQuery(
          getSql(GameSearchSynonymSql.countSynonymsInGroup, dialect),
          { groupId },
          (row: { CNT: number }) => Number(row.CNT ?? 0),
          conn,
        );
        if ((countRows[0] ?? 0) === 0) {
          await oraMutate(
            getSql(GameSearchSynonymSql.deleteGroup, dialect),
            { groupId },
            conn,
          );
          await conn.commit();
        }
      }

      return (result.rowsAffected ?? 0) > 0;
    });
  }

  static async deleteGroup(groupId: number): Promise<boolean> {
    if (!Number.isInteger(groupId) || groupId <= 0) return false;
    return oraWithConnection(async (conn) => {
      const existsRows = await oraQuery(
        getSql(GameSearchSynonymSql.checkGroupExists, dialect),
        { groupId },
        (row: { CNT: number }) => Number(row.CNT ?? 0),
        conn,
      );
      if ((existsRows[0] ?? 0) === 0) return false;

      await oraMutate(
        getSql(GameSearchSynonymSql.deleteSynonymsByGroup, dialect),
        { groupId },
        conn,
      );
      await conn.commit();
      await oraMutate(
        getSql(GameSearchSynonymSql.deleteGroup, dialect),
        { groupId },
        conn,
      );
      await conn.commit();
      return true;
    });
  }

  static async getSynonymById(
    termId: number,
    conn?: oracledb.Connection,
  ): Promise<IGameSearchSynonym | null> {
    const rows = await oraQuery(
      getSql(GameSearchSynonymSql.getSynonymById, dialect),
      { termId },
      mapSynonymRow,
      conn,
    );
    return rows[0] ?? null;
  }
}
