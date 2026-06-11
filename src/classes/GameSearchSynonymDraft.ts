import type pg from "pg";
import {
  dbQuery,
  dbMutate,
  dbInsert,
  dbTransaction,
  dbQueryConn,
  dbMutateConn,
} from "../db/SqlManager.js";
import { GameSearchSynonymDraftSql } from "../db/sql/index.js";

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

function parsePairsJson(raw: string | null | undefined): ISynonymDraftPair[] {
  if (!raw) return [];
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

function mapDraftRow(row: any): ISynonymDraft {
  return {
    draftId: Number(row.DRAFT_ID),
    userId: String(row.USER_ID),
    pairs: parsePairsJson(row.PAIRS_JSON ? String(row.PAIRS_JSON) : null),
    createdAt: row.CREATED_AT instanceof Date ? row.CREATED_AT : new Date(row.CREATED_AT),
    updatedAt: row.UPDATED_AT instanceof Date ? row.UPDATED_AT : new Date(row.UPDATED_AT),
  };
}

export default class GameSearchSynonymDraft {
  static async createDraft(userId: string): Promise<ISynonymDraft> {
    const draftId = await dbInsert(
      GameSearchSynonymDraftSql.createDraft,
      { userId, pairsJson: JSON.stringify([]) },
      "draftId",
    );
    const draft = await this.getDraft(draftId);
    if (!draft) {
      throw new Error("Failed to load synonym draft after creation.");
    }
    return draft;
  }

  static async getDraft(draftId: number): Promise<ISynonymDraft | null> {
    const rows = await dbQuery(
      GameSearchSynonymDraftSql.getDraft,
      { draftId },
      mapDraftRow,
    );
    return rows[0] ?? null;
  }

  static async appendPairs(
    draftId: number,
    pairs: ISynonymDraftPair[],
  ): Promise<ISynonymDraft | null> {
    return dbTransaction(async (conn) => {
      const existing = await this.getDraftWithConn(draftId, conn);
      if (!existing) return null;
      const combined = [...existing.pairs, ...pairs];
      await dbMutateConn(
        conn,
        GameSearchSynonymDraftSql.updateDraft,
        { draftId, pairsJson: JSON.stringify(combined) },
      );
      return this.getDraftWithConn(draftId, conn);
    });
  }

  static async deleteDraft(draftId: number): Promise<void> {
    await dbMutate(
      GameSearchSynonymDraftSql.deleteDraft,
      { draftId },
    );
  }

  private static async getDraftWithConn(
    draftId: number,
    conn: pg.PoolClient,
  ): Promise<ISynonymDraft | null> {
    const rows = await dbQueryConn(
      conn,
      GameSearchSynonymDraftSql.getDraft,
      { draftId },
      mapDraftRow,
    );
    return rows[0] ?? null;
  }
}
