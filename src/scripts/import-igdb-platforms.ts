import "dotenv/config";
import oracledb from "oracledb";
import { initOraclePool, getOraclePool } from "../db/oracleClient.js";
import { oraQuery, oraMutate, oraWithConnection } from "../db/SqlManager.js";
import { igdbService, type IGDBPlatform } from "../services/IGDB/IgdbService.js";

type UpsertResult = "inserted" | "updated" | "unchanged";
type WriteMode = "write" | "dry-run";

const DEFAULT_LIMIT: number = 500;
const RATE_LIMIT_DELAY_MS: number = 300;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const normalizeCode = (input: string): string =>
  input.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

const buildFallbackCode = (name: string, igdbId: number): string => {
  const platformName: string = name || `IGDB Platform ${igdbId}`;
  const sanitized: string = normalizeCode(platformName);
  const base: string = sanitized.slice(0, 12) || "PLATFORM";
  const codeWithId: string = `${base}${igdbId}`;
  return codeWithId.length > 20 ? codeWithId.slice(0, 20) : codeWithId;
};

const derivePlatformCode = (platform: IGDBPlatform): string => {
  const raw: string = platform.abbreviation || platform.slug || platform.name;
  const sanitized: string = normalizeCode(raw);
  if (!sanitized) {
    const fallback: string = `PLAT${platform.id}`;
    return fallback.length > 20 ? fallback.slice(0, 20) : fallback;
  }
  return sanitized.length > 20 ? sanitized.slice(0, 20) : sanitized;
};

const normalizeOptional = (value: string | undefined): string | null => {
  if (!value) return null;
  const trimmed: string = value.trim();
  return trimmed ? trimmed : null;
};

const normalizeChecksum = (value: string | undefined): string | null =>
  normalizeOptional(value);

const normalizeUpdatedAt = (value: number | undefined): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.floor(value);
};

const validatePlatform = (platform: IGDBPlatform): string | null => {
  if (!platform || typeof platform.id !== "number" || !Number.isFinite(platform.id)) {
    return "Missing or invalid id";
  }
  if (!platform.name || !platform.name.trim()) {
    return "Missing name";
  }
  return null;
};

const codeConflicts = async (
  conn: oracledb.Connection,
  code: string,
  igdbId: number,
): Promise<boolean> => {
  const rows = await oraQuery(
    `SELECT PLATFORM_ID
       FROM GAMEDB_PLATFORMS
      WHERE PLATFORM_CODE = :code
        AND (IGDB_PLATFORM_ID IS NULL OR IGDB_PLATFORM_ID != :igdbId)`,
    { code, igdbId },
    (row: { PLATFORM_ID: number }) => row,
    conn,
  );
  return rows.length > 0;
};

const resolvePlatformCode = async (
  conn: oracledb.Connection,
  platform: IGDBPlatform,
): Promise<string> => {
  const preferred: string = derivePlatformCode(platform);
  if (!(await codeConflicts(conn, preferred, platform.id))) {
    return preferred;
  }

  const fallback: string = buildFallbackCode(platform.name, platform.id);
  if (!(await codeConflicts(conn, fallback, platform.id))) {
    return fallback;
  }

  const lastResort: string = `PLAT${platform.id}`;
  return lastResort.length > 20 ? lastResort.slice(0, 20) : lastResort;
};

type ExistingPlatformRow = {
  PLATFORM_ID: number;
  PLATFORM_CODE: string;
  PLATFORM_NAME: string;
  PLATFORM_ABBREVIATION: string | null;
  PLATFORM_SLUG: string | null;
  PLATFORM_CHECKSUM: string | null;
  IGDB_UPDATED_AT: number | null;
  IGDB_PLATFORM_ID: number;
};

const upsertPlatform = async (
  conn: oracledb.Connection,
  platform: IGDBPlatform,
  mode: WriteMode,
): Promise<UpsertResult> => {
  const existingRows = await oraQuery(
    `SELECT PLATFORM_ID, PLATFORM_CODE, PLATFORM_NAME,
            PLATFORM_ABBREVIATION, PLATFORM_SLUG, PLATFORM_CHECKSUM, IGDB_UPDATED_AT,
            IGDB_PLATFORM_ID
       FROM GAMEDB_PLATFORMS
      WHERE IGDB_PLATFORM_ID = :igdbId`,
    { igdbId: platform.id },
    (row: ExistingPlatformRow) => row,
    conn,
  );

  const existingRow = existingRows[0] ?? null;

  const desiredName: string = platform.name.trim();
  const desiredCode: string = await resolvePlatformCode(conn, platform);
  const desiredAbbrev: string | null = normalizeOptional(platform.abbreviation);
  const desiredSlug: string | null = normalizeOptional(platform.slug);
  const desiredChecksum: string | null = normalizeChecksum(platform.checksum);
  const desiredUpdatedAt: number | null = normalizeUpdatedAt(platform.updated_at);

  if (!existingRow) {
    if (mode === "write") {
      await oraMutate(
        `INSERT INTO GAMEDB_PLATFORMS (
           PLATFORM_CODE,
           PLATFORM_NAME,
           PLATFORM_ABBREVIATION,
           PLATFORM_SLUG,
           PLATFORM_CHECKSUM,
           IGDB_UPDATED_AT,
           IGDB_PLATFORM_ID
         )
         VALUES (
           :code,
           :name,
           :abbreviation,
           :slug,
           :checksum,
           :updatedAt,
           :igdbId
         )`,
        {
          code: desiredCode,
          name: desiredName,
          abbreviation: desiredAbbrev,
          slug: desiredSlug,
          checksum: desiredChecksum,
          updatedAt: desiredUpdatedAt,
          igdbId: platform.id,
        },
        conn,
      );
    }
    return "inserted";
  }

  const currentName: string = String(existingRow.PLATFORM_NAME);
  const currentAbbrev: string | null =
    existingRow.PLATFORM_ABBREVIATION !== null
      ? String(existingRow.PLATFORM_ABBREVIATION)
      : null;
  const currentSlug: string | null =
    existingRow.PLATFORM_SLUG !== null ? String(existingRow.PLATFORM_SLUG) : null;
  const currentChecksum: string | null =
    existingRow.PLATFORM_CHECKSUM !== null
      ? String(existingRow.PLATFORM_CHECKSUM)
      : null;
  const currentUpdatedAt: number | null =
    existingRow.IGDB_UPDATED_AT !== null ? Number(existingRow.IGDB_UPDATED_AT) : null;

  const needsUpdate: boolean =
    currentName !== desiredName ||
    currentAbbrev !== desiredAbbrev ||
    currentSlug !== desiredSlug ||
    currentChecksum !== desiredChecksum ||
    currentUpdatedAt !== desiredUpdatedAt;

  if (!needsUpdate) {
    return "unchanged";
  }

  if (mode === "write") {
    await oraMutate(
      `UPDATE GAMEDB_PLATFORMS
          SET PLATFORM_NAME = :name,
              PLATFORM_ABBREVIATION = :abbreviation,
              PLATFORM_SLUG = :slug,
              PLATFORM_CHECKSUM = :checksum,
              IGDB_UPDATED_AT = :updatedAt
        WHERE PLATFORM_ID = :platformId`,
      {
        name: desiredName,
        abbreviation: desiredAbbrev,
        slug: desiredSlug,
        checksum: desiredChecksum,
        updatedAt: desiredUpdatedAt,
        platformId: existingRow.PLATFORM_ID,
      },
      conn,
    );
  }
  return "updated";
};

const main = async (): Promise<void> => {
  const args: string[] = process.argv.slice(2);
  const mode: WriteMode = args.includes("--dry-run") ? "dry-run" : "write";
  await initOraclePool();

  let offset: number = 0;
  let page: number = 1;
  let totalInserted: number = 0;
  let totalUpdated: number = 0;
  let totalSeen: number = 0;
  let totalSkipped: number = 0;

  await oraWithConnection(async (conn) => {
    try {
      while (true) {
        const platforms: IGDBPlatform[] =
          await igdbService.getPlatformsPage(DEFAULT_LIMIT, offset);
        const pageCount: number = platforms.length;
        totalSeen += pageCount;

        let pageInserted: number = 0;
        let pageUpdated: number = 0;
        let pageSkipped: number = 0;

        try {
          for (const platform of platforms) {
            const invalidReason: string | null = validatePlatform(platform);
            if (invalidReason) {
              console.warn(
                `Skipping platform with invalid data (id: ${String(platform?.id)}): ${invalidReason}`,
              );
              pageSkipped += 1;
              continue;
            }
            const result: UpsertResult = await upsertPlatform(conn, platform, mode);
            if (result === "inserted") pageInserted += 1;
            if (result === "updated") pageUpdated += 1;
          }

          if (mode === "write") {
            await conn.commit();
          }
        } catch (err) {
          if (mode === "write") {
            await conn.rollback();
          }
          throw err;
        }

        totalInserted += pageInserted;
        totalUpdated += pageUpdated;
        totalSkipped += pageSkipped;

        console.log(
          `Page ${page} (offset ${offset}) - fetched ${pageCount}, ` +
          `inserted ${pageInserted}, updated ${pageUpdated}, skipped ${pageSkipped}` +
          (mode === "dry-run" ? " [dry-run]" : ""),
        );

        if (pageCount < DEFAULT_LIMIT) {
          break;
        }

        offset += DEFAULT_LIMIT;
        page += 1;
        await sleep(RATE_LIMIT_DELAY_MS);
      }

      console.log(
        `Done. Total fetched ${totalSeen}, inserted ${totalInserted}, ` +
        `updated ${totalUpdated}, skipped ${totalSkipped}` +
        (mode === "dry-run" ? " [dry-run]." : "."),
      );
    } finally {
      await getOraclePool().close(0);
    }
  });
};

main().catch((err: unknown) => {
  const message: string = err instanceof Error ? err.message : String(err);
  console.error("Import failed:", message);
  process.exitCode = 1;
});
