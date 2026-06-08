import { oraQuery, oraMutate } from "../db/SqlManager.js";
import { getDialect } from "../db/dialect.js";
import { getSql } from "../db/SqlManager.js";
import { PresencePromptHistorySql } from "../db/sql/index.js";
import { normalizePresenceGameTitle } from "./PresencePromptOptOut.js";

const dialect = getDialect();

export type PresencePromptStatus =
  | "PENDING"
  | "ACCEPTED"
  | "DECLINED"
  | "OPT_OUT_GAME"
  | "OPT_OUT_ALL";

export default class PresencePromptHistory {
  static async createPrompt(
    promptId: string,
    userId: string,
    gameTitle: string,
  ): Promise<void> {
    const normalized = normalizePresenceGameTitle(gameTitle);
    await oraMutate(
      getSql(PresencePromptHistorySql.createPrompt, dialect),
      { promptId, userId, gameTitle, gameTitleNorm: normalized },
    );
  }

  static async markResolved(promptId: string, status: PresencePromptStatus): Promise<void> {
    await oraMutate(
      getSql(PresencePromptHistorySql.markResolved, dialect),
      { status, promptId },
    );
  }

  static async getLastPromptDateForGame(
    userId: string,
    gameTitle: string,
  ): Promise<Date | null> {
    const normalized = normalizePresenceGameTitle(gameTitle);
    const rows = await oraQuery(
      getSql(PresencePromptHistorySql.getLastPromptDate, dialect),
      { userId, gameTitleNorm: normalized },
      (row: { CREATED_AT: Date | string }) =>
        row.CREATED_AT instanceof Date ? row.CREATED_AT : new Date(row.CREATED_AT as string),
    );
    return rows[0] ?? null;
  }

  static async countPendingForGame(userId: string, gameTitle: string): Promise<number> {
    const normalized = normalizePresenceGameTitle(gameTitle);
    const rows = await oraQuery(
      getSql(PresencePromptHistorySql.countPendingForGame, dialect),
      { userId, gameTitleNorm: normalized },
      (row: { CNT: number }) => Number(row.CNT ?? 0),
    );
    return rows[0] ?? 0;
  }

  static async countPendingForUser(userId: string): Promise<number> {
    const rows = await oraQuery(
      getSql(PresencePromptHistorySql.countPendingForUser, dialect),
      { userId },
      (row: { CNT: number }) => Number(row.CNT ?? 0),
    );
    return rows[0] ?? 0;
  }
}
