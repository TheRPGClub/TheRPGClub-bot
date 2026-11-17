import { apiDelete, apiGet, apiPostOrThrow, apiPutOrThrow } from "./RpgClubApiClient.js";
import type { IChallengeMember } from "./ChallengeApi.js";

// The Edition endpoints the bot calls for Secret Santa sign-up (spec api#376, tickets
// api#383, api#384 and the final pass). An Edition is one yearly cycle of an Assignment
// Challenge, named by its reveal's year. Shapes are the API's own (snake_case).

export type EditionPhase = "signup" | "picking" | "revealed" | "ended" | "cancelled";

/** An Edition's year, phase and dates (club dates, YYYY-MM-DD), as Challenges serve it. */
export interface IChallengeEditionSummary {
  id: number;
  year: number;
  phase: EditionPhase;
  signup_opens_on: string;
  /** Sign-up is open until the start of this day; the draw happens on it. */
  signup_cutoff_on: string;
  /** Santas pick until the start of this day. */
  pick_deadline_on: string;
  reveal_on: string;
  /** The next reveal: the year to Clear the game ends. */
  ends_on: string;
}

export interface IChallengeEditionMember extends IChallengeMember {
  left_out: boolean;
  withdrawn: boolean;
}

/** An Edition as GET /challenge_editions/:id and the Edition job payloads serve it. */
export interface IChallengeEdition extends IChallengeEditionSummary {
  challenge: { id: number; name: string };
  /** Members may sign up and withdraw today. */
  signup_open: boolean;
  signed_up_count: number;
  /** The acting member is signed up (false in job payloads). */
  signed_up: boolean;
  members?: IChallengeEditionMember[];
  drawn_at?: string | null;
}

/** Where the Edition's sign-up opening post is, so later posts can reply to it. */
export interface ISignupPost {
  channel_id: string;
  message_id: string;
}

export interface IChallengeEditionApi {
  /** GET /challenge_editions/:id; null when it is gone or hidden from the acting member. */
  getEdition(editionId: number, actingUserId: string): Promise<IChallengeEdition | null>;
  /**
   * POST /challenge_editions/:id/signup for the acting member. Throws the AxiosError on a
   * refusal (409 signup_closed, already_signed_up; 422 backlog_too_small).
   */
  signUp(editionId: number, actingUserId: string): Promise<IChallengeEdition>;
  /**
   * DELETE /challenge_editions/:id/signup for the acting member: off the Edition before
   * the cutoff, withdrawn after the draw until the pick deadline. Null when the Edition is
   * gone. Throws the AxiosError on a refusal (409 signup_closed, picks_closed, not_drawn,
   * not_signed_up).
   */
  withdraw(editionId: number, actingUserId: string): Promise<IChallengeEdition | null>;
  /** PUT /challenge_editions/:id/signup_post (service token only). */
  storeSignupPost(editionId: number, post: ISignupPost): Promise<void>;
}

const EDITIONS_PATH = "/api/v1/challenge_editions";

function actingQuery(actingUserId: string): string {
  return `acting_user_id=${encodeURIComponent(actingUserId)}`;
}

export const CHALLENGE_EDITION_API: IChallengeEditionApi = {
  async getEdition(editionId, actingUserId) {
    const payload = await apiGet<{ data: IChallengeEdition }>(
      `${EDITIONS_PATH}/${editionId}?${actingQuery(actingUserId)}`,
    );
    return payload?.data ?? null;
  },
  async signUp(editionId, actingUserId) {
    const payload = await apiPostOrThrow<{ data: IChallengeEdition }>(
      `${EDITIONS_PATH}/${editionId}/signup`,
      { data: { acting_user_id: actingUserId } },
    );
    return payload.data;
  },
  async withdraw(editionId, actingUserId) {
    const payload = await apiDelete<{ data: IChallengeEdition }>(
      `${EDITIONS_PATH}/${editionId}/signup?${actingQuery(actingUserId)}`,
    );
    return payload?.data ?? null;
  },
  async storeSignupPost(editionId, post) {
    await apiPutOrThrow(`${EDITIONS_PATH}/${editionId}/signup_post`, { data: post });
  },
};
