import { apiPostOrThrow } from "../services/RpgClubApiClient.js";

/**
 * A unit of Discord work the website asked for, claimed from the API's bot job queue.
 * The claim is a 5 minute lease: ack done or failed, or the API hands the job out again
 * (and fails it after 3 claims). `kind` is kept as sent, so a kind this bot predates
 * reaches the dispatcher and fails clearly.
 */
export interface IBotJob {
  id: number;
  kind: string;
  /** Per kind: ids plus whatever the bot cannot fetch itself. */
  payload: Record<string, unknown>;
  attempts: number;
  requestedByUserId: string | null;
}

/** The queue endpoints the consumer calls; tests pass a fake. */
export interface IBotJobApi {
  claim(limit: number): Promise<IBotJob[]>;
  done(id: number): Promise<void>;
  failed(id: number, errorMessage: string): Promise<void>;
}

type BotJobClaimApiData = {
  id: number;
  kind: string;
  payload: Record<string, unknown> | null;
  attempts: number;
  requested_by_user_id: string | null;
};

export function mapBotJobClaim(d: BotJobClaimApiData): IBotJob {
  return {
    id: Number(d.id),
    kind: String(d.kind),
    payload: d.payload && typeof d.payload === "object" ? d.payload : {},
    attempts: Number(d.attempts),
    requestedByUserId: d.requested_by_user_id ?? null,
  };
}

/**
 * The live API. Every call throws on any non-2xx (404 included), so a route missing
 * mid-deploy backs the poller off instead of reading as an empty queue.
 */
export const BOT_JOB_API: IBotJobApi = {
  async claim(limit: number): Promise<IBotJob[]> {
    const response = await apiPostOrThrow<{ data?: BotJobClaimApiData[] }>(
      "/api/v1/bot_jobs/claim",
      undefined,
      { params: { limit } },
    );
    return (response?.data ?? []).map(mapBotJobClaim);
  },
  async done(id: number): Promise<void> {
    await apiPostOrThrow(`/api/v1/bot_jobs/${id}/done`);
  },
  async failed(id: number, errorMessage: string): Promise<void> {
    await apiPostOrThrow(`/api/v1/bot_jobs/${id}/failed`, {
      data: { error_message: errorMessage },
    });
  },
};
