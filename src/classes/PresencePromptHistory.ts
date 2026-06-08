import { dbQuery, dbMutate } from "../db/SqlManager.js";
import { PresencePromptHistorySql } from "../db/sql/index.js";
import { normalizePresenceGameTitle } from "./PresencePromptOptOut.js";

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
    await dbMutate(
      PresencePromptHistorySql.createPrompt,
      { promptId, userId, gameTitle, gameTitleNorm: normalized },
    );
  }

  static async markResolved(promptId: string, status: PresencePromptStatus): Promise<void> {
    await dbMutate(
      PresencePromptHistorySql.markResolved,
      { status, promptId },
    );
  }

  static async getLastPromptDateForGame(
    userId: string,
    gameTitle: string,
  ): Promise<Date | null> {
    const normalized = normalizePresenceGameTitle(gameTitle);
    const rows = await dbQuery(
      PresencePromptHistorySql.getLastPromptDate,
      { userId, gameTitleNorm: normalized },
      (row: { CREATED_AT: Date | string }) =>
        row.CREATED_AT instanceof Date ? row.CREATED_AT : new Date(row.CREATED_AT as string),
    );
    return rows[0] ?? null;
  }

  static async countPendingForGame(userId: string, gameTitle: string): Promise<number> {
    const normalized = normalizePresenceGameTitle(gameTitle);
    const rows = await dbQuery(
      PresencePromptHistorySql.countPendingForGame,
      { userId, gameTitleNorm: normalized },
      (row: { CNT: number }) => Number(row.CNT ?? 0),
    );
    return rows[0] ?? 0;
  }

  static async countPendingForUser(userId: string): Promise<number> {
    const rows = await dbQuery(
      PresencePromptHistorySql.countPendingForUser,
      { userId },
      (row: { CNT: number }) => Number(row.CNT ?? 0),
    );
    return rows[0] ?? 0;
  }
}
