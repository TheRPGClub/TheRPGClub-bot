import axios from "axios";
import {
  dbQuery,
  dbMutate,
  dbInsert,
  dbTransaction,
  dbMutateConn,
} from "../db/SqlManager.js";
import { GameSql } from "../db/sql/index.js";
import {
  type IGDBGameDetails,
  igdbService,
} from "../services/IGDB/IgdbService.js";
import { isPositiveInt } from "../utilities/ValidationUtils.js";
import { safeIgnore } from "../utilities/AsyncUtils.js";
import { logError, logWarn } from "../utilities/LogUtils.js";
import { clearAutocompleteSearchCaches } from "./GameAutocompleteCache.js";
import Game from "../classes/Game.js";

type IGDBReleaseDate = NonNullable<IGDBGameDetails["release_dates"]>[number];

async function getOrInsertMetadata(
  table: string,
  idCol: string,
  nameCol: string,
  igdbIdCol: string,
  name: string,
  igdbId: number,
): Promise<number> {
  const rows = await dbQuery(
    GameSql.getOrInsertMetadataSelect(idCol, table, igdbIdCol),
    { igdbId },
    (row: Record<string, number>) => {
      const val = row[idCol] ?? row[idCol.toLowerCase()];
      return Number(val);
    },
  );
  if (rows.length > 0) return rows[0];

  return dbInsert(
    GameSql.getOrInsertMetadataInsert(table, nameCol, idCol, igdbIdCol),
    { name, igdbId },
    "id",
  );
}

function resolveReleaseDate(release: IGDBReleaseDate): Date | null {
  if (release.date) {
    return new Date(release.date * 1000);
  }
  if (!release.y) {
    return null;
  }
  const month = release.m ? release.m - 1 : 0;
  return new Date(Date.UTC(release.y, month, 1));
}

export async function updateInitialReleaseDate(gameId: number): Promise<void> {
  const rows = await dbQuery(
    GameSql.updateInitialReleaseDateSelect,
    { gameId },
    (row: { MIN_DATE: Date | null }) => row.MIN_DATE,
  );
  const minDate = rows[0] ?? null;
  if (!minDate) return;
  await dbMutate(GameSql.updateInitialReleaseDateUpdate, {
    releaseDate: minDate,
    gameId,
  });
}

export async function saveReleaseDates(
  gameId: number,
  releases: NonNullable<IGDBGameDetails["release_dates"]>,
): Promise<void> {
  if (!releases.length) return;

  const existing = await Game.getGameReleases(gameId);
  const existingPlatformIds = new Set(
    existing.map((release) => release.platformId),
  );

  const earliestByPlatform = new Map<
    number,
    { release: IGDBReleaseDate; date: Date }
  >();
  for (const release of releases) {
    if (release.region === 5) continue;

    const platformId = release.platform?.id;
    if (!platformId) continue;
    const releaseDate = resolveReleaseDate(release);
    if (!releaseDate) continue;

    const current = earliestByPlatform.get(platformId);
    if (!current || releaseDate < current.date) {
      earliestByPlatform.set(platformId, { release, date: releaseDate });
    }
  }

  for (const { release, date } of earliestByPlatform.values()) {
    if (!release.platform?.id) continue;

    const platform = await Game.ensurePlatform({
      id: release.platform.id,
      name: release.platform.name ?? null,
    });
    if (!platform) continue;

    if (existingPlatformIds.has(platform.id)) {
      continue;
    }

    const region = await Game.ensureRegion(release.region ?? 8);
    if (!region) continue;

    const format: "Physical" | "Digital" | null = null;

    await Game.addReleaseInfo(gameId, platform.id, region.id, format, date, null);
  }

  await updateInitialReleaseDate(gameId);
}

export async function saveFullGameMetadata(
  gameId: number,
  details: IGDBGameDetails,
): Promise<void> {
  if (details.involved_companies) {
    for (const ic of details.involved_companies) {
      const companyId = await getOrInsertMetadata(
        "GAMEDB_COMPANIES",
        "COMPANY_ID",
        "NAME",
        "IGDB_COMPANY_ID",
        ic.company.name,
        ic.company.id,
      );
      safeIgnore(
        dbMutate(GameSql.insertGameCompany, {
          gameId,
          companyId,
          role: ic.developer ? "Developer" : ic.publisher ? "Publisher" : null,
        }),
      );
    }
  }

  if (details.genres) {
    for (const g of details.genres) {
      const genreId = await getOrInsertMetadata(
        "GAMEDB_GENRES",
        "GENRE_ID",
        "NAME",
        "IGDB_GENRE_ID",
        g.name,
        g.id,
      );
      safeIgnore(dbMutate(GameSql.insertGameGenre, { gameId, genreId }));
    }
  }

  if (details.themes) {
    for (const t of details.themes) {
      const themeId = await getOrInsertMetadata(
        "GAMEDB_THEMES",
        "THEME_ID",
        "NAME",
        "IGDB_THEME_ID",
        t.name,
        t.id,
      );
      safeIgnore(dbMutate(GameSql.insertGameTheme, { gameId, themeId }));
    }
  }

  if (details.game_modes) {
    for (const gm of details.game_modes) {
      const modeId = await getOrInsertMetadata(
        "GAMEDB_GAME_MODES_DEF",
        "MODE_ID",
        "NAME",
        "IGDB_GAME_MODE_ID",
        gm.name,
        gm.id,
      );
      safeIgnore(dbMutate(GameSql.insertGameMode, { gameId, modeId }));
    }
  }

  if (details.player_perspectives) {
    for (const pp of details.player_perspectives) {
      const persId = await getOrInsertMetadata(
        "GAMEDB_PERSPECTIVES",
        "PERSPECTIVE_ID",
        "NAME",
        "IGDB_PERSPECTIVE_ID",
        pp.name,
        pp.id,
      );
      safeIgnore(dbMutate(GameSql.insertGamePerspective, { gameId, persId }));
    }
  }

  if (details.game_engines) {
    for (const e of details.game_engines) {
      const engineId = await getOrInsertMetadata(
        "GAMEDB_ENGINES",
        "ENGINE_ID",
        "NAME",
        "IGDB_ENGINE_ID",
        e.name,
        e.id,
      );
      safeIgnore(dbMutate(GameSql.insertGameEngine, { gameId, engineId }));
    }
  }

  if (details.franchises) {
    for (const f of details.franchises) {
      const franchiseId = await getOrInsertMetadata(
        "GAMEDB_FRANCHISES",
        "FRANCHISE_ID",
        "NAME",
        "IGDB_FRANCHISE_ID",
        f.name,
        f.id,
      );
      safeIgnore(
        dbMutate(GameSql.insertGameFranchise, { gameId, franchiseId }),
      );
    }
  }

  if (details.collection) {
    const collectionId = await getOrInsertMetadata(
      "GAMEDB_COLLECTIONS",
      "COLLECTION_ID",
      "NAME",
      "IGDB_COLLECTION_ID",
      details.collection.name,
      details.collection.id,
    );
    await dbMutate(GameSql.updateCollectionId, { collectionId, gameId });
  }

  if (details.parent_game) {
    await dbMutate(GameSql.updateParentIgdbId, {
      parentId: details.parent_game.id,
      parentName: details.parent_game.name,
      gameId,
    });
  }

  await saveReleaseDates(gameId, details.release_dates ?? []);
}

export async function importGameFromIgdb(
  igdbId: number,
): Promise<{ gameId: number; title: string }> {
  const existing = await Game.getGameByIgdbId(igdbId);
  if (existing) {
    clearAutocompleteSearchCaches();
    return { gameId: existing.id, title: existing.title };
  }

  const details = await igdbService.getGameDetails(igdbId);
  if (!details) {
    throw new Error("Failed to load game details from IGDB.");
  }

  let imageData: Buffer | null = null;
  if (details.cover?.image_id) {
    try {
      const imageUrl =
        `https://images.igdb.com/igdb/image/upload/t_cover_big/${details.cover.image_id}.jpg`;
      const imageResponse = await axios.get(imageUrl, {
        responseType: "arraybuffer",
      });
      imageData = Buffer.from(imageResponse.data);
    } catch (err) {
      logError("Game.downloadCoverImage", err);
    }
  }

  let newGame = null;
  try {
    newGame = await Game.createGame(
      details.name,
      details.summary ?? "",
      imageData,
      details.id,
      details.slug ?? null,
      details.total_rating ?? null,
      details.url ?? null,
      Game.getFeaturedVideoUrl(details),
    );
  } catch (err: any) {
    const message = err?.message ?? "";
    const isUniqueViolation = message.includes("ORA-00001");
    const isIgdbConstraint = message.includes("UQ_GAMEDB_GAMES_IGDB_ID");
    if (isUniqueViolation && isIgdbConstraint) {
      const raceExisting = await Game.getGameByIgdbId(details.id);
      if (raceExisting) {
        return { gameId: raceExisting.id, title: raceExisting.title };
      }
      throw new Error(
        "Game already exists with this IGDB ID, but could not be loaded.",
      );
    }
    throw err;
  }
  await saveFullGameMetadata(newGame.id, details);
  clearAutocompleteSearchCaches();
  return { gameId: newGame.id, title: details.name };
}

export async function importReleaseDatesFromIgdb(
  gameId: number,
  igdbId: number,
): Promise<void> {
  const details = await igdbService.getGameDetails(igdbId);
  if (!details) {
    throw new Error("Failed to load game details from IGDB.");
  }
  await saveReleaseDates(gameId, details.release_dates ?? []);
}

export async function addGamePlatformsByIgdbIds(
  gameId: number,
  igdbPlatformIds: number[],
): Promise<void> {
  if (!isPositiveInt(gameId)) return;
  const uniqueIds = Array.from(
    new Set(igdbPlatformIds.filter(isPositiveInt)),
  );
  if (!uniqueIds.length) return;

  const platformMap = await Game.getPlatformsByIgdbIds(uniqueIds);
  const missingIds = uniqueIds.filter((id) => !platformMap.has(id));
  if (missingIds.length) {
    logWarn(
      "Game.syncIgdbPlatforms",
      `Missing IGDB platform IDs in GAMEDB_PLATFORMS: ${missingIds.join(", ")}`,
    );
  }

  await dbTransaction(async (conn) => {
    for (const igdbId of uniqueIds) {
      const platform = platformMap.get(igdbId);
      if (!platform) continue;
      await dbMutateConn(conn, GameSql.addGamePlatformMerge, {
        gameId,
        platformId: platform.id,
      });
    }
  });
}
