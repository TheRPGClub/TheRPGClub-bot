import { oraQuery, oraMutate } from "../db/SqlManager.js";

const OPT_OUT_ALL_TOKEN = "__ALL__";

export function normalizePresenceGameTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export default class PresencePromptOptOut {
  static async isOptedOutAll(userId: string): Promise<boolean> {
    const rows = await oraQuery(
      `SELECT COUNT(*) AS CNT
         FROM RPG_CLUB_PRESENCE_PROMPT_OPTS
        WHERE USER_ID = :userId
          AND SCOPE = 'ALL'
          AND GAME_TITLE_NORM = :token`,
      { userId, token: OPT_OUT_ALL_TOKEN },
      (row: { CNT: number }) => Number(row.CNT ?? 0),
    );
    return (rows[0] ?? 0) > 0;
  }

  static async isOptedOutGame(userId: string, gameTitle: string): Promise<boolean> {
    const normalized = normalizePresenceGameTitle(gameTitle);
    if (!normalized) return false;

    const rows = await oraQuery(
      `SELECT COUNT(*) AS CNT
         FROM RPG_CLUB_PRESENCE_PROMPT_OPTS
        WHERE USER_ID = :userId
          AND SCOPE = 'GAME'
          AND GAME_TITLE_NORM = :gameTitleNorm`,
      { userId, gameTitleNorm: normalized },
      (row: { CNT: number }) => Number(row.CNT ?? 0),
    );
    return (rows[0] ?? 0) > 0;
  }

  static async addOptOutAll(userId: string): Promise<void> {
    await this.insertOptOut(userId, "ALL", OPT_OUT_ALL_TOKEN, null);
  }

  static async addOptOutGame(userId: string, gameTitle: string): Promise<void> {
    const normalized = normalizePresenceGameTitle(gameTitle);
    if (!normalized) return;
    await this.insertOptOut(userId, "GAME", normalized, gameTitle);
  }

  private static async insertOptOut(
    userId: string,
    scope: "ALL" | "GAME",
    normalizedTitle: string,
    gameTitle: string | null,
  ): Promise<void> {
    try {
      await oraMutate(
        `INSERT INTO RPG_CLUB_PRESENCE_PROMPT_OPTS
          (USER_ID, SCOPE, GAME_TITLE, GAME_TITLE_NORM)
         VALUES (:userId, :scope, :gameTitle, :gameTitleNorm)`,
        { userId, scope, gameTitle, gameTitleNorm: normalizedTitle },
      );
    } catch (err: any) {
      const code = err?.code ?? err?.errorNum;
      if (code !== "ORA-00001") {
        throw err;
      }
    }
  }
}
