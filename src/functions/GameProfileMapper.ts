import type {
  IGame,
  IReleaseWithNames,
  IGameAssociationSummary,
  INowPlayingMember,
  ICompletedMember,
  ICollectionOwnerMember,
  IMappedGameProfile,
} from "../types/GameTypes.js";
import {
  mapGameFromApi,
  mapReleaseFromApi,
  mapHltbFromProfileApi,
  type HltbProfileApiData,
} from "./GameMappers.js";

export type CompanyApiData = {
  company_id: number;
  name: string;
  igdb_company_id: number | null;
};

export type NowPlayingApiEntry = {
  user_id: string;
  user: { user_id: string; username: string | null; global_name: string | null };
};

export type CompletionGameApiEntry = {
  user_id: string;
  completion_type: string;
  completed_at: string | null;
  final_playtime_hrs: number | null;
  user: { user_id: string; username: string | null; global_name: string | null };
};

export type RelationReleaseApiData = {
  release_id: number;
  game_id: number;
  platform_id: number;
  region_id: number;
  format: string | null;
  release_date: string | null;
  notes: string | null;
  platform_name: string | null;
  region_name: string | null;
  platform_code: string | null;
  region_code: string | null;
};

export type GameRelationsApiData = {
  releases: RelationReleaseApiData[];
  platforms: Array<{
    platform_id: number;
    platform_code: string;
    platform_name: string;
    platform_abbreviation?: string | null;
    igdb_platform_id?: number | null;
  }>;
  collection: { name: string } | null;
  companies: Array<CompanyApiData & { role: string | null }>;
  franchises: Array<{ name: string }>;
  genres: Array<{ name: string }>;
  engines: Array<{ name: string }>;
  modes: Array<{ name: string }>;
  perspectives: Array<{ name: string }>;
  themes: Array<{ name: string }>;
  alternates: Array<Record<string, unknown>>;
};

type ProfileCollectionOwnerApiData = {
  user_id: string;
  username: string | null;
};

type ProfileGotmWinApiData = {
  round: number;
  reddit_url: string | null;
};

type ProfileGotmNominationApiData = {
  round: number;
  user_id: string;
  username: string | null;
};

type ProfileThreadApiData = {
  thread_id: string;
  jump_url: string | null;
};

export type GameProfileApiData = {
  game: Record<string, unknown>;
  relations: GameRelationsApiData;
  now_playing: NowPlayingApiEntry[];
  completions: CompletionGameApiEntry[];
  threads: ProfileThreadApiData[];
  primary_image: { url: string } | null;
  associations: {
    gotm_wins: ProfileGotmWinApiData[];
    nr_gotm_wins: ProfileGotmWinApiData[];
    gotm_nominations: ProfileGotmNominationApiData[];
    nr_gotm_nominations: ProfileGotmNominationApiData[];
  };
  collection_owners: ProfileCollectionOwnerApiData[];
  hltb: HltbProfileApiData | null;
};

export function mapGameProfileFromApi(
  d: GameProfileApiData,
  gameId: number,
): IMappedGameProfile {
  const game: IGame = mapGameFromApi(d.game);
  const relations = d.relations;

  const releases: IReleaseWithNames[] = (relations.releases ?? []).map((r) => ({
    ...mapReleaseFromApi(r),
    platformName: r.platform_name ?? null,
    regionName: r.region_name ?? null,
  }));

  const associations: IGameAssociationSummary = {
    gotmWins: (d.associations.gotm_wins ?? []).map((w) => ({
      round: Number(w.round),
      threadId: null,
      redditUrl: w.reddit_url ?? null,
      monthYear: "",
    })),
    nrGotmWins: (d.associations.nr_gotm_wins ?? []).map((w) => ({
      round: Number(w.round),
      threadId: null,
      redditUrl: w.reddit_url ?? null,
      monthYear: "",
    })),
    gotmNominations: (d.associations.gotm_nominations ?? []).map((n) => ({
      round: Number(n.round),
      userId: String(n.user_id),
      username: String(n.username || n.user_id),
    })),
    nrGotmNominations: (d.associations.nr_gotm_nominations ?? []).map((n) => ({
      round: Number(n.round),
      userId: String(n.user_id),
      username: String(n.username || n.user_id),
    })),
  };

  const nowPlayingMembers: INowPlayingMember[] = (d.now_playing ?? []).map(
    (entry) => ({
      userId: String(entry.user_id),
      username: entry.user?.username ?? null,
      globalName: entry.user?.global_name ?? null,
      threadId: null,
      addedAt: null,
    }),
  );

  const collectionOwners: ICollectionOwnerMember[] = (
    d.collection_owners ?? []
  ).map((o) => ({
    userId: String(o.user_id),
    username: o.username ?? null,
    globalName: null,
  }));

  const completions: ICompletedMember[] = (d.completions ?? []).map((entry) => ({
    userId: String(entry.user_id),
    username: entry.user?.username ?? null,
    globalName: entry.user?.global_name ?? null,
    completionType: String(entry.completion_type),
    completedAt: entry.completed_at ? new Date(entry.completed_at) : null,
    finalPlaytimeHours:
      entry.final_playtime_hrs != null ? Number(entry.final_playtime_hrs) : null,
  }));

  const alternateVersions: IGame[] = (relations.alternates ?? []).map(mapGameFromApi);
  const threadIds = (d.threads ?? []).map((t) => String(t.thread_id));
  const hltbCache = d.hltb ? mapHltbFromProfileApi(d.hltb, gameId) : null;
  const primaryImageUrl = d.primary_image?.url ?? null;
  const series = relations.collection?.name ?? null;
  const developers = (relations.companies ?? [])
    .filter((c) => c.role === "Developer")
    .map((c) => String(c.name));
  const publishers = (relations.companies ?? [])
    .filter((c) => c.role === "Publisher")
    .map((c) => String(c.name));

  return {
    game,
    releases,
    associations,
    nowPlayingMembers,
    collectionOwners,
    completions,
    alternateVersions,
    threadIds,
    hltbCache,
    primaryImageUrl,
    series,
    developers,
    publishers,
  };
}
