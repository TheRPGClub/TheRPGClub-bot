import { dbQuery, dbMutate, oraMutate, oraWithConnection } from "../db/SqlManager.js";
import { getDialect } from "../db/dialect.js";
import { getSql } from "../db/SqlManager.js";
import { GameReleaseAnnouncementSql } from "../db/sql/index.js";

const dialect = getDialect();

export interface IReleaseAnnouncementCandidate {
  releaseId: number;
  gameId: number;
  title: string;
  releaseDate: Date;
  announceAt: Date;
  platformName: string | null;
  platformAbbreviation: string | null;
  igdbUrl: string | null;
}

type ReleaseAnnouncementRow = {
  RELEASE_ID: number;
  GAME_ID: number;
  TITLE: string;
  RELEASE_DATE: Date | string;
  ANNOUNCE_AT: Date | string;
  PLATFORM_NAME: string | null;
  PLATFORM_ABBREVIATION: string | null;
  IGDB_URL: string | null;
};

const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 100;
const MISSED_WINDOW_REASON = "release-window-missed";
const PORT_ONLY_RELEASE_REASON = "port-only-release";
const SAME_DAY_DUPLICATE_REASON = "same-day-platform-duplicate";

function clampBatchSize(limit: number): number {
  const asNumber = Number(limit);
  if (!Number.isFinite(asNumber)) {
    return DEFAULT_BATCH_SIZE;
  }
  return Math.min(MAX_BATCH_SIZE, Math.max(1, Math.floor(asNumber)));
}

function parseDate(value: Date | string): Date {
  if (value instanceof Date) {
    return value;
  }
  return new Date(value);
}

function mapCandidateRow(row: ReleaseAnnouncementRow): IReleaseAnnouncementCandidate {
  return {
    releaseId: Number(row.RELEASE_ID),
    gameId: Number(row.GAME_ID),
    title: String(row.TITLE),
    releaseDate: parseDate(row.RELEASE_DATE),
    announceAt: parseDate(row.ANNOUNCE_AT),
    platformName: row.PLATFORM_NAME ? String(row.PLATFORM_NAME) : null,
    platformAbbreviation: row.PLATFORM_ABBREVIATION
      ? String(row.PLATFORM_ABBREVIATION)
      : null,
    igdbUrl: row.IGDB_URL ? String(row.IGDB_URL) : null,
  };
}

export default class GameReleaseAnnouncement {
  static async syncReleaseAnnouncements(): Promise<void> {
    await oraWithConnection(async (conn) => {
      await oraMutate(
        getSql(GameReleaseAnnouncementSql.syncReleaseAnnouncements, dialect),
        {},
        conn,
      );
      await conn.commit();

      await oraMutate(
        getSql(GameReleaseAnnouncementSql.restoreNonCanonical, dialect),
        { portOnlyReason: PORT_ONLY_RELEASE_REASON, sameDayReason: SAME_DAY_DUPLICATE_REASON },
        conn,
      );
      await conn.commit();
    });
  }

  static async markNonCanonicalAnnouncements(): Promise<number> {
    return dbMutate(
      GameReleaseAnnouncementSql.markNonCanonical,
      { portOnlyReason: PORT_ONLY_RELEASE_REASON, sameDayReason: SAME_DAY_DUPLICATE_REASON },
    );
  }

  static async listDueAnnouncements(
    referenceTime: Date,
    limit: number = DEFAULT_BATCH_SIZE,
  ): Promise<IReleaseAnnouncementCandidate[]> {
    const safeLimit = clampBatchSize(limit);
    return dbQuery(
      GameReleaseAnnouncementSql.listDueAnnouncements,
      { referenceTime, limit: safeLimit },
      mapCandidateRow,
    );
  }

  static async markAnnouncementSent(releaseId: number, sentAt: Date): Promise<boolean> {
    const count = await dbMutate(
      GameReleaseAnnouncementSql.markSent,
      { releaseId, sentAt },
    );
    return count > 0;
  }

  static async markMissedAnnouncements(referenceTime: Date): Promise<number> {
    return dbMutate(
      GameReleaseAnnouncementSql.markMissed,
      { referenceTime, reason: MISSED_WINDOW_REASON },
    );
  }
}
