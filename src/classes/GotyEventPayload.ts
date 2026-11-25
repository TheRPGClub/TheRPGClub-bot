import {
  GOTY_AWARD_LABELS,
  parseGotyAward,
  type GotyAwardKey,
  type GotyDecidedBy,
} from "../services/GotyVoteApi.js";

// The payload of a GOTY Vote outbox event (api#475, Goty::EventPayload). Every goty_* kind
// carries the same self-contained shape, snapshotted when the API queued it, so the bot
// posts without another call. Counts are anonymous; voters are never in a payload.

export interface IGotyEventGame {
  gameId: number;
  title: string;
  coverUrl: string | null;
  /** Null until the main vote closed. */
  votes: number | null;
  /** Null until the runoff closed or the vote is decided (0 for an Award with no runoff). */
  runoffVotes: number | null;
}

export interface IGotyEventWinner {
  gameId: number;
  title: string;
  coverUrl: string | null;
  decidedBy: GotyDecidedBy;
}

export interface IGotyEventAward {
  award: GotyAwardKey;
  name: string;
  /** The main ballot's cap: half the ballot, at least 1. */
  cap: number;
  /** Exactly one game: it wins without a vote. */
  uncontested: boolean;
  /** Games sent to the runoff (ids); empty when there was none. */
  runoffBallot: number[];
  /** Tied games waiting for an admin (ids); empty when none. */
  pendingTie: number[];
  /** The ballot. Empty means the Award is not given that year. */
  games: IGotyEventGame[];
  winner: IGotyEventWinner | null;
}

export interface IGotyEventPayload {
  year: number;
  /** "GOTY Vote 2026": every post leads with it. */
  name: string;
  nominationsOpenAt: Date | null;
  votingOpensAt: Date | null;
  votingClosesAt: Date | null;
  runoffOpensAt: Date | null;
  runoffClosesAt: Date | null;
  decidedAt: Date | null;
  nominationCap: number;
  /** 5 or 1 on the reminders, else null. */
  daysBefore: number | null;
  /** In the API's order: GOTM, NR-GOTM, Game of the Year. */
  awards: IGotyEventAward[];
}

const DECIDED_BY: ReadonlySet<string> = new Set<GotyDecidedBy>([
  "vote",
  "runoff",
  "admin",
  "uncontested",
]);

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toIds(value: unknown): number[] {
  return Array.isArray(value)
    ? value.map(Number).filter((id) => Number.isInteger(id) && id > 0)
    : [];
}

function parseGame(raw: unknown): IGotyEventGame | null {
  if (!isRecord(raw)) return null;
  const gameId = Number(raw.gamedb_game_id);
  if (!Number.isInteger(gameId) || gameId <= 0) return null;
  return {
    gameId,
    title: typeof raw.title === "string" && raw.title ? raw.title : `Game ${gameId}`,
    coverUrl: typeof raw.cover_url === "string" && raw.cover_url ? raw.cover_url : null,
    votes: toCount(raw.votes),
    runoffVotes: toCount(raw.runoff_votes),
  };
}

function parseWinner(raw: unknown): IGotyEventWinner | null {
  const game = parseGame(raw);
  if (!game || !isRecord(raw)) return null;
  const decidedBy = String(raw.decided_by);
  return {
    gameId: game.gameId,
    title: game.title,
    coverUrl: game.coverUrl,
    decidedBy: DECIDED_BY.has(decidedBy) ? (decidedBy as GotyDecidedBy) : "vote",
  };
}

function parseAward(raw: unknown): IGotyEventAward | null {
  if (!isRecord(raw)) return null;
  const award = parseGotyAward(String(raw.award));
  if (!award) return null;
  const games = Array.isArray(raw.games)
    ? raw.games.map(parseGame).filter((game): game is IGotyEventGame => game !== null)
    : [];
  const cap = Number(raw.cap);
  return {
    award,
    name: typeof raw.name === "string" && raw.name ? raw.name : GOTY_AWARD_LABELS[award],
    cap: Number.isInteger(cap) && cap > 0 ? cap : 1,
    uncontested: raw.uncontested === true,
    runoffBallot: toIds(raw.runoff_ballot),
    pendingTie: toIds(raw.pending_tie),
    games,
    winner: parseWinner(raw.winner),
  };
}

/**
 * Reads a goty_* event's payload, or null when it lacks the year or the Awards (a payload
 * this bot cannot post from). `fallbackYear` is the event's goty_year.
 */
export function parseGotyEventPayload(
  payload: Record<string, unknown>,
  fallbackYear: number,
): IGotyEventPayload | null {
  if (!Array.isArray(payload.awards)) return null;
  const year = Number(payload.year ?? fallbackYear);
  if (!Number.isInteger(year)) return null;
  const awards = payload.awards
    .map(parseAward)
    .filter((award): award is IGotyEventAward => award !== null);
  const nominationCap = Number(payload.nomination_cap);
  const daysBefore = toCount(payload.days_before);
  return {
    year,
    name: typeof payload.name === "string" && payload.name ? payload.name : `GOTY Vote ${year}`,
    nominationsOpenAt: toDate(payload.nominations_open_at),
    votingOpensAt: toDate(payload.voting_opens_at),
    votingClosesAt: toDate(payload.voting_closes_at),
    runoffOpensAt: toDate(payload.runoff_opens_at),
    runoffClosesAt: toDate(payload.runoff_closes_at),
    decidedAt: toDate(payload.decided_at),
    nominationCap: Number.isInteger(nominationCap) && nominationCap > 0 ? nominationCap : 3,
    daysBefore,
    awards,
  };
}
