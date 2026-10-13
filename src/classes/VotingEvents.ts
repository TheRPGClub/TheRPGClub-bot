import { apiPost } from "../services/RpgClubApiClient.js";

export type VotingEventKind =
  | "nomination_reminder_5d"
  | "nomination_reminder_1d"
  | "voting_opened"
  | "voting_closed"
  | "runoff_opened"
  | "runoff_closed"
  | "tie_pending"
  | "round_decided";

const VOTING_EVENT_KINDS: ReadonlySet<string> = new Set<VotingEventKind>([
  "nomination_reminder_5d",
  "nomination_reminder_1d",
  "voting_opened",
  "voting_closed",
  "runoff_opened",
  "runoff_closed",
  "tie_pending",
  "round_decided",
]);

function isVotingEventKind(kind: string): kind is VotingEventKind {
  return VOTING_EVENT_KINDS.has(kind);
}

/**
 * A Discord post the API's round lifecycle calls for, claimed from its outbox.
 * The claim is a lease: ack after posting, or the event is handed out again
 * once the lease runs out. `payload` carries ids only; handlers read the rest
 * from the regular endpoints.
 */
export interface IVotingEvent {
  id: number;
  roundNumber: number;
  /** "unknown" for a kind this bot predates; `rawKind` keeps what the API sent. */
  kind: VotingEventKind | "unknown";
  rawKind: string;
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
    kind: isVotingEventKind(d.kind) ? d.kind : "unknown",
    rawKind: d.kind,
    payload: d.payload ?? {},
    availableAt: new Date(d.available_at),
    expiresAt: d.expires_at ? new Date(d.expires_at) : null,
    attempts: Number(d.attempts),
  };
}

/** One claim from the outbox. */
export interface IVotingEventClaim {
  events: IVotingEvent[];
  /**
   * When the API expects the next event (or a lapsed lease) to be claimable, so the
   * bot can sleep until then. null when nothing is scheduled.
   */
  nextPollAt: Date | null;
}

type VotingEventClaimResponse = {
  data: VotingEventApiData[];
  meta?: { next_poll_at?: string | null };
};

export function mapVotingEventClaimResponse(
  response: VotingEventClaimResponse | null | undefined,
): IVotingEventClaim {
  const nextPollAt = response?.meta?.next_poll_at ? new Date(response.meta.next_poll_at) : null;
  return {
    events: (response?.data ?? []).map(mapVotingEventApiData),
    nextPollAt: nextPollAt && !Number.isNaN(nextPollAt.getTime()) ? nextPollAt : null,
  };
}

export default class VotingEvents {
  /** Leases up to `limit` due events, oldest first. */
  static async claim(limit: number): Promise<IVotingEventClaim> {
    const response = await apiPost<VotingEventClaimResponse>(
      "/api/v1/voting_events/claim",
      undefined,
      { params: { limit } },
    );
    return mapVotingEventClaimResponse(response);
  }

  /** Marks an event delivered. Idempotent on the API side. */
  static async ack(id: number): Promise<void> {
    await apiPost(`/api/v1/voting_events/${id}/ack`);
  }
}
