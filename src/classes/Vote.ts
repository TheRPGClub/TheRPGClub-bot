import { isPositiveInt } from "../utilities/ValidationUtils.js";
import { apiGet, apiPost, apiDelete } from "../services/RpgClubApiClient.js";
import { nominationApiPrefix, type NominationKind } from "./Nomination.js";

export interface IVoteEntry {
  id: number;
  roundNumber: number;
  userId: string;
  nominationId: number;
  gamedbGameId: number;
  gameTitle: string;
  votedAt: Date;
}

export interface IVoteCastResult {
  action: "voted" | "unvoted";
  vote: IVoteEntry | null;
  removedVotes: IVoteEntry[];
  cap: number;
  warning: string | null;
}

export interface IVoteTallyRow {
  nominationId: number;
  gamedbGameId: number;
  voteCount: number;
}

export interface IVoteTally {
  rows: IVoteTallyRow[];
  cap: number;
}

type VoteApiData = {
  vote_id: number;
  round_number: number;
  user_id: string;
  nomination_id: number;
  gamedb_game_id: number;
  voted_at: string;
  game: { title?: string } | null;
};

type VoteCastApiResponse = {
  data: {
    action: "voted" | "unvoted";
    vote: VoteApiData | null;
    removed_votes: VoteApiData[];
    cap: number;
    warning: string | null;
  };
};

type VoteListApiResponse = { data: VoteApiData[] };

type VoteTallyApiResponse = {
  data: Array<{ nomination_id: number; gamedb_game_id: number; vote_count: number }>;
  meta: { cap: number };
};

function mapApiData(d: VoteApiData): IVoteEntry {
  const gamedbGameId = Number(d.gamedb_game_id);
  return {
    id: Number(d.vote_id),
    roundNumber: Number(d.round_number),
    userId: String(d.user_id),
    nominationId: Number(d.nomination_id),
    gamedbGameId,
    gameTitle: d.game?.title ?? `(missing GameDB title for id ${gamedbGameId})`,
    votedAt: new Date(d.voted_at),
  };
}

/**
 * Casts or toggles a vote on a nomination. Returns null when the API reports
 * the nomination no longer exists in the round (404).
 */
export async function castVote(
  kind: NominationKind,
  roundNumber: number,
  userId: string,
  nominationId: number,
): Promise<IVoteCastResult | null> {
  if (!isPositiveInt(nominationId)) {
    throw new Error("A valid nomination id is required to cast a vote.");
  }

  const response = await apiPost<VoteCastApiResponse>(
    `/api/v1/${nominationApiPrefix(kind)}/${roundNumber}/votes`,
    { data: { user_id: userId, nomination_id: nominationId } },
  );
  if (!response) {
    return null;
  }
  const d = response.data;
  return {
    action: d.action,
    vote: d.vote ? mapApiData(d.vote) : null,
    removedVotes: (d.removed_votes ?? []).map(mapApiData),
    cap: Number(d.cap),
    warning: d.warning ?? null,
  };
}

export async function getVotesForUser(
  kind: NominationKind,
  roundNumber: number,
  userId: string,
): Promise<IVoteEntry[]> {
  const response = await apiGet<VoteListApiResponse>(
    `/api/v1/${nominationApiPrefix(kind)}/${roundNumber}/votes/${userId}`,
  );
  return (response?.data ?? []).map(mapApiData);
}

export async function getVoteTally(
  kind: NominationKind,
  roundNumber: number,
): Promise<IVoteTally> {
  const response = await apiGet<VoteTallyApiResponse>(
    `/api/v1/${nominationApiPrefix(kind)}/${roundNumber}/votes/tally`,
  );
  return {
    rows: (response?.data ?? []).map((row) => ({
      nominationId: Number(row.nomination_id),
      gamedbGameId: Number(row.gamedb_game_id),
      voteCount: Number(row.vote_count),
    })),
    cap: Number(response?.meta?.cap ?? 2),
  };
}

export async function deleteAllVotesForRound(
  kind: NominationKind,
  roundNumber: number,
): Promise<number> {
  const response = await apiDelete<{ deleted: boolean; count: number }>(
    `/api/v1/${nominationApiPrefix(kind)}/${roundNumber}/votes`,
  );
  return response?.deleted ? Number(response.count ?? 0) : 0;
}
