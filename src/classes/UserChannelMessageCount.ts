import oracledb from "oracledb";
import { dbQuery, oraWithConnection } from "../db/SqlManager.js";
import { getDialect } from "../db/dialect.js";
import { getSql } from "../db/SqlManager.js";
import { UserChannelMessageCountSql } from "../db/sql/index.js";

const dialect = getDialect();

type ChannelCountBind = {
  userId: string;
  channelId: string;
  count: number;
  scanned: Date;
};

export default class UserChannelMessageCount {
  static async upsertChannelCounts(
    channelId: string,
    counts: Map<string, number>,
    scannedAt: Date,
  ): Promise<void> {
    if (!channelId || counts.size === 0) return;

    const rows: ChannelCountBind[] = Array.from(counts.entries()).map(
      ([userId, count]) => ({ userId, channelId, count, scanned: scannedAt }),
    );

    await oraWithConnection(async (conn) => {
      try {
        await conn.executeMany(
          getSql(UserChannelMessageCountSql.upsertChannelCounts, dialect),
          rows,
          {
            autoCommit: true,
            bindDefs: {
              userId: { type: oracledb.STRING, maxSize: 30 },
              channelId: { type: oracledb.STRING, maxSize: 30 },
              count: { type: oracledb.NUMBER },
              scanned: { type: oracledb.DATE },
            },
          },
        );
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        console.error(
          `[UserChannelMessageCount] Failed to upsert counts for channel` +
          ` ${channelId}: ${msg}`,
        );
      }
    });
  }

  static async getScannedChannelIds(): Promise<Set<string>> {
    try {
      const rows = await dbQuery(
        UserChannelMessageCountSql.getScannedChannelIds,
        [],
        (row: { CHANNEL_ID: string }) => row.CHANNEL_ID,
      );
      return new Set(rows.filter(Boolean));
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.error(`[UserChannelMessageCount] Failed to load scanned channel ids: ${msg}`);
      return new Set<string>();
    }
  }

  static async getChannelScanMeta(): Promise<Map<string, Date>> {
    try {
      const rows = await dbQuery(
        UserChannelMessageCountSql.getChannelScanMeta,
        [],
        (row: { CHANNEL_ID: string; LAST_SCANNED_AT: Date }) => row,
      );
      const map = new Map<string, Date>();
      for (const row of rows) {
        if (row.CHANNEL_ID && row.LAST_SCANNED_AT) {
          map.set(row.CHANNEL_ID, row.LAST_SCANNED_AT);
        }
      }
      return map;
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.error(
        `[UserChannelMessageCount] Failed to load channel scan metadata: ${msg}`,
      );
      return new Map<string, Date>();
    }
  }
}
