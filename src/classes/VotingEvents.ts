import { apiPost } from "../services/RpgClubApiClient.js";

export type VotingEventKind =
  | "nomination_reminder_5d"
  | "nomination_reminder_1d"
  | "voting_opened"
  | "voting_closed"
  | "tie_pending"
  | "round_decided";

/**
 * A Discord post the API's round lifecycle calls for, claimed from its outbox.
 * The claim is a lease: ack after posting, or the event is handed out again
 * once the lease runs out. `payload` carries ids only; handlers read the rest
 * from the regular endpoints.
 */
export interface IVotingEvent {
  id: number;
  roundNumber: number;
  kind: VotingEventKind | string;
  payload: Record<string, unknown>;
  availableAt: Date;
  expiresAt: Date | null;
  attempts: number;
}

type VotingEventApiData = {
  id: number;
  round_number: number;
  kind: string;
  payload: Record<string, unknown> | null;
  available_at: string;
  expires_at: string | null;
  attempts: number;
};

export function mapVotingEventApiData(d: VotingEventApiData): IVotingEvent {
  return {
    id: Number(d.id),
    roundNumber: Number(d.round_number),
    kind: d.kind,
    payload: d.payload ?? {},
    availableAt: new Date(d.available_at),
    expiresAt: d.expires_at ? new Date(d.expires_at) : null,
    attempts: Number(d.attempts),
  };
}

export default class VotingEvents {
  /** Leases up to `limit` due events, oldest first. */
  static async claim(limit: number): Promise<IVotingEvent[]> {
    const response = await apiPost<{ data: VotingEventApiData[] }>(
      "/api/v1/voting_events/claim",
      undefined,
      { params: { limit } },
    );
    return (response?.data ?? []).map(mapVotingEventApiData);
  }

  /** Marks an event delivered. Idempotent on the API side. */
  static async ack(id: number): Promise<void> {
    await apiPost(`/api/v1/voting_events/${id}/ack`);
  }
}
