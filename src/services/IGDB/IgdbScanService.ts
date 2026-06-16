import { pgQuery } from "../../db/postgresClient.js";
import Game from "../../classes/Game.js";
import { refreshReleaseDates } from "../../functions/GameIgdbSync.js";
import { igdbService } from "./IgdbService.js";
import { sleep } from "../../utilities/DelayUtils.js";
import { logError, logInfo, logWarn } from "../../utilities/LogUtils.js";

type IgdbScanConfig = {
  enabled: boolean;
  intervalMs: number;
  batchSize: number;
  minAgeDays: number;
  throttleMs: number;
};

type IgdbScanCandidate = {
  gameId: number;
  title: string;
  igdbId: number;
  updatedAt: Date | null;
};

const DEFAULT_SCAN_INTERVAL_MINUTES = 15;
const DEFAULT_SCAN_BATCH_SIZE = 25;
const DEFAULT_SCAN_MIN_AGE_DAYS = 30;
const DEFAULT_SCAN_THROTTLE_MS = 300;

function parseNumberEnv(name: string, fallback: number, min?: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  if (min !== undefined && value < min) return fallback;
  return value;
}

function getScanConfig(): IgdbScanConfig {
  return {
    enabled: process.env.IGDB_SCAN_ENABLED !== "false",
    intervalMs: parseNumberEnv("IGDB_SCAN_INTERVAL_MINUTES", DEFAULT_SCAN_INTERVAL_MINUTES, 1)
      * 60
      * 1000,
    batchSize: parseNumberEnv("IGDB_SCAN_BATCH_SIZE", DEFAULT_SCAN_BATCH_SIZE, 1),
    minAgeDays: parseNumberEnv("IGDB_SCAN_MIN_AGE_DAYS", DEFAULT_SCAN_MIN_AGE_DAYS, 0),
    throttleMs: parseNumberEnv("IGDB_SCAN_THROTTLE_MS", DEFAULT_SCAN_THROTTLE_MS, 0),
  };
}

function hasIgdbConfig(): boolean {
  return Boolean(process.env.IGDB_CLIENT_ID && process.env.IGDB_CLIENT_SECRET);
}

async function listScanCandidates(
  cutoff: Date,
  limit: number,
): Promise<IgdbScanCandidate[]> {
  const rows = await pgQuery<{
    game_id: number;
    title: string;
    igdb_id: number;
    updated_at: Date | null;
  }>(
    `SELECT game_id, title, igdb_id, updated_at
       FROM gamedb_games
      WHERE igdb_id IS NOT NULL
        AND (updated_at IS NULL OR updated_at < :cutoff)
      ORDER BY updated_at NULLS FIRST, game_id
      LIMIT :limit`,
    { cutoff, limit },
  );

  return rows.map((row) => ({
    gameId: Number(row.game_id),
    title: String(row.title),
    igdbId: Number(row.igdb_id),
    updatedAt: row.updated_at ? new Date(row.updated_at) : null,
  }));
}

async function countScanCandidates(cutoff: Date): Promise<number> {
  const rows = await pgQuery<{ total: string }>(
    `SELECT COUNT(*) AS total
       FROM gamedb_games
      WHERE igdb_id IS NOT NULL
        AND (updated_at IS NULL OR updated_at < :cutoff)`,
    { cutoff },
  );
  return Number(rows[0]?.total ?? 0);
}

export async function igdbScanTick(): Promise<void> {
  const config = getScanConfig();
  if (!config.enabled) return;
  if (!hasIgdbConfig()) {
    logWarn("IgdbScanService.tick", "IGDB credentials not configured; skipping scan.");
    return;
  }

  const cutoff = new Date(Date.now() - (config.minAgeDays * 24 * 60 * 60 * 1000));

  try {
    const totalEligible = await countScanCandidates(cutoff);
    const candidates = await listScanCandidates(cutoff, config.batchSize);
    if (!candidates.length) {
      logInfo("IgdbScanService", {
        message: "No games queued for refresh.",
        intervalMin: (config.intervalMs / 60000).toFixed(1),
        batch: config.batchSize,
        minAgeDays: config.minAgeDays,
        remaining: totalEligible,
      });
      return;
    }

    let successCount = 0;
    let failCount = 0;
    let releaseUpdated = 0;
    let descriptionUpdated = 0;
    const startedAt = Date.now();

    for (const candidate of candidates) {
      try {
        const details = await igdbService.getGameDetails(candidate.igdbId);
        if (!details) {
          logWarn(
            "IgdbScanService.refreshCandidate",
            `No IGDB details returned for ${candidate.title} (ID: ${candidate.gameId}).`,
          );
          await Game.touchGameUpdatedAt(candidate.gameId);
          continue;
        }

        const summary = details.summary?.trim() ?? "";
        if (summary.length > 0) {
          await Game.updateGameDescription(candidate.gameId, summary);
          descriptionUpdated++;
        }

        const releases = details.release_dates ?? [];
        if (releases.length > 0) {
          await refreshReleaseDates(candidate.gameId, releases);
          releaseUpdated++;
        }

        await Game.touchGameUpdatedAt(candidate.gameId);
        successCount++;

        if (config.throttleMs > 0) {
          await sleep(config.throttleMs);
        }
      } catch (err: any) {
        failCount++;
        logError("IgdbScanService.refreshCandidate", err?.message ?? err);
      }
    }

    const elapsedMs = Date.now() - startedAt;
    const remaining = Math.max(totalEligible - candidates.length, 0);
    logInfo("IgdbScanService", {
      message: "Completed batch.",
      intervalMin: (config.intervalMs / 60000).toFixed(1),
      batch: config.batchSize,
      minAgeDays: config.minAgeDays,
      totalEligible,
      remaining,
      success: successCount,
      failed: failCount,
      descriptions: descriptionUpdated,
      releases: releaseUpdated,
      elapsedSec: (elapsedMs / 1000).toFixed(1),
    });
  } catch (err) {
    logError("IgdbScanService.batch", err);
  }
}

export function startIgdbScanService(): void {
  const config = getScanConfig();
  if (!config.enabled) {
    logInfo("IgdbScanService", "IGDB_SCAN_ENABLED is false; service disabled.");
    return;
  }

  let isRunning = false;
  const tick = async () => {
    if (isRunning) {
      logWarn("IgdbScanService.tick", "Previous scan still running; skipping.");
      return;
    }
    isRunning = true;
    try {
      await igdbScanTick();
    } finally {
      isRunning = false;
    }
  };

  void tick();
  setInterval(() => {
    void tick();
  }, config.intervalMs);
}
