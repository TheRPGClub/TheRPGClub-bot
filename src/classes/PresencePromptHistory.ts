import { oraQuery, oraMutate } from "../db/SqlManager.js";
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
    await oraMutate(
      `INSERT INTO RPG_CLUB_PRESENCE_PROMPT_HISTORY
        (PROMPT_ID, USER_ID, GAME_TITLE, GAME_TITLE_NORM, STATUS)
       VALUES (:promptId, :userId, :gameTitle, :gameTitleNorm, 'PENDING')`,
      { promptId, userId, gameTitle, gameTitleNorm: normalized },
    );
  }

  static async markResolved(promptId: string, status: PresencePromptStatus): Promise<void> {
    await oraMutate(
      `UPDATE RPG_CLUB_PRESENCE_PROMPT_HISTORY
          SET STATUS = :status,
              RESOLVED_AT = SYSTIMESTAMP
        WHERE PROMPT_ID = :promptId`,
      { status, promptId },
    );
  }

  static async getLastPromptDateForGame(
    userId: string,
    gameTitle: string,
  ): Promise<Date | null> {
    const normalized = normalizePresenceGameTitle(gameTitle);
    const rows = await oraQuery(
      `SELECT CREATED_AT
         FROM RPG_CLUB_PRESENCE_PROMPT_HISTORY
        WHERE USER_ID = :userId
          AND GAME_TITLE_NORM = :gameTitleNorm
        ORDER BY CREATED_AT DESC
        FETCH NEXT 1 ROWS ONLY`,
      { userId, gameTitleNorm: normalized },
      (row: { CREATED_AT: Date | string }) =>
        row.CREATED_AT instanceof Date ? row.CREATED_AT : new Date(row.CREATED_AT as string),
    );
    return rows[0] ?? null;
  }

  static async countPendingForGame(userId: string, gameTitle: string): Promise<number> {
    const normalized = normalizePresenceGameTitle(gameTitle);
    const rows = await oraQuery(
      `SELECT COUNT(*) AS CNT
         FROM RPG_CLUB_PRESENCE_PROMPT_HISTORY
        WHERE USER_ID = :userId
          AND GAME_TITLE_NORM = :gameTitleNorm
          AND STATUS = 'PENDING'`,
      { userId, gameTitleNorm: normalized },
      (row: { CNT: number }) => Number(row.CNT ?? 0),
    );
    return rows[0] ?? 0;
  }

  static async countPendingForUser(userId: string): Promise<number> {
    const rows = await oraQuery(
      `SELECT COUNT(*) AS CNT
         FROM RPG_CLUB_PRESENCE_PROMPT_HISTORY
        WHERE USER_ID = :userId
          AND STATUS = 'PENDING'`,
      { userId },
      (row: { CNT: number }) => Number(row.CNT ?? 0),
    );
    return rows[0] ?? 0;
  }
}
