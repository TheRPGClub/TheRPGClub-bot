import { apiPostOrThrow } from "../services/RpgClubApiClient.js";

export type RoundVotingEventKind =
  | "nomination_reminder_5d"
  | "nomination_reminder_1d"
  | "voting_opened"
  | "voting_closed"
  | "runoff_opened"
  | "runoff_closed"
  | "tie_pending"
  | "round_decided";

/** A GOTY Vote's posts (api#475): the event names its year, not a round. */
export type GotyVotingEventKind =
  | "goty_nominations_opened"
  | "goty_nomination_reminder_5d"
  | "goty_nomination_reminder_1d"
  | "goty_voting_opened"
  | "goty_runoff_opened"
  | "goty_runoff_closed"
  | "goty_tie_pending"
  | "goty_decided";

export type VotingEventKind = RoundVotingEventKind | GotyVotingEventKind;

const ROUND_VOTING_EVENT_KINDS: ReadonlySet<string> = new Set<RoundVotingEventKind>([
  "nomination_reminder_5d",
  "nomination_reminder_1d",
  "voting_opened",
  "voting_closed",
  "runoff_opened",
  "runoff_closed",
  "tie_pending",
  "round_decided",
]);

const GOTY_VOTING_EVENT_KINDS: ReadonlySet<string> = new Set<GotyVotingEventKind>([
  "goty_nominations_opened",
  "goty_nomination_reminder_5d",
  "goty_nomination_reminder_1d",
  "goty_voting_opened",
  "goty_runoff_opened",
  "goty_runoff_closed",
  "goty_tie_pending",
  "goty_decided",
]);

function isRoundVotingEventKind(kind: string): kind is RoundVotingEventKind {
  return ROUND_VOTING_EVENT_KINDS.has(kind);
}

function isGotyVotingEventKind(kind: string): kind is GotyVotingEventKind {
  return GOTY_VOTING_EVENT_KINDS.has(kind);
}

interface IVotingEventBase {
  id: number;
  rawKind: string;
  payload: Record<string, unknown>;
  availableAt: Date;
  expiresAt: Date | null;
  attempts: number;
}

/**
 * A GOTM / NR-GOTM round's post. `payload` carries ids only; handlers read the rest from
 * the regular endpoints.
 */
export interface IRoundVotingEvent extends IVotingEventBase {
  kind: RoundVotingEventKind;
  roundNumber: number;
  gotyYear: null;
}

/** A GOTY Vote's post. `payload` is self-contained (IGotyEventPayload). */
export interface IGotyVotingEvent extends IVotingEventBase {
  kind: GotyVotingEventKind;
  roundNumber: null;
  gotyYear: number;
}

/** A kind this bot predates (or one without the round or year it needs). */
export interface IUnknownVotingEvent extends IVotingEventBase {
  kind: "unknown";
  roundNumber: number | null;
  gotyYear: number | null;
}

/**
 * A Discord post the API's voting lifecycle calls for, claimed from its outbox: a round's
 * (round_number set) or a GOTY Vote's (goty_year set). The claim is a lease: ack after
 * posting, or the event is handed out again once the lease runs out.
 */
export type IVotingEvent = IRoundVotingEvent | IGotyVotingEvent | IUnknownVotingEvent;

type VotingEventApiData = {
  id: number;
  round_number?: number | null;
  goty_year?: number | null;
  kind: string;
  payload: Record<string, unknown> | null;
  available_at: string;
  expires_at: string | null;
  attempts: number;
};

function optionalNumber(value: number | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}

export function mapVotingEventApiData(d: VotingEventApiData): IVotingEvent {
  const base: IVotingEventBase = {
    id: Number(d.id),
    rawKind: d.kind,
    payload: d.payload ?? {},
    availableAt: new Date(d.available_at),
    expiresAt: d.expires_at ? new Date(d.expires_at) : null,
    attempts: Number(d.attempts),
  };
  const roundNumber = optionalNumber(d.round_number);
  const gotyYear = optionalNumber(d.goty_year);
  if (isRoundVotingEventKind(d.kind) && roundNumber !== null) {
    return { ...base, kind: d.kind, roundNumber, gotyYear: null };
  }
  if (isGotyVotingEventKind(d.kind) && gotyYear !== null) {
    return { ...base, kind: d.kind, roundNumber: null, gotyYear };
  }
  return { ...base, kind: "unknown", roundNumber, gotyYear };
}

export function isGotyVotingEvent(event: IVotingEvent): event is IGotyVotingEvent {
  return event.kind !== "unknown" && event.gotyYear !== null;
}

/**
 * What an event belongs to, for logs and for holding back its later events after a
 * failure: "Round 143", "GOTY Vote 2026", or the event itself when it names neither.
 */
export function votingEventScope(event: IVotingEvent): string {
  if (event.roundNumber !== null) return `Round ${event.roundNumber}`;
  if (event.gotyYear !== null) return `GOTY Vote ${event.gotyYear}`;
  return `event ${event.id}`;
}

/** One claim from the outbox. */
export interface IVotingEventClaim {
  events: IVotingEvent[];
  /**
   * When the API expects the next event (or a lapsed lease) to be claimable, so the
   * bot can sleep until then. null when nothing is scheduled; undefined from an API that
   * predates the field, or when the value cannot be read.
   */
  nextPollAt?: Date | null;
}

type VotingEventClaimResponse = {
  data: VotingEventApiData[];
  meta?: { next_poll_at?: string | null };
};

export function mapVotingEventClaimResponse(
  response: VotingEventClaimResponse | null | undefined,
): IVotingEventClaim {
  const events = (response?.data ?? []).map(mapVotingEventApiData);
  const meta = response?.meta;
  if (!meta || typeof meta !== "object" || !("next_poll_at" in meta)) {
    return { events };
  }
  if (!meta.next_poll_at) {
    return { events, nextPollAt: null };
  }
  // A value this bot cannot read gets the same fallback as an API that sends none.
  const nextPollAt = new Date(meta.next_poll_at);
  return Number.isNaN(nextPollAt.getTime()) ? { events } : { events, nextPollAt };
}

export default class VotingEvents {
  /** Leases up to `limit` due events, oldest first. */
  static async claim(limit: number): Promise<IVotingEventClaim> {
    // apiPost would read a 404 (a route missing mid-deploy) as an empty outbox and sleep
    // the poller until its cap; throwing retries after the lease instead.
    const response = await apiPostOrThrow<VotingEventClaimResponse>(
      "/api/v1/voting_events/claim",
      undefined,
      { params: { limit } },
    );
    return mapVotingEventClaimResponse(response);
  }

  /**
   * Marks an event delivered. Idempotent on the API side. Throws on a 404 too: an ack the
   * API never recorded hands the event back once its lease runs out.
   */
  static async ack(id: number): Promise<void> {
    await apiPostOrThrow(`/api/v1/voting_events/${id}/ack`);
  }
}
