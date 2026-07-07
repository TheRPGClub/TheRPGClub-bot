import type { IGame, IRelease, IPlatformDef, IRegionDef } from "../types/GameTypes.js";
import type { HltbCacheEntry } from "../classes/HltbCache.js";

export const IGDB_REGION_MAP: Record<number, { code: string; name: string }> = {
  1: { code: "EU", name: "Europe" },
  2: { code: "NA", name: "North America" },
  3: { code: "AUS", name: "Australia" },
  4: { code: "NZ", name: "New Zealand" },
  5: { code: "JP", name: "Japan" },
  6: { code: "CN", name: "China" },
  7: { code: "AS", name: "Asia" },
  8: { code: "WW", name: "Worldwide" },
};

export const buildPlatformCode = (name: string | null, igdbId: number): string => {
  const platformName = name ?? `IGDB Platform ${igdbId}`;
  const sanitized = platformName.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const base = sanitized.slice(0, 12) || "PLATFORM";
  const codeWithId = `${base}${igdbId}`;
  return codeWithId.length > 20 ? codeWithId.slice(0, 20) : codeWithId;
};

export type ReleaseApiData = {
  release_id: number;
  game_id: number;
  platform_id: number;
  region_id: number;
  format: string | null;
  release_date: string | null;
  notes: string | null;
};

export type PlatformApiData = {
  platform_id: number;
  platform_code: string;
  platform_name: string;
  platform_abbreviation?: string | null;
  igdb_platform_id?: number | null;
};

export type RegionApiData = {
  region_id: number;
  region_code: string;
  region_name: string;
  igdb_region_id: number | null;
};

export function mapGameFromApi(data: any): IGame {
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

export function mapGameRow(row: any): IGame {
  const imageRaw = row.IMAGE_DATA ?? row.image_data;
  const ird = row.INITIAL_RELEASE_DATE ?? row.initial_release_date;
  const cat = row.CREATED_AT ?? row.created_at;
  const uat = row.UPDATED_AT ?? row.updated_at;
  return {
    id: Number(row.GAME_ID ?? row.game_id),
    title: String(row.TITLE ?? row.title),
    description:
      (row.DESCRIPTION ?? row.description)
        ? String(row.DESCRIPTION ?? row.description)
        : null,
    imageData: imageRaw instanceof Buffer ? imageRaw : null,
    thumbnailBad: Number(row.THUMBNAIL_BAD ?? row.thumbnail_bad ?? 0) === 1,
    thumbnailApproved:
      Number(row.THUMBNAIL_APPROVED ?? row.thumbnail_approved ?? 0) === 1,
    igdbId:
      (row.IGDB_ID ?? row.igdb_id) ? Number(row.IGDB_ID ?? row.igdb_id) : null,
    slug: (row.SLUG ?? row.slug) ? String(row.SLUG ?? row.slug) : null,
    totalRating:
      (row.TOTAL_RATING ?? row.total_rating)
        ? Number(row.TOTAL_RATING ?? row.total_rating)
        : null,
    igdbUrl:
      (row.IGDB_URL ?? row.igdb_url)
        ? String(row.IGDB_URL ?? row.igdb_url)
        : null,
    featuredVideoUrl:
      (row.FEATURED_VIDEO_URL ?? row.featured_video_url)
        ? String(row.FEATURED_VIDEO_URL ?? row.featured_video_url)
        : null,
    initialReleaseDate: ird instanceof Date ? ird : ird ? new Date(ird) : null,
    createdAt: cat instanceof Date ? cat : new Date(cat),
    updatedAt: uat instanceof Date ? uat : new Date(uat),
    coverUrl: null,
  };
}

export function mapReleaseRow(row: any): IRelease {
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

export function mapReleaseFromApi(data: ReleaseApiData): IRelease {
  return {
    id: Number(data.release_id),
    gameId: Number(data.game_id),
    platformId: Number(data.platform_id),
    regionId: Number(data.region_id),
    format: data.format ? (data.format as "Physical" | "Digital") : null,
    releaseDate: data.release_date ? new Date(data.release_date) : null,
    notes: data.notes ?? null,
  };
}

export function mapPlatformFromApi(data: PlatformApiData): IPlatformDef {
  return {
    id: Number(data.platform_id),
    code: String(data.platform_code),
    name: String(data.platform_name),
    abbreviation: data.platform_abbreviation ?? null,
    igdbPlatformId:
      data.igdb_platform_id != null ? Number(data.igdb_platform_id) : null,
  };
}

export function mapRegionFromApi(data: RegionApiData): IRegionDef {
  return {
    id: Number(data.region_id),
    code: String(data.region_code),
    name: String(data.region_name),
    igdbRegionId: data.igdb_region_id != null ? Number(data.igdb_region_id) : null,
  };
}

export function mapHltbFromProfileApi(
  data: HltbProfileApiData,
  gameId: number,
): HltbCacheEntry {
  const toDate = (v: string | null): Date | null => (v ? new Date(v) : null);
  return {
    gameId,
    name: data.name ?? null,
    url: data.url ?? null,
    imageUrl: data.image_url ?? null,
    main: data.main ?? null,
    mainSides: data.main_sides ?? null,
    completionist: data.completionist ?? null,
    singlePlayer: data.single_player ?? null,
    coOp: data.co_op ?? null,
    vs: data.vs ?? null,
    sourceQuery: data.source_query ?? null,
    scrapedAt: toDate(data.scraped_at),
    updatedAt: toDate(data.updated_at),
  };
}

export type HltbProfileApiData = {
  name: string | null;
  url: string | null;
  image_url: string | null;
  main: string | null;
  main_sides: string | null;
  completionist: string | null;
  single_player: string | null;
  co_op: string | null;
  vs: string | null;
  source_query: string | null;
  scraped_at: string | null;
  updated_at: string | null;
};
