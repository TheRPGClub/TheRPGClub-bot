import axios from "axios";
import {
  CHALLENGE_RUNS_MAX_REQUESTS,
  CHALLENGE_RUNS_PER_REQUEST,
} from "../config/challenges.js";
import { buildApiErrorMessage } from "../utilities/ApiErrorUtils.js";
import {
  apiDelete,
  apiGet,
  apiGetOrThrow,
  apiPatchOrThrow,
  apiPostOrThrow,
  apiPutOrThrow,
} from "./RpgClubApiClient.js";
import type { IChallengeEditionSummary } from "./ChallengeEditionApi.js";

// The Challenge endpoints the bot calls (spec api#376, tickets api#377 and api#378). The
// shapes are the API's own (snake_case), as its swagger serves them. Every call that acts
// for a member names them with acting_user_id: the API decides from that member's stored
// roles and Feature Flag, never from the service token.

export type ChallengeFormat = "pool" | "slots" | "assignment";
export type ChallengeSchedule = "always_open" | "seasonal";
export type PoolTarget = number | "all";

export interface IChallengeMember {
  user_id: string;
  username: string;
  global_name?: string | null;
}

export interface IChallengePool {
  target: PoolTarget;
  franchises?: { franchise_id: number; name: string }[];
  collections?: { collection_id: number; name: string }[];
  included_games?: { game_id: number; title: string }[];
  excluded_games?: { game_id: number; title: string }[];
  /** Games in the Pool now; on a show and in announcements only. */
  game_count?: number | null;
}

export interface IChallengeSlots {
  first_year: number | "birth_year";
  last_year: number | "current_year";
  counts_past_play: boolean;
}

export interface IChallengeAssignment {
  signup_cutoff: string;
  pick_deadline: string;
  reveal: string;
  /** The latest Edition; null before the first one opens. Served, never sent. */
  edition?: IChallengeEditionSummary | null;
}

export interface IChallenge {
  id: number;
  name: string;
  description: string;
  challenge_format: ChallengeFormat;
  hosted_by_club: boolean;
  host?: IChallengeMember | null;
  schedule: ChallengeSchedule;
  ends_on?: string | null;
  season?: { start: string; end: string; crosses_new_year: boolean } | null;
  open: boolean;
  pool?: IChallengePool | null;
  slots?: IChallengeSlots | null;
  assignment?: IChallengeAssignment | null;
  /** Every Run of it; on a show only (null in lists). */
  run_count?: number | null;
  hidden: boolean;
  ended_at?: string | null;
  /** The Challenge's colours (`#rrggbb`), served on every Challenge. */
  tint?: { fill: string; hi: string } | null;
}

export interface IChallengeWarning {
  code: string;
  message: string;
  challenge_ids?: number[];
}

/** A game as the Pool preview and GameDB lists serve it. */
export interface IGameSummary {
  game_id: number;
  title: string;
  initial_release_date?: string | null;
  cover_url?: string | null;
}

export interface IPoolSource {
  kind: "franchise" | "collection";
  id: number;
  name: string;
  game_count: number;
}

export type RunStatus = "active" | "finished" | "expired" | "abandoned";

export interface IChallengeRunEntry {
  game_id: number;
  title: string;
  state: "in_progress" | "cleared";
  cleared_on?: string | null;
  /** The Game Completion that Cleared it. */
  completion_id?: number | null;
  /** Slots: the year this Cleared game fills; null when In Progress or waiting. */
  slot_year?: number | null;
  /** The member placed it there themselves (a slot move or a past-play pick). */
  picked_by_hand?: boolean;
}

/** A Slots Run's years so far, each with the game filling it (null while open). */
export interface IChallengeRunSlots {
  first_year: number;
  /** The last year so far: the current year for a range that grows. */
  last_year: number;
  growing: boolean;
  years: { year: number; game_id?: number | null; title?: string | null }[];
}

/** The Challenge a Run belongs to, as the Run serves it. */
export interface IChallengeRunChallenge {
  id: number;
  name: string;
  challenge_format: ChallengeFormat;
  schedule: ChallengeSchedule;
}

export interface IChallengeRun {
  id: number;
  /** Always served by the API; optional so older fixtures need not carry it. */
  challenge?: IChallengeRunChallenge;
  user: IChallengeMember;
  status: RunStatus;
  started_at: string;
  /** When it became Finished, Expired or Abandoned. */
  ended_at?: string | null;
  /** When play counts, as club dates (both included); ends_on null while it has no end. */
  window?: { starts_on: string; ends_on?: string | null };
  progress: { in_progress: number; cleared: number; target: number; caught_up?: boolean };
  /** The games counted on the Run, Cleared first. */
  entries?: IChallengeRunEntry[];
  /** Slots only. */
  slots?: IChallengeRunSlots | null;
  /** Assignment only: the Edition the Run was drawn in. */
  edition?: { id: number; year: number } | null;
  /** Assignment only: the game picked (null before the reveal) and the Santa (hidden). */
  assignment?: {
    game?: IGameSummary | null;
    picked_randomly?: boolean | null;
    santa?: IChallengeMember | null;
  } | null;
}

/** What the member should know about a Run they just started (`birth_year_shown`). */
export interface IChallengeNotice {
  code: string;
  message: string;
}

/** A started Run, with the start reply's notices. */
export type IStartedRun = IChallengeRun & { notices?: IChallengeNotice[] };

/** A Game Completion from before a Slots Run that may be picked for an open year. */
export interface IPastPlay {
  completion_id: number;
  game_id: number;
  title: string;
  /** Null when the Game Completion has no date. */
  completed_at?: string | null;
  /** The Run's open years the game fits. */
  open_years: number[];
}

/** A Pool definition, as the create and edit bodies and the Pool preview take it. */
export interface IPoolDefinition {
  franchise_ids: number[];
  collection_ids: number[];
  included_game_ids: number[];
  excluded_game_ids: number[];
}

/** The settings a create or edit sends; on edit only the keys given change. */
export interface IChallengeWrite {
  name?: string;
  description?: string;
  challenge_format?: ChallengeFormat;
  schedule?: ChallengeSchedule;
  ends_on?: string | null;
  season?: { start: string; end: string } | null;
  pool?: IPoolDefinition & { target: PoolTarget };
  slots?: IChallengeSlots;
  assignment?: IChallengeAssignment;
  hosted_by_club?: boolean;
}

export interface IPage<T> {
  items: T[];
  page: number;
  pages: number;
  count: number;
}

export interface IChallengeApi {
  /** GET /challenges, newest first, as the acting member may see them. */
  listChallenges(params: {
    actingUserId: string;
    open?: boolean;
    challengeFormat?: ChallengeFormat;
    page: number;
    per: number;
  }): Promise<IPage<IChallenge>>;
  /** GET /challenges/:id; null when it is gone or hidden from the acting member. */
  getChallenge(id: number, actingUserId: string): Promise<IChallenge | null>;
  /** POST /challenges. Throws the AxiosError on a refusal. */
  createChallenge(
    write: IChallengeWrite,
    actingUserId: string,
  ): Promise<{ challenge: IChallenge; warnings: IChallengeWarning[] }>;
  /** PATCH /challenges/:id. Throws the AxiosError on a refusal (409 rules_locked). */
  updateChallenge(id: number, write: IChallengeWrite, actingUserId: string): Promise<IChallenge>;
  /** POST /challenges/:id/hide or /unhide. Throws the AxiosError on a refusal. */
  setHidden(id: number, hidden: boolean, actingUserId: string): Promise<IChallenge>;
  /** PUT /challenges/:id/host: a member, or the club when hostUserId is null. */
  changeHost(id: number, hostUserId: string | null, actingUserId: string): Promise<IChallenge>;
  /** GET /challenges/:id/runs, newest first. */
  listRuns(challengeId: number, actingUserId: string, page: number, per: number):
    Promise<IPage<IChallengeRun>>;
  /** GET /users/:user_id/challenge_runs: a member's Runs, current and past, newest first. */
  listMemberRuns(userId: string, actingUserId: string, page: number, per: number):
    Promise<IPage<IChallengeRun>>;
  /** GET /challenge_runs/:id; null when it is gone or hidden from the acting member. */
  getRun(runId: number, actingUserId: string): Promise<IChallengeRun | null>;
  /**
   * POST /challenges/:id/runs for the acting member. Throws the AxiosError on a refusal
   * (409 challenge_closed, run_active, season_run_exists, birth_date_required, ...).
   */
  startRun(challengeId: number, actingUserId: string): Promise<IStartedRun>;
  /** POST /challenge_runs/:id/abandon. Throws the AxiosError on a refusal. */
  abandonRun(runId: number, actingUserId: string): Promise<IChallengeRun>;
  /** DELETE /challenge_runs/:id. Throws the AxiosError on a refusal; false when gone. */
  deleteRun(runId: number, actingUserId: string): Promise<boolean>;
  /**
   * POST /challenge_runs/:id/slot_move: puts a Cleared game in another open year. Throws
   * the AxiosError on a refusal (409 slot_filled, 422 slot_not_fitting, ...).
   */
  slotMove(runId: number, gameId: number, slotYear: number, actingUserId: string):
    Promise<IChallengeRun>;
  /**
   * POST /challenge_runs/:id/past_pick: puts an earlier Game Completion in an open year.
   * Throws the AxiosError on a refusal (422 past_play_off, already_cleared, ...).
   */
  pastPick(runId: number, completionId: number, slotYear: number, actingUserId: string):
    Promise<IChallengeRun>;
  /** GET /challenge_runs/:id/past_play: what past-pick may pick, oldest first. */
  pastPlay(runId: number, actingUserId: string, query?: string): Promise<IPastPlay[]>;
  /** POST /challenges/pool_preview: the games a Pool resolves to, oldest release first. */
  poolPreview(pool: IPoolDefinition, page: number, per: number): Promise<IPage<IGameSummary>>;
  /** GET /challenges/pool_sources: franchises then collections whose name holds q. */
  poolSources(query: string): Promise<IPoolSource[]>;
}

type PageMeta = { page?: number; pages?: number; count?: number };

function toPage<T>(payload: { data: T[]; meta?: PageMeta }, page: number): IPage<T> {
  const items = payload.data ?? [];
  return {
    items,
    page: payload.meta?.page ?? page,
    pages: Math.max(1, payload.meta?.pages ?? 1),
    count: payload.meta?.count ?? items.length,
  };
}

/** Puts the query in the path, since the error reply shows the request's url only. */
function withQuery(path: string, query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return `${path}?${params.toString()}`;
}

const CHALLENGES_PATH = "/api/v1/challenges";
const RUNS_PATH = "/api/v1/challenge_runs";

export const CHALLENGE_API: IChallengeApi = {
  async listChallenges({ actingUserId, open, challengeFormat, page, per }) {
    const payload = await apiGetOrThrow<{ data: IChallenge[]; meta?: PageMeta }>(
      withQuery(CHALLENGES_PATH, {
        acting_user_id: actingUserId,
        open: open === undefined ? undefined : String(open),
        challenge_format: challengeFormat,
        page,
        per,
      }),
    );
    return toPage(payload, page);
  },
  async getChallenge(id, actingUserId) {
    const payload = await apiGet<{ data: IChallenge }>(
      withQuery(`${CHALLENGES_PATH}/${id}`, { acting_user_id: actingUserId }),
    );
    return payload?.data ?? null;
  },
  async createChallenge(write, actingUserId) {
    const payload = await apiPostOrThrow<{
      data: IChallenge;
      meta?: { warnings?: IChallengeWarning[] };
    }>(CHALLENGES_PATH, { data: { ...write, acting_user_id: actingUserId } });
    return { challenge: payload.data, warnings: payload.meta?.warnings ?? [] };
  },
  async updateChallenge(id, write, actingUserId) {
    const payload = await apiPatchOrThrow<{ data: IChallenge }>(
      `${CHALLENGES_PATH}/${id}`,
      { data: { ...write, acting_user_id: actingUserId } },
    );
    return payload.data;
  },
  async setHidden(id, hidden, actingUserId) {
    const payload = await apiPostOrThrow<{ data: IChallenge }>(
      `${CHALLENGES_PATH}/${id}/${hidden ? "hide" : "unhide"}`,
      { data: { acting_user_id: actingUserId } },
    );
    return payload.data;
  },
  async changeHost(id, hostUserId, actingUserId) {
    const target = hostUserId ? { host_user_id: hostUserId } : { hosted_by_club: true };
    const payload = await apiPutOrThrow<{ data: IChallenge }>(
      `${CHALLENGES_PATH}/${id}/host`,
      { data: { ...target, acting_user_id: actingUserId } },
    );
    return payload.data;
  },
  async listRuns(challengeId, actingUserId, page, per) {
    const payload = await apiGetOrThrow<{ data: IChallengeRun[]; meta?: PageMeta }>(
      withQuery(`${CHALLENGES_PATH}/${challengeId}/runs`, {
        acting_user_id: actingUserId,
        page,
        per,
      }),
    );
    return toPage(payload, page);
  },
  async listMemberRuns(userId, actingUserId, page, per) {
    const payload = await apiGetOrThrow<{ data: IChallengeRun[]; meta?: PageMeta }>(
      withQuery(`/api/v1/users/${encodeURIComponent(userId)}/challenge_runs`, {
        acting_user_id: actingUserId,
        page,
        per,
      }),
    );
    return toPage(payload, page);
  },
  async getRun(runId, actingUserId) {
    const payload = await apiGet<{ data: IChallengeRun }>(
      withQuery(`${RUNS_PATH}/${runId}`, { acting_user_id: actingUserId }),
    );
    return payload?.data ?? null;
  },
  async startRun(challengeId, actingUserId) {
    const payload = await apiPostOrThrow<{
      data: IChallengeRun;
      meta?: { notices?: IChallengeNotice[] };
    }>(`${CHALLENGES_PATH}/${challengeId}/runs`, { data: { acting_user_id: actingUserId } });
    return { ...payload.data, notices: payload.meta?.notices ?? [] };
  },
  async abandonRun(runId, actingUserId) {
    const payload = await apiPostOrThrow<{ data: IChallengeRun }>(
      `${RUNS_PATH}/${runId}/abandon`,
      { data: { acting_user_id: actingUserId } },
    );
    return payload.data;
  },
  async deleteRun(runId, actingUserId) {
    const payload = await apiDelete<{ data?: { deleted?: boolean } }>(
      withQuery(`${RUNS_PATH}/${runId}`, { acting_user_id: actingUserId }),
    );
    return payload !== null;
  },
  async slotMove(runId, gameId, slotYear, actingUserId) {
    const payload = await apiPostOrThrow<{ data: IChallengeRun }>(
      `${RUNS_PATH}/${runId}/slot_move`,
      { data: { game_id: gameId, slot_year: slotYear, acting_user_id: actingUserId } },
    );
    return payload.data;
  },
  async pastPick(runId, completionId, slotYear, actingUserId) {
    const payload = await apiPostOrThrow<{ data: IChallengeRun }>(
      `${RUNS_PATH}/${runId}/past_pick`,
      {
        data: { completion_id: completionId, slot_year: slotYear, acting_user_id: actingUserId },
      },
    );
    return payload.data;
  },
  async pastPlay(runId, actingUserId, query) {
    const payload = await apiGetOrThrow<{ data: IPastPlay[] }>(
      withQuery(`${RUNS_PATH}/${runId}/past_play`, {
        acting_user_id: actingUserId,
        q: query?.trim() || undefined,
      }),
    );
    return payload.data ?? [];
  },
  async poolPreview(pool, page, per) {
    const payload = await apiPostOrThrow<{ data: IGameSummary[]; meta?: PageMeta }>(
      withQuery(`${CHALLENGES_PATH}/pool_preview`, { page, per }),
      { data: pool },
    );
    return toPage(payload, page);
  },
  async poolSources(query) {
    const payload = await apiGetOrThrow<{ data: IPoolSource[] }>(
      withQuery(`${CHALLENGES_PATH}/pool_sources`, { q: query }),
    );
    return payload.data ?? [];
  },
};

/**
 * Every item of a Run list, read CHALLENGE_RUNS_PER_REQUEST at a time, stopping after
 * CHALLENGE_RUNS_MAX_REQUESTS pages so a long list can't stall a reply.
 */
export async function readRunPages<T>(
  read: (page: number, per: number) => Promise<IPage<T>>,
): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; page <= CHALLENGE_RUNS_MAX_REQUESTS; page += 1) {
    const result = await read(page, CHALLENGE_RUNS_PER_REQUEST);
    items.push(...result.items);
    if (page >= result.pages) break;
  }
  return items;
}

/** The Pool definition a stored Pool Challenge resolves from. */
export function poolDefinitionOf(pool: IChallengePool): IPoolDefinition {
  return {
    franchise_ids: (pool.franchises ?? []).map((f) => f.franchise_id),
    collection_ids: (pool.collections ?? []).map((c) => c.collection_id),
    included_game_ids: (pool.included_games ?? []).map((g) => g.game_id),
    excluded_game_ids: (pool.excluded_games ?? []).map((g) => g.game_id),
  };
}

/**
 * The reply for a failed Challenge call. A refusal (4xx) leads with the API's own
 * `message`, written for members, as given; anything else leads with `fallback` and pings
 * the devs. Both carry the full request and response (CLAUDE.md).
 */
export function challengeRefusalText(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status ?? 0;
    const message = (err.response?.data as { message?: unknown } | undefined)?.message;
    if (status >= 400 && status < 500 && typeof message === "string" && message.trim()) {
      return buildApiErrorMessage(message.trim(), err, { devPing: false });
    }
  }
  return buildApiErrorMessage(fallback, err);
}
