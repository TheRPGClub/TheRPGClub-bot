import type { HltbCacheEntry } from "../classes/HltbCache.js";

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

export interface IReleaseWithNames extends IRelease {
  platformName: string | null;
  regionName: string | null;
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

export interface IMappedGameProfile {
  game: IGame;
  releases: IReleaseWithNames[];
  associations: IGameAssociationSummary;
  nowPlayingMembers: INowPlayingMember[];
  collectionOwners: ICollectionOwnerMember[];
  completions: ICompletedMember[];
  alternateVersions: IGame[];
  threadIds: string[];
  hltbCache: HltbCacheEntry | null;
  primaryImageUrl: string | null;
  series: string | null;
  developers: string[];
  publishers: string[];
}

export type GameSource = "API";
