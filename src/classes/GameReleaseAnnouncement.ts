import { apiGet, apiPatch } from "../services/RpgClubApiClient.js";

export interface IReleaseAnnouncementCandidate {
  announcementId: number;
  releaseId: number;
  gameId: number;
  title: string;
  releaseDate: Date;
  announceAt: Date;
  platformName: string | null;
  platformAbbreviation: string | null;
  igdbUrl: string | null;
}

type ReleaseAnnouncementDueData = {
  id: number;
  release_id: number;
  game_id: number;
  title: string;
  release_date: string;
  announce_at: string;
  platform_name: string | null;
  platform_abbreviation: string | null;
  igdb_url: string | null;
};

type ReleaseAnnouncementDueResponse = { data: ReleaseAnnouncementDueData[] };

type GamesListResponse = {
  data: { id: number }[];
  meta: { pages: number; page: number };
};

const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 100;
const GAMES_PER_PAGE = 100;

function clampBatchSize(limit: number): number {
  const asNumber = Number(limit);
  if (!Number.isFinite(asNumber)) {
    return DEFAULT_BATCH_SIZE;
  }
  return Math.min(MAX_BATCH_SIZE, Math.max(1, Math.floor(asNumber)));
}

function mapDueData(d: ReleaseAnnouncementDueData): IReleaseAnnouncementCandidate {
  return {
    announcementId: d.id,
    releaseId: d.release_id,
    gameId: d.game_id,
    title: d.title,
    releaseDate: new Date(d.release_date),
    announceAt: new Date(d.announce_at),
    platformName: d.platform_name ?? null,
    platformAbbreviation: d.platform_abbreviation ?? null,
    igdbUrl: d.igdb_url ?? null,
  };
}

export default class GameReleaseAnnouncement {
  static async syncReleaseAnnouncements(): Promise<void> {
    let page = 1;
    let totalPages = 1;
    do {
      const response = await apiGet<GamesListResponse>("/api/v1/games", {
        params: { per: GAMES_PER_PAGE, page },
      });
      if (!response) break;
      totalPages = response.meta.pages;
      await Promise.all(
        response.data.map((game) =>
          apiPatch(`/api/v1/games/${game.id}/release_announcements`),
        ),
      );
      page++;
    } while (page <= totalPages);
  }

  static async listDueAnnouncements(
    _referenceTime: Date,
    limit: number = DEFAULT_BATCH_SIZE,
  ): Promise<IReleaseAnnouncementCandidate[]> {
    const safeLimit = clampBatchSize(limit);
    const response = await apiGet<ReleaseAnnouncementDueResponse>(
      "/api/v1/release_announcements/due",
      { params: { limit: safeLimit } },
    );
    if (!response) return [];
    return response.data.map(mapDueData);
  }

  static async markAnnouncementSent(announcementId: number, sentAt: Date): Promise<boolean> {
    const result = await apiPatch(
      `/api/v1/release_announcements/${announcementId}`,
      { data: { sent_at: sentAt.toISOString() } },
    );
    return result !== null;
  }
}
