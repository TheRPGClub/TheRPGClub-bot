import oracledb from "oracledb";
import axios from "axios";
import {
  oraQuery,
  oraMutate,
  oraWithConnection,
  oraTransaction,
} from "../db/SqlManager.js";
import { getDialect } from "../db/dialect.js";
import { getSql } from "../db/SqlManager.js";
import { GameSql } from "../db/sql/index.js";

const dialect = getDialect();
import { IGDBGameDetails, igdbService } from "../services/IGDB/IgdbService.js";
import GameSearchSynonym from "./GameSearchSynonym.js";
import {
  apiGet,
  apiGetRaw,
  type ApiGetRawMeta,
} from "../services/RpgClubApiClient.js";

// Interfaces
export interface IGame {
  id: number;
  title: string;
  description: string | null;
  imageData: Buffer | null; // BLOB
  thumbnailBad: boolean;
  thumbnailApproved: boolean;
  igdbId: number | null;
  slug: string | null;
  totalRating: number | null;
  igdbUrl: string | null;
  featuredVideoUrl: string | null;
  initialReleaseDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  coverUrl: string | null;
}

export interface IRelease {
  id: number;
  gameId: number;
  platformId: number;
  regionId: number;
  format: "Physical" | "Digital" | null;
  releaseDate: Date | null;
  notes: string | null;
}

export interface IPlatformDef {
  id: number;
  code: string;
  name: string;
  abbreviation: string | null;
  igdbPlatformId: number | null;
}

export interface IGameWithPlatforms extends IGame {
  platforms: IPlatformDef[];
}

export interface IGameSearchResult extends IGameWithPlatforms {
  upcomingReleaseDate: Date | null;
  upcomingReleasePlatforms: string[];
}

export interface IGameAutocompleteResult {
  id: number;
  title: string;
  initialReleaseDate: Date | null;
}

export interface IRegionDef {
  id: number;
  code: string;
  name: string;
  igdbRegionId: number | null;
}

export interface ICompany {
  id: number;
  name: string;
  igdbId: number | null;
}
export interface IGenre {
  id: number;
  name: string;
  igdbId: number | null;
}
export interface ITheme {
  id: number;
  name: string;
  igdbId: number | null;
}
export interface IGameMode {
  id: number;
  name: string;
  igdbId: number | null;
}
export interface IPerspective {
  id: number;
  name: string;
  igdbId: number | null;
}
export interface IEngine {
  id: number;
  name: string;
  igdbId: number | null;
}
export interface IFranchise {
  id: number;
  name: string;
  igdbId: number | null;
}
export interface ICollection {
  id: number;
  name: string;
  igdbId: number | null;
}

export interface IGameAssociationSummary {
  gotmWins: {
    round: number;
    threadId: string | null;
    redditUrl: string | null;
    monthYear: string;
  }[];
  nrGotmWins: {
    round: number;
    threadId: string | null;
    redditUrl: string | null;
    monthYear: string;
  }[];
  gotmNominations: { round: number; userId: string; username: string }[];
  nrGotmNominations: { round: number; userId: string; username: string }[];
}

type IGDBReleaseDate = NonNullable<IGDBGameDetails["release_dates"]>[number];

export interface INowPlayingMember {
  userId: string;
  username: string | null;
  globalName: string | null;
  threadId: string | null;
  addedAt: Date | null;
}

export interface ICompletedMember {
  userId: string;
  username: string | null;
  globalName: string | null;
  completionType: string;
  completedAt: Date | null;
  finalPlaytimeHours: number | null;
}

export interface ICollectionOwnerMember {
  userId: string;
  username: string | null;
  globalName: string | null;
}

const IGDB_REGION_MAP: Record<number, { code: string; name: string }> = {
  1: { code: "EU", name: "Europe" },
  2: { code: "NA", name: "North America" },
  3: { code: "AUS", name: "Australia" },
  4: { code: "NZ", name: "New Zealand" },
  5: { code: "JP", name: "Japan" },
  6: { code: "CN", name: "China" },
  7: { code: "AS", name: "Asia" },
  8: { code: "WW", name: "Worldwide" },
};

const buildPlatformCode = (name: string | null, igdbId: number): string => {
  const platformName = name ?? `IGDB Platform ${igdbId}`;
  const sanitized = platformName.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const base = sanitized.slice(0, 12) || "PLATFORM";
  const codeWithId = `${base}${igdbId}`;
  return codeWithId.length > 20 ? codeWithId.slice(0, 20) : codeWithId;
};

const AUTOCOMPLETE_CACHE_TTL_MS = 60_000;
const AUTOCOMPLETE_CACHE_MAX_ENTRIES = 300;
const autocompleteSearchCache = new Map<
  string,
  { expiresAt: number; results: IGameAutocompleteResult[] }
>();
const pendingAutocompleteSearches = new Map<
  string,
  Promise<IGameAutocompleteResult[]>
>();

function clearAutocompleteSearchCaches(): void {
  autocompleteSearchCache.clear();
  pendingAutocompleteSearches.clear();
}

export type GameSource = "oracleSQL" | "API";

// Helper functions for mapping rows

/**
 * Maps a Rails API JSON response (snake_case) to IGame.
 * imageData is always null from the API (blobs are not serialized).
 *
 * The Rails API uses its own auto-increment PK in `data.id` (which differs from
 * the Oracle GameDB GAME_ID). The Oracle ID is serialized as `data.game_id`, so
 * we prefer that field and fall back to `data.id` only if absent.
 */
function mapGameFromApi(data: any): IGame {
  return {
    id: Number(data.game_id ?? data.id),
    title: String(data.title),
    description: data.description ? String(data.description) : null,
    imageData: null,
    thumbnailBad: Boolean(data.thumbnail_bad ?? false),
    thumbnailApproved: Boolean(data.thumbnail_approved ?? false),
    igdbId: data.igdb_id != null ? Number(data.igdb_id) : null,
    slug: data.slug ? String(data.slug) : null,
    totalRating: data.total_rating != null ? Number(data.total_rating) : null,
    igdbUrl: data.igdb_url ? String(data.igdb_url) : null,
    featuredVideoUrl: data.featured_video_url
      ? String(data.featured_video_url)
      : null,
    initialReleaseDate: data.initial_release_date
      ? new Date(data.initial_release_date)
      : null,
    createdAt: new Date(data.created_at),
    updatedAt: new Date(data.updated_at),
    coverUrl: data.cover_url ? String(data.cover_url) : null,
  };
}

function mapGameRow(row: any): IGame {
  return {
    id: Number(row.GAME_ID),
    title: String(row.TITLE),
    description: row.DESCRIPTION ? String(row.DESCRIPTION) : null,
    imageData: row.IMAGE_DATA instanceof Buffer ? row.IMAGE_DATA : null,
    thumbnailBad: Number(row.THUMBNAIL_BAD ?? 0) === 1,
    thumbnailApproved: Number(row.THUMBNAIL_APPROVED ?? 0) === 1,
    igdbId: row.IGDB_ID ? Number(row.IGDB_ID) : null,
    slug: row.SLUG ? String(row.SLUG) : null,
    totalRating: row.TOTAL_RATING ? Number(row.TOTAL_RATING) : null,
    igdbUrl: row.IGDB_URL ? String(row.IGDB_URL) : null,
    featuredVideoUrl: row.FEATURED_VIDEO_URL
      ? String(row.FEATURED_VIDEO_URL)
      : null,
    initialReleaseDate:
      row.INITIAL_RELEASE_DATE instanceof Date
        ? row.INITIAL_RELEASE_DATE
        : row.INITIAL_RELEASE_DATE
          ? new Date(row.INITIAL_RELEASE_DATE)
          : null,
    createdAt:
      row.CREATED_AT instanceof Date
        ? row.CREATED_AT
        : new Date(row.CREATED_AT),
    updatedAt:
      row.UPDATED_AT instanceof Date
        ? row.UPDATED_AT
        : new Date(row.UPDATED_AT),
    coverUrl: null,
  };
}

function normalizeAutocompleteQuery(query: string): string {
  return query.trim().toLowerCase();
}

function foldAccentE(query: string): string {
  return query.replace(/[éèêë]/g, "e").replace(/[ÉÈÊË]/g, "E");
}

function buildAutocompleteCacheKey(query: string, limit: number): string {
  return `${limit}:${normalizeAutocompleteQuery(query)}`;
}

function pruneAutocompleteCache(now: number): void {
  for (const [key, entry] of autocompleteSearchCache.entries()) {
    if (entry.expiresAt <= now) {
      autocompleteSearchCache.delete(key);
    }
  }
  while (autocompleteSearchCache.size > AUTOCOMPLETE_CACHE_MAX_ENTRIES) {
    const oldestKey = autocompleteSearchCache.keys().next().value as
      | string
      | undefined;
    if (!oldestKey) break;
    autocompleteSearchCache.delete(oldestKey);
  }
}

function mapReleaseRow(row: any): IRelease {
  return {
    id: Number(row.RELEASE_ID),
    gameId: Number(row.GAME_ID),
    platformId: Number(row.PLATFORM_ID),
    regionId: Number(row.REGION_ID),
    format: row.FORMAT ? (String(row.FORMAT) as "Physical" | "Digital") : null,
    releaseDate:
      row.RELEASE_DATE instanceof Date
        ? row.RELEASE_DATE
        : row.RELEASE_DATE
          ? new Date(row.RELEASE_DATE)
          : null,
    notes: row.NOTES ? String(row.NOTES) : null,
  };
}

function mapPlatformDefRow(row: any): IPlatformDef {
  return {
    id: Number(row.PLATFORM_ID),
    code: String(row.PLATFORM_CODE),
    name: String(row.PLATFORM_NAME),
    abbreviation: row.PLATFORM_ABBREVIATION
      ? String(row.PLATFORM_ABBREVIATION)
      : null,
    igdbPlatformId: row.IGDB_PLATFORM_ID ? Number(row.IGDB_PLATFORM_ID) : null,
  };
}

function mapRegionDefRow(row: any): IRegionDef {
  return {
    id: Number(row.REGION_ID),
    code: String(row.REGION_CODE),
    name: String(row.REGION_NAME),
    igdbRegionId: row.IGDB_REGION_ID ? Number(row.IGDB_REGION_ID) : null,
  };
}

export default class Game {
  static async createGame(
    title: string,
    description: string | null,
    imageData: Buffer | null,
    igdbId: number | null = null,
    slug: string | null = null,
    totalRating: number | null = null,
    igdbUrl: string | null = null,
    featuredVideoUrl: string | null = null,
  ): Promise<IGame> {
    const gameId = await oraWithConnection(async (conn) => {
      const result = await oraMutate(
        getSql(GameSql.createGame, dialect),
        {
          title,
          description,
          imageData: imageData || null,
          igdbId: igdbId || null,
          slug: slug || null,
          totalRating: totalRating || null,
          igdbUrl: igdbUrl || null,
          featuredVideoUrl: featuredVideoUrl || null,
          id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT },
        },
        conn,
      );
      await conn.commit();
      return (result.outBinds as { id: number[] }).id[0];
    });

    if (!gameId) throw new Error("Failed to retrieve GAME_ID after insert.");

    const newGame = await Game.getGameById(gameId);
    if (!newGame) throw new Error("Failed to fetch newly created game.");
    clearAutocompleteSearchCaches();
    return newGame;
  }

  /**
   * Returns the raw `data` payload from the Rails API for a game, without any
   * field mapping. Useful for debugging what the API actually returns.
   */
  static async getGameRawFromApi(id: number): Promise<unknown> {
    const result = await apiGet<{ data: unknown }>(`/api/v1/games/${id}`);
    return result?.data ?? null;
  }

  /**
   * Like `getGameRawFromApi` but also returns HTTP status, request/response
   * headers, and the full raw response body so callers can log diagnostics.
   * HTTP errors (4xx/5xx) are returned as values; check `errorMessage`.
   */
  static async getGameRawFromApiWithMeta(
    id: number,
  ): Promise<ApiGetRawMeta & { gameData: unknown }> {
    const meta = await apiGetRaw<{ data: unknown }>(`/api/v1/games/${id}`);
    const body = meta.rawData as { data?: unknown } | null;
    return { ...meta, gameData: body?.data ?? null };
  }

  static async getGameById(
    id: number,
    source: GameSource = "oracleSQL",
  ): Promise<IGame | null> {
    if (source === "API") {
      const result = await apiGet<{ data: unknown }>(`/api/v1/games/${id}`);
      const data = result?.data;
      return data ? mapGameFromApi(data) : null;
    }

    return oraWithConnection(async (conn) => {
      const result = await conn.execute<{
        GAME_ID: number;
        TITLE: string;
        DESCRIPTION: string | null;
        IMAGE_DATA: Buffer | null;
        THUMBNAIL_BAD: number | null;
        THUMBNAIL_APPROVED: number | null;
        IGDB_ID: number | null;
        SLUG: string | null;
        TOTAL_RATING: number | null;
        IGDB_URL: string | null;
        FEATURED_VIDEO_URL: string | null;
        INITIAL_RELEASE_DATE: Date | null;
        CREATED_AT: Date;
        UPDATED_AT: Date;
      }>(
        getSql(GameSql.getGameById, dialect),
        { id },
        {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
          fetchInfo: {
            IMAGE_DATA: { type: oracledb.BUFFER },
            DESCRIPTION: { type: oracledb.STRING },
          },
        },
      );

      const row = (result.rows ?? [])[0] as any;
      return row ? mapGameRow(row) : null;
    });
  }

  static async getGamesByIds(ids: number[]): Promise<IGame[]> {
    const uniqueIds = Array.from(
      new Set(ids.filter((id) => Number.isInteger(id) && id > 0)),
    );
    if (!uniqueIds.length) return [];

    const binds: Record<string, number> = {};
    const placeholders: string[] = [];
    uniqueIds.forEach((id, idx) => {
      const key = `id${idx}`;
      binds[key] = id;
      placeholders.push(`:${key}`);
    });

    return oraWithConnection(async (conn) => {
      const result = await conn.execute<{
        GAME_ID: number;
        TITLE: string;
        DESCRIPTION: string | null;
        IMAGE_DATA: Buffer | null;
        THUMBNAIL_BAD: number | null;
        THUMBNAIL_APPROVED: number | null;
        IGDB_ID: number | null;
        SLUG: string | null;
        TOTAL_RATING: number | null;
        IGDB_URL: string | null;
        FEATURED_VIDEO_URL: string | null;
        INITIAL_RELEASE_DATE: Date | null;
        CREATED_AT: Date;
        UPDATED_AT: Date;
      }>(
        GameSql.getGamesByIds(placeholders.join(", "))[dialect],
        binds,
        {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
          fetchInfo: {
            IMAGE_DATA: { type: oracledb.BUFFER },
            DESCRIPTION: { type: oracledb.STRING },
          },
        },
      );
      return (result.rows ?? []).map((row) => mapGameRow(row));
    });
  }

  static async getAlternateVersions(gameId: number): Promise<IGame[]> {
    if (!Number.isInteger(gameId) || gameId <= 0) return [];
    return oraWithConnection(async (conn) => {
      const result = await conn.execute<{
        GAME_ID: number;
        TITLE: string;
        DESCRIPTION: string | null;
        IMAGE_DATA: Buffer | null;
        THUMBNAIL_BAD: number | null;
        THUMBNAIL_APPROVED: number | null;
        IGDB_ID: number | null;
        SLUG: string | null;
        TOTAL_RATING: number | null;
        IGDB_URL: string | null;
        FEATURED_VIDEO_URL: string | null;
        INITIAL_RELEASE_DATE: Date | null;
        CREATED_AT: Date;
        UPDATED_AT: Date;
      }>(
        getSql(GameSql.getAlternateVersions, dialect),
        { id: gameId },
        {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
          fetchInfo: {
            IMAGE_DATA: { type: oracledb.BUFFER },
            DESCRIPTION: { type: oracledb.STRING },
          },
        },
      );
      return (result.rows ?? []).map((row) => mapGameRow(row));
    });
  }

  static async linkAlternateVersions(
    gameIds: number[],
    createdBy: string | null,
  ): Promise<number> {
    const uniqueIds = Array.from(
      new Set(gameIds.filter((id) => Number.isInteger(id) && id > 0)),
    ).sort((a, b) => a - b);
    if (uniqueIds.length < 2) {
      throw new Error("At least two GameDB ids are required to link versions.");
    }

    const pairs: Array<{
      gameId: number;
      altGameId: number;
      createdBy: string | null;
    }> = [];
    for (let i = 0; i < uniqueIds.length; i += 1) {
      for (let j = i + 1; j < uniqueIds.length; j += 1) {
        pairs.push({
          gameId: uniqueIds[i],
          altGameId: uniqueIds[j],
          createdBy,
        });
      }
    }

    return oraWithConnection(async (conn) => {
      await conn.executeMany(
        getSql(GameSql.linkAlternateVersions, dialect),
        pairs,
        { autoCommit: true },
      );
      return pairs.length;
    });
  }

  static async getGameByIgdbId(igdbId: number): Promise<IGame | null> {
    return oraWithConnection(async (conn) => {
      const result = await conn.execute<{
        GAME_ID: number;
        TITLE: string;
        DESCRIPTION: string | null;
        IMAGE_DATA: Buffer | null;
        THUMBNAIL_BAD: number | null;
        THUMBNAIL_APPROVED: number | null;
        IGDB_ID: number | null;
        SLUG: string | null;
        TOTAL_RATING: number | null;
        IGDB_URL: string | null;
        FEATURED_VIDEO_URL: string | null;
        INITIAL_RELEASE_DATE: Date | null;
        CREATED_AT: Date;
        UPDATED_AT: Date;
      }>(
        getSql(GameSql.getGameByIgdbId, dialect),
        { igdbId },
        {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
          fetchInfo: {
            IMAGE_DATA: { type: oracledb.BUFFER },
            DESCRIPTION: { type: oracledb.STRING },
          },
        },
      );

      const row = (result.rows ?? [])[0] as any;
      return row ? mapGameRow(row) : null;
    });
  }

  static getFeaturedVideoUrl(details: IGDBGameDetails): string | null {
    const videoId = details.videos?.[0]?.video_id;
    if (!videoId) {
      return null;
    }
    return `https://www.youtube.com/watch?v=${videoId}`;
  }

  static async importGameFromIgdb(
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
        const imageUrl = `https://images.igdb.com/igdb/image/upload/t_cover_big/${details.cover.image_id}.jpg`;
        const imageResponse = await axios.get(imageUrl, {
          responseType: "arraybuffer",
        });
        imageData = Buffer.from(imageResponse.data);
      } catch (err) {
        console.error("Failed to download cover image:", err);
      }
    }

    let newGame: IGame | null = null;
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
        const existing = await Game.getGameByIgdbId(details.id);
        if (existing) {
          return { gameId: existing.id, title: existing.title };
        }
        throw new Error(
          "Game already exists with this IGDB ID, but could not be loaded.",
        );
      }
      throw err;
    }
    await Game.saveFullGameMetadata(newGame.id, details);
    clearAutocompleteSearchCaches();
    return { gameId: newGame.id, title: details.name };
  }

  static async importReleaseDatesFromIgdb(
    gameId: number,
    igdbId: number,
  ): Promise<void> {
    const details = await igdbService.getGameDetails(igdbId);
    if (!details) {
      throw new Error("Failed to load game details from IGDB.");
    }
    await Game.saveReleaseDates(gameId, details.release_dates ?? []);
  }

  // --- Metadata Handlers ---

  private static async getOrInsertMetadata(
    conn: oracledb.Connection,
    table: string,
    idCol: string,
    nameCol: string,
    igdbIdCol: string,
    name: string,
    igdbId: number,
  ): Promise<number> {
    const rows = await oraQuery(
      GameSql.getOrInsertMetadataSelect(idCol, table, igdbIdCol)[dialect],
      { igdbId },
      (row: Record<string, number>) => Number(row[idCol]),
      conn,
    );
    if (rows.length > 0) return rows[0];

    const insertRes = await oraMutate(
      GameSql.getOrInsertMetadataInsert(table, nameCol, idCol, igdbIdCol)[dialect],
      { name, igdbId, id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT } },
      conn,
    );
    await conn.commit();
    return (insertRes.outBinds as { id: number[] }).id[0];
  }

  static async saveFullGameMetadata(
    gameId: number,
    details: IGDBGameDetails,
  ): Promise<void> {
    await oraWithConnection(async (conn) => {
      if (details.involved_companies) {
        for (const ic of details.involved_companies) {
          const companyId = await Game.getOrInsertMetadata(
            conn,
            "GAMEDB_COMPANIES",
            "COMPANY_ID",
            "NAME",
            "IGDB_COMPANY_ID",
            ic.company.name,
            ic.company.id,
          );
          await oraMutate(
            getSql(GameSql.insertGameCompany, dialect),
            {
              gameId,
              companyId,
              role: ic.developer
                ? "Developer"
                : ic.publisher
                  ? "Publisher"
                  : null,
            },
            conn,
          )
            .then(() => conn.commit())
            .catch(() => {});
        }
      }

      if (details.genres) {
        for (const g of details.genres) {
          const genreId = await Game.getOrInsertMetadata(
            conn,
            "GAMEDB_GENRES",
            "GENRE_ID",
            "NAME",
            "IGDB_GENRE_ID",
            g.name,
            g.id,
          );
          await oraMutate(
            getSql(GameSql.insertGameGenre, dialect),
            { gameId, genreId },
            conn,
          )
            .then(() => conn.commit())
            .catch(() => {});
        }
      }

      if (details.themes) {
        for (const t of details.themes) {
          const themeId = await Game.getOrInsertMetadata(
            conn,
            "GAMEDB_THEMES",
            "THEME_ID",
            "NAME",
            "IGDB_THEME_ID",
            t.name,
            t.id,
          );
          await oraMutate(
            getSql(GameSql.insertGameTheme, dialect),
            { gameId, themeId },
            conn,
          )
            .then(() => conn.commit())
            .catch(() => {});
        }
      }

      if (details.game_modes) {
        for (const gm of details.game_modes) {
          const modeId = await Game.getOrInsertMetadata(
            conn,
            "GAMEDB_GAME_MODES_DEF",
            "MODE_ID",
            "NAME",
            "IGDB_GAME_MODE_ID",
            gm.name,
            gm.id,
          );
          await oraMutate(
            getSql(GameSql.insertGameMode, dialect),
            { gameId, modeId },
            conn,
          )
            .then(() => conn.commit())
            .catch(() => {});
        }
      }

      if (details.player_perspectives) {
        for (const pp of details.player_perspectives) {
          const persId = await Game.getOrInsertMetadata(
            conn,
            "GAMEDB_PERSPECTIVES",
            "PERSPECTIVE_ID",
            "NAME",
            "IGDB_PERSPECTIVE_ID",
            pp.name,
            pp.id,
          );
          await oraMutate(
            getSql(GameSql.insertGamePerspective, dialect),
            { gameId, persId },
            conn,
          )
            .then(() => conn.commit())
            .catch(() => {});
        }
      }

      if (details.game_engines) {
        for (const e of details.game_engines) {
          const engineId = await Game.getOrInsertMetadata(
            conn,
            "GAMEDB_ENGINES",
            "ENGINE_ID",
            "NAME",
            "IGDB_ENGINE_ID",
            e.name,
            e.id,
          );
          await oraMutate(
            getSql(GameSql.insertGameEngine, dialect),
            { gameId, engineId },
            conn,
          )
            .then(() => conn.commit())
            .catch(() => {});
        }
      }

      if (details.franchises) {
        for (const f of details.franchises) {
          const franchiseId = await Game.getOrInsertMetadata(
            conn,
            "GAMEDB_FRANCHISES",
            "FRANCHISE_ID",
            "NAME",
            "IGDB_FRANCHISE_ID",
            f.name,
            f.id,
          );
          await oraMutate(
            getSql(GameSql.insertGameFranchise, dialect),
            { gameId, franchiseId },
            conn,
          )
            .then(() => conn.commit())
            .catch(() => {});
        }
      }

      if (details.collection) {
        const collectionId = await Game.getOrInsertMetadata(
          conn,
          "GAMEDB_COLLECTIONS",
          "COLLECTION_ID",
          "NAME",
          "IGDB_COLLECTION_ID",
          details.collection.name,
          details.collection.id,
        );
        await oraMutate(
          getSql(GameSql.updateCollectionId, dialect),
          { collectionId, gameId },
          conn,
        );
        await conn.commit();
      }

      if (details.parent_game) {
        await oraMutate(
          getSql(GameSql.updateParentIgdbId, dialect),
          {
            parentId: details.parent_game.id,
            parentName: details.parent_game.name,
            gameId,
          },
          conn,
        );
        await conn.commit();
      }
    });

    await Game.saveReleaseDates(gameId, details.release_dates ?? []);
  }

  private static buildReleaseSignature(
    platformId: number,
    regionId: number,
    releaseDate: Date | null,
    format: "Physical" | "Digital" | null,
  ): string {
    const dateKey = releaseDate
      ? releaseDate.toISOString().slice(0, 10)
      : "none";
    return [platformId, regionId, dateKey, format ?? "none"].join("|");
  }

  private static resolveReleaseDate(release: IGDBReleaseDate): Date | null {
    if (release.date) {
      return new Date(release.date * 1000);
    }
    if (!release.y) {
      return null;
    }
    const month = release.m ? release.m - 1 : 0;
    return new Date(Date.UTC(release.y, month, 1));
  }

  private static async saveReleaseDates(
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
      // Ignore Japanese release dates (region 5)
      if (release.region === 5) continue;

      const platformId = release.platform?.id;
      if (!platformId) continue;
      const releaseDate = Game.resolveReleaseDate(release);
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

      await Game.addReleaseInfo(
        gameId,
        platform.id,
        region.id,
        format,
        date,
        null,
      );
    }

    await Game.updateInitialReleaseDate(gameId);
  }

  static async updateInitialReleaseDate(gameId: number): Promise<void> {
    const rows = await oraQuery(
      getSql(GameSql.updateInitialReleaseDateSelect, dialect),
      { gameId },
      (row: { MIN_DATE: Date | null }) => row.MIN_DATE,
    );
    const minDate = rows[0] ?? null;
    if (!minDate) return;
    await oraMutate(
      getSql(GameSql.updateInitialReleaseDateUpdate, dialect),
      { releaseDate: minDate, gameId },
    );
  }

  static async ensurePlatform(igdbPlatform: {
    id: number;
    name: string | null;
  }): Promise<IPlatformDef | null> {
    const existing = await Game.getPlatformByIgdbId(igdbPlatform.id);
    if (existing) {
      return existing;
    }

    try {
      await oraMutate(
        getSql(GameSql.insertPlatform, dialect),
        {
          code: buildPlatformCode(igdbPlatform.name, igdbPlatform.id),
          name: igdbPlatform.name ?? `IGDB Platform ${igdbPlatform.id}`,
          igdbId: igdbPlatform.id,
        },
      );
      return Game.getPlatformByIgdbId(igdbPlatform.id);
    } catch (err) {
      console.error(
        `Failed to insert platform ${igdbPlatform.name} (${igdbPlatform.id})`,
        err,
      );
      return null;
    }
  }

  static async ensureRegion(igdbRegionId: number): Promise<IRegionDef | null> {
    const existing = await Game.getRegionByIgdbId(igdbRegionId);
    if (existing) {
      return existing;
    }

    const regionConfig = IGDB_REGION_MAP[igdbRegionId];
    if (!regionConfig) {
      return null;
    }

    try {
      const insertRes = await oraMutate(
        getSql(GameSql.insertRegion, dialect),
        {
          code: regionConfig.code,
          name: regionConfig.name,
          igdbId: igdbRegionId,
          id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT },
        },
      );
      const regionId = (insertRes.outBinds as { id: number[] }).id[0];
      return Game.getRegionById(regionId);
    } catch (err) {
      console.error(
        `Failed to insert region for IGDB region ${igdbRegionId}`,
        err,
      );
      return null;
    }
  }

  // --- Getters for View ---

  static async getGameDevelopers(gameId: number): Promise<string[]> {
    return Game.getGameCompanies(gameId, "Developer");
  }

  static async getGamePublishers(gameId: number): Promise<string[]> {
    return Game.getGameCompanies(gameId, "Publisher");
  }

  private static async getGameCompanies(
    gameId: number,
    role: string,
  ): Promise<string[]> {
    return oraQuery(
      getSql(GameSql.getGameCompanies, dialect),
      { gameId, role },
      (row: { NAME: string }) => row.NAME,
    );
  }

  static async getGameGenres(gameId: number): Promise<string[]> {
    return Game.getSimpleList(
      gameId,
      "GAMEDB_GENRES",
      "GAMEDB_GAME_GENRES",
      "GENRE_ID",
    );
  }

  static async getGameThemes(gameId: number): Promise<string[]> {
    return Game.getSimpleList(
      gameId,
      "GAMEDB_THEMES",
      "GAMEDB_GAME_THEMES",
      "THEME_ID",
    );
  }

  static async getGameModes(gameId: number): Promise<string[]> {
    return Game.getSimpleList(
      gameId,
      "GAMEDB_GAME_MODES_DEF",
      "GAMEDB_GAME_MODES",
      "MODE_ID",
    );
  }

  static async getGamePerspectives(gameId: number): Promise<string[]> {
    return Game.getSimpleList(
      gameId,
      "GAMEDB_PERSPECTIVES",
      "GAMEDB_GAME_PERSPECTIVES",
      "PERSPECTIVE_ID",
    );
  }

  static async getGameEngines(gameId: number): Promise<string[]> {
    return Game.getSimpleList(
      gameId,
      "GAMEDB_ENGINES",
      "GAMEDB_GAME_ENGINES",
      "ENGINE_ID",
    );
  }

  static async getGameFranchises(gameId: number): Promise<string[]> {
    return Game.getSimpleList(
      gameId,
      "GAMEDB_FRANCHISES",
      "GAMEDB_GAME_FRANCHISES",
      "FRANCHISE_ID",
    );
  }

  static async getGameSeries(gameId: number): Promise<string | null> {
    const rows = await oraQuery(
      getSql(GameSql.getGameSeries, dialect),
      { gameId },
      (row: { NAME: string }) => row.NAME,
    );
    return rows[0] ?? null;
  }

  private static async getSimpleList(
    gameId: number,
    defTable: string,
    mapTable: string,
    idCol: string,
  ): Promise<string[]> {
    return oraQuery(
      GameSql.getSimpleList(defTable, mapTable, idCol)[dialect],
      { gameId },
      (row: { NAME: string }) => row.NAME,
    );
  }

  static async addReleaseInfo(
    gameId: number,
    platformId: number,
    regionId: number,
    format: "Physical" | "Digital" | null,
    releaseDate: Date | null,
    notes: string | null,
  ): Promise<IRelease> {
    const result = await oraMutate(
      getSql(GameSql.insertRelease, dialect),
      {
        gameId,
        platformId,
        regionId,
        format,
        releaseDate: releaseDate || null,
        notes: notes || null,
        id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT },
      },
    );
    const releaseId = (result.outBinds as { id: number[] }).id[0];
    if (!releaseId)
      throw new Error("Failed to retrieve RELEASE_ID after insert.");
    const newRelease = await Game.getReleaseById(releaseId);
    if (!newRelease) throw new Error("Failed to fetch newly created release.");
    return newRelease;
  }

  static async getReleaseById(id: number): Promise<IRelease | null> {
    const rows = await oraQuery(
      getSql(GameSql.getReleaseById, dialect),
      { id },
      mapReleaseRow,
    );
    return rows[0] ?? null;
  }

  static async getGameReleases(gameId: number): Promise<IRelease[]> {
    return oraQuery(
      getSql(GameSql.getGameReleases, dialect),
      { gameId },
      mapReleaseRow,
    );
  }

  static async getPlatformsForGame(gameId: number): Promise<IPlatformDef[]> {
    return oraQuery(
      getSql(GameSql.getPlatformsForGame, dialect),
      { gameId },
      mapPlatformDefRow,
    );
  }

  static async getAllPlatforms(): Promise<IPlatformDef[]> {
    return oraQuery(
      getSql(GameSql.getAllPlatforms, dialect),
      {},
      mapPlatformDefRow,
    );
  }

  static async getPlatformsByIgdbIds(
    igdbIds: number[],
  ): Promise<Map<number, IPlatformDef>> {
    const uniqueIds = Array.from(
      new Set(igdbIds.filter((id) => Number.isInteger(id) && id > 0)),
    );
    if (!uniqueIds.length) {
      return new Map();
    }

    const binds: Record<string, number> = {};
    const placeholders: string[] = [];
    uniqueIds.forEach((id, idx) => {
      const key = `id${idx}`;
      binds[key] = id;
      placeholders.push(`:${key}`);
    });

    const platforms = await oraQuery(
      GameSql.getPlatformsByIgdbIds(placeholders.join(", "))[dialect],
      binds,
      mapPlatformDefRow,
    );
    const map = new Map<number, IPlatformDef>();
    platforms.forEach((platform) => {
      if (platform.igdbPlatformId) map.set(platform.igdbPlatformId, platform);
    });
    return map;
  }

  static async getPlatformsForGameWithStandard(
    gameId: number,
    standardPlatformIds: number[],
  ): Promise<IPlatformDef[]> {
    const gamePlatforms = await Game.getPlatformsForGame(gameId);
    const allPlatforms = await Game.getAllPlatforms();
    const byId = new Map(
      allPlatforms.map((platform) => [platform.id, platform]),
    );
    const seen = new Set<number>();
    const merged: IPlatformDef[] = [];

    for (const platform of gamePlatforms) {
      const full = byId.get(platform.id) ?? platform;
      if (!seen.has(platform.id)) {
        merged.push(full);
        seen.add(platform.id);
      }
    }

    const extra = standardPlatformIds
      .filter((id) => !seen.has(id))
      .map((id) => byId.get(id))
      .filter((platform): platform is IPlatformDef => Boolean(platform));

    extra.sort((a, b) => a.name.localeCompare(b.name));
    merged.push(...extra);

    return merged;
  }

  static async getPlatformByCode(code: string): Promise<IPlatformDef | null> {
    const rows = await oraQuery(
      getSql(GameSql.getPlatformByCode, dialect),
      { code },
      mapPlatformDefRow,
    );
    return rows[0] ?? null;
  }

  static async getPlatformById(id: number): Promise<IPlatformDef | null> {
    const rows = await oraQuery(
      getSql(GameSql.getPlatformById, dialect),
      { id },
      mapPlatformDefRow,
    );
    return rows[0] ?? null;
  }

  static async attachPlatformsToGames(
    games: IGame[],
  ): Promise<IGameWithPlatforms[]> {
    const gameIds = Array.from(
      new Set(
        games
          .map((game) => game.id)
          .filter((id) => Number.isInteger(id) && id > 0),
      ),
    );
    if (!gameIds.length) {
      return games.map((game) => ({ ...game, platforms: [] }));
    }

    const binds: Record<string, number> = {};
    const placeholders: string[] = [];
    gameIds.forEach((id, idx) => {
      const key = `id${idx}`;
      binds[key] = id;
      placeholders.push(`:${key}`);
    });

    const gameToPlatforms = new Map<number, IPlatformDef[]>();
    const missingPlatformIds = new Set<number>();

    const rows = await oraQuery(
      GameSql.attachPlatformsToGames(placeholders.join(", "))[dialect],
      binds,
      (row: {
        GAME_ID: number;
        PLATFORM_ID: number;
        PLATFORM_CODE: string | null;
        PLATFORM_NAME: string | null;
        PLATFORM_ABBREVIATION: string | null;
        IGDB_PLATFORM_ID: number | null;
      }) => row,
    );

    rows.forEach((row) => {
      const gameId = Number(row.GAME_ID);
      const platformId = Number(row.PLATFORM_ID);
      if (!Number.isInteger(gameId) || !Number.isInteger(platformId)) return;
      if (!row.PLATFORM_NAME || !row.PLATFORM_CODE) {
        missingPlatformIds.add(platformId);
        return;
      }
      const platform: IPlatformDef = {
        id: platformId,
        code: String(row.PLATFORM_CODE),
        name: String(row.PLATFORM_NAME),
        abbreviation: row.PLATFORM_ABBREVIATION
          ? String(row.PLATFORM_ABBREVIATION)
          : null,
        igdbPlatformId: row.IGDB_PLATFORM_ID
          ? Number(row.IGDB_PLATFORM_ID)
          : null,
      };
      if (!gameToPlatforms.has(gameId)) gameToPlatforms.set(gameId, []);
      gameToPlatforms.get(gameId)!.push(platform);
    });

    if (missingPlatformIds.size) {
      console.warn(
        `Missing platform IDs in GAMEDB_PLATFORMS: ${Array.from(missingPlatformIds).join(", ")}`,
      );
    }

    return games.map((game) => ({
      ...game,
      platforms: gameToPlatforms.get(game.id) ?? [],
    }));
  }

  static async getPlatformByIgdbId(
    igdbId: number,
  ): Promise<IPlatformDef | null> {
    const rows = await oraQuery(
      getSql(GameSql.getPlatformByIgdbId, dialect),
      { igdbId },
      mapPlatformDefRow,
    );
    return rows[0] ?? null;
  }

  static async getAllRegions(): Promise<IRegionDef[]> {
    return oraQuery(
      getSql(GameSql.getAllRegions, dialect),
      {},
      mapRegionDefRow,
    );
  }

  static async getRegionByCode(code: string): Promise<IRegionDef | null> {
    const rows = await oraQuery(
      getSql(GameSql.getRegionByCode, dialect),
      { code },
      mapRegionDefRow,
    );
    return rows[0] ?? null;
  }

  static async getRegionById(id: number): Promise<IRegionDef | null> {
    const rows = await oraQuery(
      getSql(GameSql.getRegionById, dialect),
      { id },
      mapRegionDefRow,
    );
    return rows[0] ?? null;
  }

  static async getRegionByIgdbId(igdbId: number): Promise<IRegionDef | null> {
    const rows = await oraQuery(
      getSql(GameSql.getRegionByIgdbId, dialect),
      { igdbId },
      mapRegionDefRow,
    );
    return rows[0] ?? null;
  }

  static async searchGamesAutocomplete(
    query: string,
    limit: number = 24,
  ): Promise<IGameAutocompleteResult[]> {
    const baseQuery = query.trim();
    if (!baseQuery) {
      return [];
    }

    const safeLimit = Math.min(24, Math.max(1, Math.trunc(limit) || 24));
    const now = Date.now();
    pruneAutocompleteCache(now);

    const cacheKey = buildAutocompleteCacheKey(baseQuery, safeLimit);
    const cached = autocompleteSearchCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.results;
    }
    const pending = pendingAutocompleteSearches.get(cacheKey);
    if (pending) {
      return pending;
    }

    const lowerQuery = baseQuery.toLowerCase();
    const foldedLowerQuery = foldAccentE(lowerQuery).toLowerCase();
    const normalizedQuery = foldedLowerQuery.replace(/[^a-z0-9]/g, "");
    if (!normalizedQuery && !/[a-z0-9]/.test(foldedLowerQuery)) {
      return [];
    }

    const queryPromise = oraWithConnection(async (conn) => {
      const binds = {
        exactRaw: foldedLowerQuery,
        rawPrefix: `${foldedLowerQuery}%`,
        rawContains: `%${foldedLowerQuery}%`,
        exactNorm: normalizedQuery || null,
        normPrefix: normalizedQuery ? `${normalizedQuery}%` : null,
        normContains: normalizedQuery ? `%${normalizedQuery}%` : null,
        limit: safeLimit,
      };
      const titleFoldExpr =
        "REPLACE(REPLACE(REPLACE(REPLACE(LOWER(TITLE), 'é', 'e'), 'è', 'e'), 'ê', 'e'), 'ë', 'e')";
      const titleNormExpr = `REGEXP_REPLACE(${titleFoldExpr}, '[^a-z0-9]', '')`;

      const result = await conn.execute<{
        GAME_ID: number;
        TITLE: string;
        INITIAL_RELEASE_DATE: Date | null;
      }>(
        GameSql.searchGamesAutocomplete(titleFoldExpr, titleNormExpr)[dialect],
        binds,
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      const resultRows = result.rows ?? [];
      const games: IGameAutocompleteResult[] = resultRows.map((row: any) => ({
        id: Number(row.GAME_ID),
        title: String(row.TITLE),
        initialReleaseDate:
          row.INITIAL_RELEASE_DATE instanceof Date
            ? row.INITIAL_RELEASE_DATE
            : row.INITIAL_RELEASE_DATE
              ? new Date(row.INITIAL_RELEASE_DATE)
              : null,
      }));

      autocompleteSearchCache.set(cacheKey, {
        expiresAt: Date.now() + AUTOCOMPLETE_CACHE_TTL_MS,
        results: games,
      });
      pruneAutocompleteCache(Date.now());

      return games;
    });

    pendingAutocompleteSearches.set(cacheKey, queryPromise);
    try {
      return await queryPromise;
    } finally {
      pendingAutocompleteSearches.delete(cacheKey);
    }
  }

  static async getAllCompanies(): Promise<ICompany[]> {
    return oraQuery(
      getSql(GameSql.getAllCompanies, dialect),
      {},
      (row: {
        COMPANY_ID: number;
        NAME: string;
        IGDB_COMPANY_ID: number | null;
      }) => ({
        id: Number(row.COMPANY_ID),
        name: String(row.NAME),
        igdbId: row.IGDB_COMPANY_ID ? Number(row.IGDB_COMPANY_ID) : null,
      }),
    );
  }

  static async getCompanyById(id: number): Promise<ICompany | null> {
    const rows = await oraQuery(
      getSql(GameSql.getCompanyById, dialect),
      { id },
      (row: {
        COMPANY_ID: number;
        NAME: string;
        IGDB_COMPANY_ID: number | null;
      }) => ({
        id: Number(row.COMPANY_ID),
        name: String(row.NAME),
        igdbId: row.IGDB_COMPANY_ID ? Number(row.IGDB_COMPANY_ID) : null,
      }),
    );
    return rows[0] ?? null;
  }

  static async searchGames(
    query: string,
    filters: {
      upcomingRelease?: boolean;
      platformId?: number;
      year?: number;
      developerId?: number;
      publisherId?: number;
    } = {},
  ): Promise<IGameSearchResult[]> {
    return oraWithConnection(async (connection) => {
      const baseQuery = query.trim();
      const hasFilters =
        filters.upcomingRelease ||
        filters.platformId ||
        filters.year ||
        filters.developerId ||
        filters.publisherId;
      if (!baseQuery && !hasFilters) {
        return [];
      }

      const clauses: string[] = [];
      const binds: Record<string, string | number> = {};

      if (baseQuery) {
        const queryVariants = new Set<string>();
        queryVariants.add(baseQuery);
        const spacedQuery = baseQuery
          .replace(/([a-zA-Z])(\d)/g, "$1 $2")
          .replace(/(\d)([a-zA-Z])/g, "$1 $2");
        queryVariants.add(spacedQuery);

        const tokens = spacedQuery.split(/\s+/).filter(Boolean);
        const tokenOptions: string[][] = [];
        for (const token of tokens) {
          const options = new Set<string>();
          options.add(token);
          const tokenSynonyms = await GameSearchSynonym.getTermsForQuery(token);
          tokenSynonyms.forEach((synonym) => {
            if (synonym.trim()) {
              options.add(synonym.trim());
            }
          });
          tokenOptions.push(Array.from(options));
        }

        if (tokenOptions.length) {
          let variants: string[] = [""];
          const MAX_VARIANTS = 50;
          for (const options of tokenOptions) {
            const nextVariants: string[] = [];
            for (const prefix of variants) {
              for (const option of options) {
                const next = prefix ? `${prefix} ${option}` : option;
                nextVariants.push(next);
                if (nextVariants.length >= MAX_VARIANTS) break;
              }
              if (nextVariants.length >= MAX_VARIANTS) break;
            }
            variants = nextVariants;
            if (variants.length >= MAX_VARIANTS) break;
          }
          variants.forEach((variant) => queryVariants.add(variant));
        }

        const termSet = new Map<string, string>();
        Array.from(queryVariants).forEach((term) => {
          const folded = foldAccentE(term).toLowerCase();
          const norm = folded.replace(/[^a-z0-9]/g, "");
          if (norm) {
            termSet.set(norm, folded);
          }
        });

        if (!termSet.size) {
          return [];
        }

        const titleFoldExpr =
          "REPLACE(REPLACE(REPLACE(REPLACE(LOWER(TITLE), 'é', 'e'), 'è', 'e'), 'ê', 'e'), 'ë', 'e')";
        const titleNormExpr = `REGEXP_REPLACE(${titleFoldExpr}, '[^a-z0-9]', '')`;
        Array.from(termSet.entries()).forEach(([norm, term], index) => {
          const rawKey = `searchQuery${index}`;
          const normKey = `normalizedQuery${index}`;
          binds[rawKey] = `%${term}%`;
          binds[normKey] = `%${norm}%`;
          clauses.push(
            `(${titleFoldExpr} LIKE :${rawKey} OR ${titleNormExpr} LIKE :${normKey})`,
          );
        });
      }

      const filterClauses: string[] = [];
      if (filters.upcomingRelease) {
        filterClauses.push("u.UPCOMING_DATE IS NOT NULL");
      }
      if (filters.platformId) {
        filterClauses.push(
          "g.GAME_ID IN (SELECT GAME_ID FROM GAMEDB_GAME_PLATFORMS WHERE PLATFORM_ID = :filterPlatformId)",
        );
        binds["filterPlatformId"] = filters.platformId;
      }
      if (filters.year) {
        filterClauses.push(
          "EXTRACT(YEAR FROM g.INITIAL_RELEASE_DATE) = :filterYear",
        );
        binds["filterYear"] = filters.year;
      }
      if (filters.developerId) {
        filterClauses.push(
          `g.GAME_ID IN (
            SELECT GAME_ID FROM GAMEDB_GAME_COMPANIES
             WHERE COMPANY_ID = :filterDeveloperId AND ROLE = 'Developer'
          )`,
        );
        binds["filterDeveloperId"] = filters.developerId;
      }
      if (filters.publisherId) {
        filterClauses.push(
          `g.GAME_ID IN (
            SELECT GAME_ID FROM GAMEDB_GAME_COMPANIES
             WHERE COMPANY_ID = :filterPublisherId AND ROLE = 'Publisher'
          )`,
        );
        binds["filterPublisherId"] = filters.publisherId;
      }

      const titlePart = clauses.length ? `(${clauses.join(" OR ")})` : "";
      const filterPart = filterClauses.length
        ? `(${filterClauses.join(" AND ")})`
        : "";
      const whereClause =
        titlePart && filterPart
          ? `${titlePart} AND ${filterPart}`
          : titlePart || filterPart || "1=0";

      const orderPrefix = filters.upcomingRelease
        ? "u.UPCOMING_DATE ASC NULLS LAST, "
        : "";
      const result = await connection.execute<{
        GAME_ID: number;
        TITLE: string;
        DESCRIPTION: string | null;
        IMAGE_DATA: Buffer | null;
        IGDB_ID: number | null;
        SLUG: string | null;
        TOTAL_RATING: number | null;
        IGDB_URL: string | null;
        FEATURED_VIDEO_URL: string | null;
        INITIAL_RELEASE_DATE: Date | null;
        CREATED_AT: Date;
        UPDATED_AT: Date;
        UPCOMING_RELEASE_DATE: Date | null;
        UPCOMING_PLATFORMS: string | null;
      }>(
        GameSql.searchGames(whereClause, orderPrefix)[dialect],
        binds,
        {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
          fetchInfo: { DESCRIPTION: { type: oracledb.STRING } },
        },
      );

      const upcomingDates = new Map<number, Date | null>();
      const upcomingPlatforms = new Map<number, string[]>();
      const games: IGame[] = (result.rows ?? []).map((row) => {
        const id = Number(row.GAME_ID);
        const upcomingDate =
          row.UPCOMING_RELEASE_DATE instanceof Date
            ? row.UPCOMING_RELEASE_DATE
            : row.UPCOMING_RELEASE_DATE
              ? new Date(row.UPCOMING_RELEASE_DATE)
              : null;
        upcomingDates.set(id, upcomingDate);
        const platforms = row.UPCOMING_PLATFORMS
          ? row.UPCOMING_PLATFORMS.split(",")
              .map((s: string) => s.trim())
              .filter(Boolean)
          : [];
        upcomingPlatforms.set(id, platforms);
        return {
          id,
          title: String(row.TITLE),
          description: row.DESCRIPTION ? String(row.DESCRIPTION) : null,
          imageData: null,
          thumbnailBad: false,
          thumbnailApproved: false,
          igdbId: row.IGDB_ID ? Number(row.IGDB_ID) : null,
          slug: row.SLUG ? String(row.SLUG) : null,
          totalRating: row.TOTAL_RATING ? Number(row.TOTAL_RATING) : null,
          igdbUrl: row.IGDB_URL ? String(row.IGDB_URL) : null,
          featuredVideoUrl: row.FEATURED_VIDEO_URL
            ? String(row.FEATURED_VIDEO_URL)
            : null,
          initialReleaseDate:
            row.INITIAL_RELEASE_DATE instanceof Date
              ? row.INITIAL_RELEASE_DATE
              : row.INITIAL_RELEASE_DATE
                ? new Date(row.INITIAL_RELEASE_DATE)
                : null,
          createdAt:
            row.CREATED_AT instanceof Date
              ? row.CREATED_AT
              : new Date(row.CREATED_AT),
          updatedAt:
            row.UPDATED_AT instanceof Date
              ? row.UPDATED_AT
              : new Date(row.UPDATED_AT),
          coverUrl: null,
        };
      });

      const withPlatforms = await Game.attachPlatformsToGames(games);
      return withPlatforms.map((g) => ({
        ...g,
        upcomingReleaseDate: upcomingDates.get(g.id) ?? null,
        upcomingReleasePlatforms: upcomingPlatforms.get(g.id) ?? [],
      }));
    });
  }

  static async addGamePlatformsByIgdbIds(
    gameId: number,
    igdbPlatformIds: number[],
  ): Promise<void> {
    if (!Number.isInteger(gameId) || gameId <= 0) return;
    const uniqueIds = Array.from(
      new Set(igdbPlatformIds.filter((id) => Number.isInteger(id) && id > 0)),
    );
    if (!uniqueIds.length) return;

    const platformMap = await Game.getPlatformsByIgdbIds(uniqueIds);
    const missingIds = uniqueIds.filter((id) => !platformMap.has(id));
    if (missingIds.length) {
      console.warn(
        `Missing IGDB platform IDs in GAMEDB_PLATFORMS: ${missingIds.join(", ")}`,
      );
    }

    await oraTransaction(async (conn) => {
      for (const igdbId of uniqueIds) {
        const platform = platformMap.get(igdbId);
        if (!platform) continue;
        await oraMutate(
          getSql(GameSql.addGamePlatformMerge, dialect),
          { gameId, platformId: platform.id },
          conn,
        );
      }
    });
  }

  static async getGamesForAudit(
    missingImage: boolean,
    missingFeaturedVideo: boolean,
    missingDescription: boolean,
    missingReleaseData: boolean,
    titleWords?: string[],
    showCompleteOnly: boolean = false,
  ): Promise<IGame[]> {
    return oraWithConnection(async (connection) => {
      const whereClauses: string[] = [];
      if (missingImage) {
        whereClauses.push("IMAGE_DATA IS NULL");
      }
      if (missingFeaturedVideo) {
        whereClauses.push("FEATURED_VIDEO_URL IS NULL");
      }
      if (missingDescription) {
        whereClauses.push("DESCRIPTION IS NULL");
      }
      if (missingReleaseData) {
        whereClauses.push(
          "NOT EXISTS (SELECT 1 FROM GAMEDB_RELEASES r WHERE r.GAME_ID = g.GAME_ID)",
        );
      }

      if (whereClauses.length === 0) {
        return [];
      }

      // If both are true, we want games that have missing image OR missing thread?
      // "check for missing images and thread links" -> usually implies Union or OR logic in an audit.
      // If I say "audit images", I get missing images.
      // If I say "audit threads", I get missing threads.
      // If I say "audit both", I probably want anything that is missing either.

      const whereClause = whereClauses.join(" OR ");
      const binds: Record<string, any> = {};
      let titleClause = "";
      if (titleWords && titleWords.length) {
        const wordClauses: string[] = [];
        titleWords.forEach((word, index) => {
          const key = `titleWord${index}`;
          binds[key] = `%${word.toLowerCase()}%`;
          wordClauses.push(`LOWER(g.TITLE) LIKE :${key}`);
        });
        titleClause = wordClauses.length ? `(${wordClauses.join(" OR ")})` : "";
      }

      let combinedClause = titleClause
        ? `(${whereClause}) AND ${titleClause}`
        : whereClause;

      if (showCompleteOnly) {
        const completeClause = `
          IMAGE_DATA IS NOT NULL
          AND FEATURED_VIDEO_URL IS NOT NULL
          AND DESCRIPTION IS NOT NULL
          AND EXISTS (SELECT 1 FROM GAMEDB_RELEASES r WHERE r.GAME_ID = g.GAME_ID)
        `;
        combinedClause = titleClause
          ? `(${completeClause}) AND ${titleClause}`
          : completeClause;
      }

      const result = await connection.execute<{
        GAME_ID: number;
        TITLE: string;
        DESCRIPTION: string | null;
        IMAGE_DATA: Buffer | null;
        IGDB_ID: number | null;
        SLUG: string | null;
        TOTAL_RATING: number | null;
        IGDB_URL: string | null;
        FEATURED_VIDEO_URL: string | null;
        INITIAL_RELEASE_DATE: Date | null;
        CREATED_AT: Date;
        UPDATED_AT: Date;
      }>(
        GameSql.getGamesForAudit(combinedClause)[dialect],
        binds,
        {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
          fetchInfo: {
            IMAGE_DATA: { type: oracledb.BUFFER },
            DESCRIPTION: { type: oracledb.STRING },
          },
        },
      );

      return (result.rows ?? []).map(mapGameRow);
    });
  }

  static async updateGameImage(
    gameId: number,
    imageData: Buffer,
  ): Promise<void> {
    await oraMutate(
      getSql(GameSql.updateGameImage, dialect),
      { imageData, gameId },
    );
  }

  static async updateGameThumbnailBad(
    gameId: number,
    isBad: boolean,
  ): Promise<void> {
    await oraMutate(
      getSql(GameSql.updateGameThumbnailBad, dialect),
      { thumbnailBad: isBad ? 1 : 0, gameId },
    );
  }

  static async updateGameThumbnailApproved(
    gameId: number,
    isApproved: boolean,
  ): Promise<void> {
    await oraMutate(
      getSql(GameSql.updateGameThumbnailApproved, dialect),
      { thumbnailApproved: isApproved ? 1 : 0, gameId },
    );
  }

  static async getThreadStatusForGameIds(
    gameIds: number[],
  ): Promise<Set<number>> {
    const ids = Array.from(
      new Set(gameIds.filter((id) => Number.isInteger(id) && id > 0)),
    );
    if (!ids.length) return new Set();

    const placeholders = ids.map((_, idx) => `:id${idx}`).join(", ");
    const binds: Record<string, any> = {};
    ids.forEach((id, idx) => {
      binds[`id${idx}`] = id;
    });

    const rows = await oraQuery(
      GameSql.getThreadStatusForGameIds(placeholders)[dialect],
      binds,
      (row: { GAME_ID: number }) => Number(row.GAME_ID),
    );
    return new Set(rows);
  }

  static async updateFeaturedVideoUrl(
    gameId: number,
    featuredVideoUrl: string | null,
  ): Promise<void> {
    await oraMutate(
      getSql(GameSql.updateFeaturedVideoUrl, dialect),
      { featuredVideoUrl, gameId },
    );
  }

  static async updateGameDescription(
    gameId: number,
    description: string | null,
  ): Promise<void> {
    await oraMutate(
      getSql(GameSql.updateGameDescription, dialect),
      { description, gameId },
    );
  }

  static async clearReleaseDates(
    gameId: number,
  ): Promise<{ releases: number; announcements: number }> {
    return oraTransaction(async (conn) => {
      const announceResult = await oraMutate(
        getSql(GameSql.clearReleaseAnnouncements, dialect),
        { gameId },
        conn,
      );
      const releaseResult = await oraMutate(
        getSql(GameSql.clearReleases, dialect),
        { gameId },
        conn,
      );
      await oraMutate(
        getSql(GameSql.clearInitialReleaseDate, dialect),
        { gameId },
        conn,
      );
      return {
        releases: Number(releaseResult.rowsAffected ?? 0),
        announcements: Number(announceResult.rowsAffected ?? 0),
      };
    });
  }

  static async refreshReleaseDates(
    gameId: number,
    releases: NonNullable<IGDBGameDetails["release_dates"]>,
  ): Promise<void> {
    await Game.clearReleaseDates(gameId);
    if (!releases.length) return;
    await Game.saveReleaseDates(gameId, releases);
  }

  static async touchGameUpdatedAt(gameId: number): Promise<void> {
    await oraMutate(
      getSql(GameSql.touchGameUpdatedAt, dialect),
      { gameId },
    );
  }

  static async getGameAssociations(
    gameId: number,
  ): Promise<IGameAssociationSummary> {
    type WinRow = {
      ROUND_NUMBER: number;
      THREAD_ID: string | null;
      REDDIT_URL: string | null;
      MONTH_YEAR: string;
    };
    type NomRow = {
      ROUND_NUMBER: number;
      USER_ID: string;
      USERNAME?: string | null;
      GLOBAL_NAME?: string | null;
    };

    const [gotmWins, nrGotmWins, gotmNominations, nrGotmNominations] =
      await Promise.all([
        oraQuery<
          WinRow,
          {
            round: number;
            threadId: string | null;
            redditUrl: string | null;
            monthYear: string;
          }
        >(
          getSql(GameSql.getGotmWins, dialect),
          { gameId },
          (row) => ({
            round: Number(row.ROUND_NUMBER),
            threadId: row.THREAD_ID ?? null,
            redditUrl: row.REDDIT_URL ?? null,
            monthYear: String(row.MONTH_YEAR),
          }),
        ),
        oraQuery<
          WinRow,
          {
            round: number;
            threadId: string | null;
            redditUrl: string | null;
            monthYear: string;
          }
        >(
          getSql(GameSql.getNrGotmWins, dialect),
          { gameId },
          (row) => ({
            round: Number(row.ROUND_NUMBER),
            threadId: row.THREAD_ID ?? null,
            redditUrl: row.REDDIT_URL ?? null,
            monthYear: String(row.MONTH_YEAR),
          }),
        ),
        oraQuery<NomRow, { round: number; userId: string; username: string }>(
          getSql(GameSql.getGotmNominations, dialect),
          { gameId },
          (row) => ({
            round: Number(row.ROUND_NUMBER),
            userId: String(row.USER_ID),
            username: String(row.GLOBAL_NAME || row.USERNAME || row.USER_ID),
          }),
        ),
        oraQuery<NomRow, { round: number; userId: string; username: string }>(
          getSql(GameSql.getNrGotmNominations, dialect),
          { gameId },
          (row) => ({
            round: Number(row.ROUND_NUMBER),
            userId: String(row.USER_ID),
            username: String(row.GLOBAL_NAME || row.USERNAME || row.USER_ID),
          }),
        ),
      ]);

    return { gotmWins, nrGotmWins, gotmNominations, nrGotmNominations };
  }

  static async getNowPlayingMembers(
    gameId: number,
  ): Promise<INowPlayingMember[]> {
    return oraQuery(
      getSql(GameSql.getNowPlayingMembers, dialect),
      { gameId },
      (row: {
        USER_ID: string;
        USERNAME: string | null;
        GLOBAL_NAME: string | null;
        THREAD_ID: string | null;
        ADDED_AT: Date | null;
      }) => ({
        userId: String(row.USER_ID),
        username: row.USERNAME ?? null,
        globalName: row.GLOBAL_NAME ?? null,
        threadId: row.THREAD_ID ?? null,
        addedAt:
          row.ADDED_AT instanceof Date
            ? row.ADDED_AT
            : row.ADDED_AT
              ? new Date(row.ADDED_AT as string)
              : null,
      }),
    );
  }

  static async getGameCompletions(gameId: number): Promise<ICompletedMember[]> {
    return oraQuery(
      getSql(GameSql.getGameCompletions, dialect),
      { gameId },
      (row: {
        USER_ID: string;
        USERNAME: string | null;
        GLOBAL_NAME: string | null;
        COMPLETION_TYPE: string;
        COMPLETED_AT: Date | null;
        FINAL_PLAYTIME_HRS: number | null;
      }) => ({
        userId: String(row.USER_ID),
        username: row.USERNAME ?? null,
        globalName: row.GLOBAL_NAME ?? null,
        completionType: String(row.COMPLETION_TYPE),
        completedAt:
          row.COMPLETED_AT instanceof Date
            ? row.COMPLETED_AT
            : row.COMPLETED_AT
              ? new Date(row.COMPLETED_AT as string)
              : null,
        finalPlaytimeHours:
          row.FINAL_PLAYTIME_HRS == null
            ? null
            : Number(row.FINAL_PLAYTIME_HRS),
      }),
    );
  }

  static async getGameCollectionOwners(
    gameId: number,
  ): Promise<ICollectionOwnerMember[]> {
    return oraQuery(
      getSql(GameSql.getGameCollectionOwners, dialect),
      { gameId },
      (row: {
        USER_ID: string;
        USERNAME: string | null;
        GLOBAL_NAME: string | null;
      }) => ({
        userId: String(row.USER_ID),
        username: row.USERNAME ?? null,
        globalName: row.GLOBAL_NAME ?? null,
      }),
    );
  }
}
