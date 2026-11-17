import axios from "axios";
import { buildApiErrorMessage } from "../utilities/ApiErrorUtils.js";
import {
  apiGet,
  apiGetOrThrow,
  apiPatchOrThrow,
  apiPostOrThrow,
  apiPutOrThrow,
} from "./RpgClubApiClient.js";

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
}

export interface IChallengeRun {
  id: number;
  user: IChallengeMember;
  status: RunStatus;
  started_at: string;
  progress: { in_progress: number; cleared: number; target: number; caught_up?: boolean };
  entries?: IChallengeRunEntry[];
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

export const CHALLENGE_API: IChallengeApi = {
  async listChallenges({ actingUserId, open, page, per }) {
    const payload = await apiGetOrThrow<{ data: IChallenge[]; meta?: PageMeta }>(
      withQuery(CHALLENGES_PATH, {
        acting_user_id: actingUserId,
        open: open === undefined ? undefined : String(open),
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
