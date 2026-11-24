import {
  apiGet,
  apiGetOrThrow,
  apiPostOrThrow,
} from "./RpgClubApiClient.js";
import type { IChallenge, IChallengeMember, IPoolGame } from "./ChallengeApi.js";

// The Pool Proposal, list notice and Franchise endpoints /challenge calls (spec api#442,
// tickets api#447 and api#448). The shapes are the API's own (snake_case), as its swagger
// serves them. Every call that acts for a member names them with acting_user_id: the API
// decides who may propose, decide and add to the linked Game List.

export type ProposalStatus = "pending" | "accepted" | "declined";
export type ProposalDecision = "core" | "optional";

/** A Pool Proposal: a member asked for a game to join a Pool Challenge. */
export interface IPoolProposal {
  id: number;
  challenge_id: number;
  game: IPoolGame;
  proposer: IChallengeMember;
  /** The proposer's note to whoever decides; null for none. */
  note?: string | null;
  status: ProposalStatus;
  accepted_as?: ProposalDecision | null;
  decider?: IChallengeMember | null;
  decided_at?: string | null;
  created_at: string;
}

/** An open list notice: a Core Game whose entry left the linked Game List. */
export interface IListNotice {
  id: number;
  game: IPoolGame;
  created_at: string;
}

export type ListNoticeResolution = "remove" | "keep";

/** A Franchise game, as GET /franchises/:id groups them. */
export interface IFranchiseGame {
  game_id: number;
  title: string;
  mainline: boolean;
}

export interface IChallengeProposalApi {
  /**
   * GET /challenges/:id/pool_proposals?status=: deciders get every proposal, others their
   * own. Oldest first (the API serves newest first; the bot steps from the oldest).
   */
  listProposals(
    challengeId: number,
    actingUserId: string,
    status?: ProposalStatus,
  ): Promise<IPoolProposal[]>;
  /** POST /challenges/:id/pool_proposals. Throws the AxiosError on a refusal. */
  propose(
    challengeId: number,
    gameId: number,
    note: string | null,
    actingUserId: string,
  ): Promise<IPoolProposal>;
  /** POST .../pool_proposals/:id/accept. Throws the AxiosError on a refusal. */
  accept(
    challengeId: number,
    proposalId: number,
    as: ProposalDecision,
    actingUserId: string,
  ): Promise<IPoolProposal>;
  /** POST .../pool_proposals/:id/decline. Throws the AxiosError on a refusal. */
  decline(challengeId: number, proposalId: number, actingUserId: string): Promise<IPoolProposal>;
  /** POST /challenges/:id/list_notices/:notice_id/remove or /keep: the Challenge after. */
  resolveListNotice(
    challengeId: number,
    noticeId: number,
    resolution: ListNoticeResolution,
    actingUserId: string,
  ): Promise<IChallenge>;
}

/** Proposals read per request, and the most requests one read makes. */
const PROPOSALS_PER = 50;
const PROPOSALS_MAX_REQUESTS = 4;

const CHALLENGES_PATH = "/api/v1/challenges";

function withQuery(path: string, query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return `${path}?${params.toString()}`;
}

function proposalsPath(challengeId: number): string {
  return `${CHALLENGES_PATH}/${challengeId}/pool_proposals`;
}

export const CHALLENGE_PROPOSAL_API: IChallengeProposalApi = {
  async listProposals(challengeId, actingUserId, status) {
    const items: IPoolProposal[] = [];
    for (let page = 1; page <= PROPOSALS_MAX_REQUESTS; page += 1) {
      const payload = await apiGetOrThrow<{ data: IPoolProposal[]; meta?: { pages?: number } }>(
        withQuery(proposalsPath(challengeId), {
          acting_user_id: actingUserId,
          status,
          page,
          per: PROPOSALS_PER,
        }),
      );
      items.push(...(payload.data ?? []));
      if (page >= (payload.meta?.pages ?? 1)) break;
    }
    return items.reverse();
  },
  async propose(challengeId, gameId, note, actingUserId) {
    const payload = await apiPostOrThrow<{ data: IPoolProposal }>(proposalsPath(challengeId), {
      data: { game_id: gameId, ...(note ? { note } : {}), acting_user_id: actingUserId },
    });
    return payload.data;
  },
  async accept(challengeId, proposalId, as, actingUserId) {
    const payload = await apiPostOrThrow<{ data: IPoolProposal }>(
      `${proposalsPath(challengeId)}/${proposalId}/accept`,
      { data: { as, acting_user_id: actingUserId } },
    );
    return payload.data;
  },
  async decline(challengeId, proposalId, actingUserId) {
    const payload = await apiPostOrThrow<{ data: IPoolProposal }>(
      `${proposalsPath(challengeId)}/${proposalId}/decline`,
      { data: { acting_user_id: actingUserId } },
    );
    return payload.data;
  },
  async resolveListNotice(challengeId, noticeId, resolution, actingUserId) {
    const payload = await apiPostOrThrow<{ data: IChallenge }>(
      `${CHALLENGES_PATH}/${challengeId}/list_notices/${noticeId}/${resolution}`,
      { data: { acting_user_id: actingUserId } },
    );
    return payload.data;
  },
};

/**
 * A Franchise's Mainline games (GET /franchises/:id, `games.mainline`; Add-ons never count),
 * or none when the Franchise is gone. Throws the AxiosError on another failure.
 */
export async function franchiseMainlineGames(franchiseId: number): Promise<IFranchiseGame[]> {
  const payload = await apiGet<{ data: { games?: { mainline?: IFranchiseGame[] } } }>(
    `/api/v1/franchises/${franchiseId}`,
  );
  return payload?.data.games?.mainline ?? [];
}
