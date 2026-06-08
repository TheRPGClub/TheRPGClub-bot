import { oraQuery, oraMutate } from "../db/SqlManager.js";
import { getDialect } from "../db/dialect.js";
import { getSql } from "../db/SqlManager.js";
import { PresencePromptOptOutSql } from "../db/sql/index.js";

const dialect = getDialect();

const OPT_OUT_ALL_TOKEN = "__ALL__";

export function normalizePresenceGameTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export default class PresencePromptOptOut {
  static async isOptedOutAll(userId: string): Promise<boolean> {
    const rows = await oraQuery(
      getSql(PresencePromptOptOutSql.isOptedOutAll, dialect),
      { userId, token: OPT_OUT_ALL_TOKEN },
      (row: { CNT: number }) => Number(row.CNT ?? 0),
    );
    return (rows[0] ?? 0) > 0;
  }

  static async isOptedOutGame(userId: string, gameTitle: string): Promise<boolean> {
    const normalized = normalizePresenceGameTitle(gameTitle);
    if (!normalized) return false;

    const rows = await oraQuery(
      getSql(PresencePromptOptOutSql.isOptedOutGame, dialect),
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
        getSql(PresencePromptOptOutSql.insertOptOut, dialect),
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
