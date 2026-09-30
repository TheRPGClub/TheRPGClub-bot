import {
  NOMINATION_KINDS,
  nominationKindLabel,
  type INominationEntry,
  type NominationKind,
} from "../classes/Nomination.js";
import type {
  IVoteCastResult,
  IVoteEntry,
  IVoteTally,
  IVoteTallyRow,
} from "../classes/Vote.js";
import type { VotingEventKind } from "../classes/VotingEvents.js";
import type {
  IVotingRound,
  IVotingRoundTieGame,
  VotingPhase,
  VotingRoundCategory,
} from "../classes/VotingRounds.js";
import {
  dedupeNominationsByGame,
  mergeTallyWithNominations,
  pickWinningRows,
} from "../functions/VoteResultsUtils.js";
import { UserFacingError } from "../utilities/ApiErrorUtils.js";

// The voting sandbox's round, kept apart from the API so a test-mode bot can walk
// a whole GOTM / NR-GOTM round without touching production. Everything here is
// pure and JSON-safe: the state is persisted as-is so panels survive a restart.
// Where the API decides something (the vote cap, ties, the event outbox), this
// mirrors what the API is documented or observed to do.

const DAY_MS = 24 * 60 * 60 * 1000;
/** Voting runs over a weekend, so the sandbox's window is two days. */
const SANDBOX_VOTING_WINDOW_MS = 2 * DAY_MS;
const SANDBOX_NEXT_ROUND_DELAY_MS = 30 * DAY_MS;
export const SANDBOX_DEFAULT_CAP = 2;
export const SANDBOX_DEFAULT_ROUND = 999;
export const SANDBOX_DEFAULT_NOMINATIONS = 4;
/** One past Discord's 25-option select, so the panel's second select is reachable. */
export const SANDBOX_MAX_NOMINATIONS = 30;
/** Fixture game ids sit far above GameDB's, so no real game is ever implied. */
const FIXTURE_GAME_ID_BASE = 990_000;
const SIMULATED_VOTER_PREFIX = "sim-";

export type SandboxOutcome = "winner" | "tie" | "three-way-tie" | "no-votes";

export const SANDBOX_OUTCOMES: readonly SandboxOutcome[] = [
  "winner",
  "tie",
  "three-way-tie",
  "no-votes",
];

/** Simulated vote counts per outcome, highest first, one vote per simulated voter. */
const OUTCOME_COUNTS: Record<SandboxOutcome, number[]> = {
  "winner": [3, 2, 1],
  "tie": [2, 2, 1],
  "three-way-tie": [2, 2, 2],
  "no-votes": [],
};

/** How many games an outcome needs: the tied games plus one that trails them. */
const OUTCOME_MIN_NOMINATIONS: Record<SandboxOutcome, number> = {
  "winner": 1,
  "tie": 2,
  "three-way-tie": 3,
  "no-votes": 0,
};

export function isSandboxOutcome(value: string): value is SandboxOutcome {
  return (SANDBOX_OUTCOMES as readonly string[]).includes(value);
}

export interface ISandboxNomination {
  id: number;
  gameId: number;
  title: string;
  userId: string;
  reason: string | null;
  nominatedAt: string;
}

export interface ISandboxVote {
  id: number;
  kind: NominationKind;
  userId: string;
  nominationId: number;
  gameId: number;
  title: string;
  votedAt: string;
}

export interface ISandboxQueuedEvent {
  id: number;
  kind: VotingEventKind;
}

export interface IVotingSandboxState {
  /** Changes with every /vote-sandbox start, so older panels are refused. */
  id: string;
  ownerId: string;
  roundNumber: number;
  monthYear: string;
  cap: number;
  phase: VotingPhase;
  votingOpensAt: string;
  votingClosesAt: string;
  closedAt: string | null;
  decidedAt: string | null;
  nominations: Record<NominationKind, ISandboxNomination[]>;
  votes: ISandboxVote[];
  pendingTies: Partial<Record<VotingRoundCategory, IVotingRoundTieGame[]>>;
  winners: Partial<Record<VotingRoundCategory, number[]>>;
  /** Events the API would have queued, waiting for the sandbox to deliver them. */
  outbox: ISandboxQueuedEvent[];
  nextId: number;
}

export interface ISandboxNominationSeed {
  gameId: number;
  title: string;
  userId?: string;
  reason?: string | null;
}

export interface ICreateSandboxParams {
  id: string;
  ownerId: string;
  roundNumber?: number;
  cap?: number;
  now: Date;
  /** Per category; fixture games are made up when a category has no seeds. */
  seeds?: Partial<Record<NominationKind, ISandboxNominationSeed[]>>;
  nominationCounts?: Partial<Record<NominationKind, number>>;
}

export function toVotingRoundCategory(kind: NominationKind): VotingRoundCategory {
  return kind === "gotm" ? "gotm" : "nr_gotm";
}

function monthYearOf(date: Date): string {
  return date.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function fixtureSeeds(kind: NominationKind, count: number): ISandboxNominationSeed[] {
  const label = nominationKindLabel(kind);
  const offset = kind === "gotm" ? 0 : 500;
  return Array.from({ length: count }, (_, index) => ({
    gameId: FIXTURE_GAME_ID_BASE + offset + index + 1,
    title: `Sandbox ${label} Game ${index + 1}`,
    reason: `Fixture nomination ${index + 1}`,
  }));
}

function clampCount(value: number | undefined): number {
  const count = Math.trunc(value ?? SANDBOX_DEFAULT_NOMINATIONS);
  return Math.min(Math.max(count, 0), SANDBOX_MAX_NOMINATIONS);
}

/** A fresh round collecting nominations, with voting due to open in five days. */
export function createSandboxState(params: ICreateSandboxParams): IVotingSandboxState {
  const opensAt = new Date(params.now.getTime() + 5 * DAY_MS);
  let nextId = 1;
  const nominations = {} as Record<NominationKind, ISandboxNomination[]>;
  for (const kind of NOMINATION_KINDS) {
    const seeds = params.seeds?.[kind]?.length
      ? params.seeds[kind].slice(0, SANDBOX_MAX_NOMINATIONS)
      : fixtureSeeds(kind, clampCount(params.nominationCounts?.[kind]));
    nominations[kind] = seeds.map((seed) => ({
      id: nextId++,
      gameId: seed.gameId,
      title: seed.title,
      userId: seed.userId ?? params.ownerId,
      reason: seed.reason ?? null,
      nominatedAt: params.now.toISOString(),
    }));
  }
  return {
    id: params.id,
    ownerId: params.ownerId,
    roundNumber: params.roundNumber ?? SANDBOX_DEFAULT_ROUND,
    monthYear: monthYearOf(opensAt),
    cap: params.cap ?? SANDBOX_DEFAULT_CAP,
    phase: "nominating",
    votingOpensAt: opensAt.toISOString(),
    votingClosesAt: new Date(opensAt.getTime() + SANDBOX_VOTING_WINDOW_MS).toISOString(),
    closedAt: null,
    decidedAt: null,
    nominations,
    votes: [],
    pendingTies: {},
    winners: {},
    outbox: [],
    nextId,
  };
}

/** The round as the API would describe it, so the live handlers read it unchanged. */
export function toSandboxVotingRound(state: IVotingSandboxState): IVotingRound {
  return {
    roundNumber: state.roundNumber,
    monthYear: state.monthYear,
    votingOpensAt: new Date(state.votingOpensAt),
    votingClosesAt: new Date(state.votingClosesAt),
    closedAt: state.closedAt ? new Date(state.closedAt) : null,
    decidedAt: state.decidedAt ? new Date(state.decidedAt) : null,
    phase: state.phase,
    nominationsOpen: state.phase === "nominating",
    votingOpen: state.phase === "voting",
    votingEnded: state.phase !== "nominating" && state.phase !== "voting",
    pendingTies: state.pendingTies,
  };
}

/**
 * The round after a decided sandbox round, as the API schedules it: collecting
 * nominations, with its vote a month out. Null until the sandbox round is decided.
 */
export function toSandboxNextRound(state: IVotingSandboxState): IVotingRound | null {
  if (state.phase !== "decided" || !state.decidedAt) return null;
  const opensAt = new Date(new Date(state.decidedAt).getTime() + SANDBOX_NEXT_ROUND_DELAY_MS);
  return {
    roundNumber: state.roundNumber + 1,
    monthYear: monthYearOf(opensAt),
    votingOpensAt: opensAt,
    votingClosesAt: new Date(opensAt.getTime() + SANDBOX_VOTING_WINDOW_MS),
    closedAt: null,
    decidedAt: null,
    phase: "nominating",
    nominationsOpen: true,
    votingOpen: false,
    votingEnded: false,
    pendingTies: {},
  };
}

export function toNominationEntries(
  state: IVotingSandboxState,
  kind: NominationKind,
): INominationEntry[] {
  return state.nominations[kind].map((nomination) => ({
    id: nomination.id,
    roundNumber: state.roundNumber,
    userId: nomination.userId,
    gameTitle: nomination.title,
    gamedbGameId: nomination.gameId,
    nominatedAt: new Date(nomination.nominatedAt),
    reason: nomination.reason,
  }));
}

function toVoteEntry(state: IVotingSandboxState, vote: ISandboxVote): IVoteEntry {
  return {
    id: vote.id,
    roundNumber: state.roundNumber,
    userId: vote.userId,
    nominationId: vote.nominationId,
    gamedbGameId: vote.gameId,
    gameTitle: vote.title,
    votedAt: new Date(vote.votedAt),
  };
}

export function sandboxVotesForUser(
  state: IVotingSandboxState,
  kind: NominationKind,
  userId: string,
): IVoteEntry[] {
  return state.votes
    .filter((vote) => vote.kind === kind && vote.userId === userId)
    .map((vote) => toVoteEntry(state, vote));
}

/** The anonymous tally: one row per nomination that has votes, as the API groups it. */
export function sandboxTally(state: IVotingSandboxState, kind: NominationKind): IVoteTally {
  const rows = new Map<number, IVoteTallyRow>();
  for (const vote of state.votes) {
    if (vote.kind !== kind) continue;
    const row = rows.get(vote.nominationId) ?? {
      nominationId: vote.nominationId,
      gamedbGameId: vote.gameId,
      voteCount: 0,
    };
    row.voteCount += 1;
    rows.set(vote.nominationId, row);
  }
  return { rows: [...rows.values()], cap: state.cap };
}

/**
 * Casts or toggles a vote the way the API does: votes are per game, picking a
 * game already voted for takes that vote back, and a vote past the cap drops
 * the member's oldest vote with a warning. Null when the nomination is not in
 * the round (the API's 404).
 */
export function castSandboxVote(
  state: IVotingSandboxState,
  kind: NominationKind,
  userId: string,
  nominationId: number,
  now: Date,
): IVoteCastResult | null {
  const nomination = state.nominations[kind].find((entry) => entry.id === nominationId);
  if (!nomination) return null;

  const mine = state.votes.filter((vote) => vote.kind === kind && vote.userId === userId);
  const existing = mine.find((vote) => vote.gameId === nomination.gameId);
  if (existing) {
    state.votes = state.votes.filter((vote) => vote.id !== existing.id);
    return {
      action: "unvoted",
      vote: null,
      removedVotes: [toVoteEntry(state, existing)],
      cap: state.cap,
      warning: null,
    };
  }

  const removed: ISandboxVote[] = [];
  let warning: string | null = null;
  if (mine.length >= state.cap) {
    const oldest = [...mine].sort((a, b) => a.votedAt.localeCompare(b.votedAt) || a.id - b.id)[0];
    if (oldest) {
      removed.push(oldest);
      state.votes = state.votes.filter((vote) => vote.id !== oldest.id);
      warning =
        `You were at the vote cap (${state.cap}), so your oldest vote (${oldest.title}) ` +
        "was removed.";
    }
  }

  const vote: ISandboxVote = {
    id: state.nextId++,
    kind,
    userId,
    nominationId: nomination.id,
    gameId: nomination.gameId,
    title: nomination.title,
    votedAt: now.toISOString(),
  };
  state.votes.push(vote);
  return {
    action: "voted",
    vote: toVoteEntry(state, vote),
    removedVotes: removed.map((entry) => toVoteEntry(state, entry)),
    cap: state.cap,
    warning,
  };
}

export function isSimulatedVoter(userId: string): boolean {
  return userId.startsWith(SIMULATED_VOTER_PREFIX);
}

/**
 * Replaces a category's simulated votes with ones that produce `outcome` on
 * their own: one vote per simulated voter, spread over the category's games in
 * nomination order. Real members' votes are kept and count on top. Throws when
 * the category has too few votable games for the outcome.
 */
export function seedSandboxOutcome(
  state: IVotingSandboxState,
  kind: NominationKind,
  outcome: SandboxOutcome,
  now: Date,
): void {
  const games = dedupeNominationsByGame(toNominationEntries(state, kind));
  const needed = OUTCOME_MIN_NOMINATIONS[outcome];
  if (games.length < needed) {
    throw new UserFacingError(
      `${nominationKindLabel(kind)} has ${games.length} votable game(s); ` +
        `"${outcome}" needs at least ${needed}.`,
    );
  }
  state.votes = state.votes.filter(
    (vote) => vote.kind !== kind || !isSimulatedVoter(vote.userId),
  );
  let voter = 0;
  OUTCOME_COUNTS[outcome].slice(0, games.length).forEach((count, index) => {
    const game = games[index];
    if (!game) return;
    for (let i = 0; i < count; i += 1) {
      voter += 1;
      state.votes.push({
        id: state.nextId++,
        kind,
        userId: `${SIMULATED_VOTER_PREFIX}${kind}-${voter}`,
        nominationId: game.id,
        gameId: game.gamedbGameId,
        title: game.gameTitle,
        votedAt: now.toISOString(),
      });
    }
  });
}

function enqueue(state: IVotingSandboxState, kind: VotingEventKind): void {
  state.outbox.push({ id: state.nextId++, kind });
}

/** Queues any event by hand, whatever the phase, to exercise the handlers' skips. */
export function queueSandboxEvent(state: IVotingSandboxState, kind: VotingEventKind): void {
  enqueue(state, kind);
}

/**
 * Queues a nomination reminder and moves the vote so the reminder's countdown
 * reads the way the real one would (five days out, or one).
 */
export function remindSandboxNominations(
  state: IVotingSandboxState,
  which: "5d" | "1d",
  now: Date,
): void {
  if (state.phase === "nominating") {
    const opensAt = new Date(now.getTime() + (which === "5d" ? 5 : 1) * DAY_MS);
    state.votingOpensAt = opensAt.toISOString();
    state.votingClosesAt = new Date(opensAt.getTime() + SANDBOX_VOTING_WINDOW_MS).toISOString();
  }
  enqueue(state, which === "5d" ? "nomination_reminder_5d" : "nomination_reminder_1d");
}

export function openSandboxVoting(state: IVotingSandboxState, now: Date): void {
  if (state.phase !== "nominating") {
    throw new UserFacingError(
      `Sandbox Round ${state.roundNumber} is ${state.phase}; voting only opens from nominating.`,
    );
  }
  state.phase = "voting";
  state.votingOpensAt = now.toISOString();
  state.votingClosesAt = new Date(now.getTime() + SANDBOX_VOTING_WINDOW_MS).toISOString();
  enqueue(state, "voting_opened");
}

function decide(state: IVotingSandboxState, now: Date): void {
  state.phase = "decided";
  state.decidedAt = now.toISOString();
  enqueue(state, "round_decided");
}

/**
 * Closes voting and decides the round as the API does: a category's top game
 * wins, games sharing the top count leave a tie for the admins, and a category
 * with no votes has no winner. The results post is queued, then either the tie
 * prompt or the decision.
 */
export function closeSandboxVoting(state: IVotingSandboxState, now: Date): void {
  if (state.phase !== "voting") {
    throw new UserFacingError(
      `Sandbox Round ${state.roundNumber} is ${state.phase}; only open voting can close.`,
    );
  }
  state.closedAt = now.toISOString();
  state.votingClosesAt = now.toISOString();
  state.phase = "closed";
  enqueue(state, "voting_closed");

  for (const kind of NOMINATION_KINDS) {
    const category = toVotingRoundCategory(kind);
    const rows = mergeTallyWithNominations(
      sandboxTally(state, kind).rows,
      toNominationEntries(state, kind),
    );
    const top = pickWinningRows(rows);
    if (top.length === 1) {
      state.winners[category] = top.map((row) => row.gamedbGameId);
    } else if (top.length > 1) {
      state.pendingTies[category] = top.map((row) => ({
        gameId: row.gamedbGameId,
        title: row.gameTitle,
        coverUrl: null,
      }));
    }
  }

  if (Object.keys(state.pendingTies).length) {
    state.phase = "tie";
    enqueue(state, "tie_pending");
  } else {
    decide(state, now);
  }
}

/**
 * Breaks a category's tie. Refuses what the API refuses (422): a category with
 * no tie (`no_tie`) and a pick outside the tied games (`invalid_pick`).
 * Breaking the last tie decides the round.
 */
export function resolveSandboxTie(
  state: IVotingSandboxState,
  category: VotingRoundCategory,
  gameIds: number[],
  now: Date,
): void {
  const tied = state.phase === "tie" ? state.pendingTies[category] : undefined;
  if (!tied?.length) {
    throw new UserFacingError(
      `no_tie: sandbox Round ${state.roundNumber} has no ${category} tie.`,
    );
  }
  const allowed = new Set(tied.map((game) => game.gameId));
  if (!gameIds.length || gameIds.some((gameId) => !allowed.has(gameId))) {
    throw new UserFacingError(`invalid_pick: ${gameIds.join(", ")} is not among the tied games.`);
  }
  state.winners[category] = [...gameIds];
  delete state.pendingTies[category];
  if (!Object.keys(state.pendingTies).length) {
    decide(state, now);
  }
}

/** The winning titles per category, for the sandbox's round_decided report. */
export function sandboxWinnerTitles(
  state: IVotingSandboxState,
  kind: NominationKind,
): string[] {
  const gameIds = state.winners[toVotingRoundCategory(kind)] ?? [];
  return gameIds.map(
    (gameId) =>
      state.nominations[kind].find((nomination) => nomination.gameId === gameId)?.title ??
      `Game ${gameId}`,
  );
}

/** Reads persisted state back, or null when it is not a sandbox this version wrote. */
export function parseSandboxState(raw: unknown): IVotingSandboxState | null {
  if (!raw || typeof raw !== "object") return null;
  const state = raw as Partial<IVotingSandboxState>;
  const valid =
    typeof state.id === "string" &&
    typeof state.ownerId === "string" &&
    typeof state.roundNumber === "number" &&
    typeof state.phase === "string" &&
    Array.isArray(state.votes) &&
    Array.isArray(state.outbox) &&
    Boolean(state.nominations) &&
    NOMINATION_KINDS.every((kind) => Array.isArray(state.nominations?.[kind]));
  return valid ? (state as IVotingSandboxState) : null;
}
