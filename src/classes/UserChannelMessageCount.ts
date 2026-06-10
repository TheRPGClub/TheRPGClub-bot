import { dbQuery, dbTransaction, dbMutateConn } from "../db/SqlManager.js";
import { UserChannelMessageCountSql } from "../db/sql/index.js";
import { logError } from "../utilities/LogUtils.js";

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

    try {
      await dbTransaction(async (conn) => {
        for (const row of rows) {
          await dbMutateConn(conn, UserChannelMessageCountSql.upsertChannelCounts, row);
        }
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      logError("UserChannelMessageCount.upsertCounts", msg);
    }
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
      logError("UserChannelMessageCount.loadScannedChannelIds", msg);
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
      logError("UserChannelMessageCount.loadChannelScanMetadata", msg);
      return new Map<string, Date>();
    }
  }
}
