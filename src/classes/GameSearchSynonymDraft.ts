import oracledb from "oracledb";
import { oraQuery, oraMutate, oraWithConnection } from "../db/SqlManager.js";
import { getDialect } from "../db/dialect.js";
import { getSql } from "../db/SqlManager.js";
import { GameSearchSynonymDraftSql } from "../db/sql/index.js";

const dialect = getDialect();

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
    const result = await oraMutate(
      getSql(GameSearchSynonymDraftSql.createDraft, dialect),
      {
        userId,
        pairsJson: JSON.stringify([]),
        draftId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      },
    );
    const draftId = Number((result.outBinds as any)?.draftId?.[0]);
    const draft = await this.getDraft(draftId);
    if (!draft) {
      throw new Error("Failed to load synonym draft after creation.");
    }
    return draft;
  }

  static async getDraft(draftId: number): Promise<ISynonymDraft | null> {
    const rows = await oraQuery(
      getSql(GameSearchSynonymDraftSql.getDraft, dialect),
      { draftId },
      mapDraftRow,
    );
    return rows[0] ?? null;
  }

  static async appendPairs(
    draftId: number,
    pairs: ISynonymDraftPair[],
  ): Promise<ISynonymDraft | null> {
    return oraWithConnection(async (conn) => {
      const existing = await GameSearchSynonymDraft.getDraftWithConn(draftId, conn);
      if (!existing) return null;
      const combined = [...existing.pairs, ...pairs];
      await oraMutate(
        getSql(GameSearchSynonymDraftSql.updateDraft, dialect),
        { draftId, pairsJson: JSON.stringify(combined) },
        conn,
      );
      return GameSearchSynonymDraft.getDraftWithConn(draftId, conn);
    });
  }

  static async deleteDraft(draftId: number): Promise<void> {
    await oraMutate(
      getSql(GameSearchSynonymDraftSql.deleteDraft, dialect),
      { draftId },
    );
  }

  private static async getDraftWithConn(
    draftId: number,
    conn: oracledb.Connection,
  ): Promise<ISynonymDraft | null> {
    const rows = await oraQuery(
      getSql(GameSearchSynonymDraftSql.getDraft, dialect),
      { draftId },
      mapDraftRow,
      conn,
    );
    return rows[0] ?? null;
  }
}
