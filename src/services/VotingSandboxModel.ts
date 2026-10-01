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
  VoteBallot,
} from "../classes/Vote.js";
import type { VotingEventKind } from "../classes/VotingEvents.js";
import {
  toVotingRoundCategory,
  type IVotingRound,
  type VotingPhase,
  type VotingRoundCategory,
  type VotingRoundTies,
} from "../classes/VotingRounds.js";
import {
  dedupeNominationsByGame,
  filterRunoffNominations,
  mergeTallyWithNominations,
  pickWinningRows,
  type ITallyDisplayRow,
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
/** The API's default runoff window (VOTING_RUNOFF_HOURS). */
const SANDBOX_RUNOFF_WINDOW_MS = DAY_MS;
/** A runoff member votes for one game, whatever the main vote's cap. */
export const RUNOFF_CAP = 1;
const SANDBOX_NEXT_ROUND_DELAY_MS = 30 * DAY_MS;
export const SANDBOX_DEFAULT_CAP = 2;
export const SANDBOX_DEFAULT_ROUND = 999;
export const SANDBOX_DEFAULT_NOMINATIONS = 4;
/** One past Discord's 25-option select, so the panel's second select is reachable. */
export const SANDBOX_MAX_NOMINATIONS = 30;
const SIMULATED_VOTER_PREFIX = "sim-";

export type SandboxOutcome = "winner" | "two-way-tie" | "three-way-tie" | "no-votes";

export const SANDBOX_OUTCOMES: readonly SandboxOutcome[] = [
  "winner",
  "two-way-tie",
  "three-way-tie",
  "no-votes",
];

/** Simulated vote counts per outcome, highest first, one vote per simulated voter. */
const OUTCOME_COUNTS: Record<SandboxOutcome, number[]> = {
  "winner": [3, 2, 1],
  "two-way-tie": [2, 2, 1],
  "three-way-tie": [2, 2, 2],
  "no-votes": [],
};

/** How many games an outcome needs: the tied games plus one that trails them. */
const OUTCOME_MIN_NOMINATIONS: Record<SandboxOutcome, number> = {
  "winner": 1,
  "two-way-tie": 2,
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
  /** True for a vote on the tie-breaker runoff; absent on states saved before runoffs. */
  runoff?: boolean;
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
  runoffOpensAt: string | null;
  runoffClosesAt: string | null;
  runoffClosedAt: string | null;
  nominations: Record<NominationKind, ISandboxNomination[]>;
  votes: ISandboxVote[];
  /** As the API keeps them: the runoff's ballot while it is open, then what is left tied. */
  pendingTies: VotingRoundTies;
  /** The runoff's ballot as it opened. */
  runoffTies: VotingRoundTies;
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
  /** Real GameDB games per category that fill a category with no seeds. */
  pools: Record<NominationKind, ISandboxNominationSeed[]>;
  /** Per category, copied from a real round; a category with none draws on the pools. */
  seeds?: Partial<Record<NominationKind, ISandboxNominationSeed[]>>;
  nominationCounts?: Partial<Record<NominationKind, number>>;
}

function monthYearOf(date: Date): string {
  return date.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function clampCount(value: number | undefined): number {
  const count = Math.trunc(value ?? SANDBOX_DEFAULT_NOMINATIONS);
  return Math.min(Math.max(count, 0), SANDBOX_MAX_NOMINATIONS);
}

export interface ISandboxWinnerRound {
  round: number;
  gameOfTheMonth: { gamedbGameId: number; title: string }[];
}

/**
 * A category's past winners as sandbox seeds, earliest round first and each
 * game once. Winners are real GameDB games with covers, and history does not
 * change, so every sandbox start nominates the same titles.
 */
export function sandboxPoolFromWinners(
  kind: NominationKind,
  rounds: readonly ISandboxWinnerRound[],
): ISandboxNominationSeed[] {
  const label = nominationKindLabel(kind);
  const seen = new Set<number>();
  const pool: ISandboxNominationSeed[] = [];
  for (const entry of [...rounds].sort((a, b) => a.round - b.round)) {
    for (const game of entry.gameOfTheMonth) {
      if (!(game.gamedbGameId > 0) || seen.has(game.gamedbGameId)) continue;
      seen.add(game.gamedbGameId);
      pool.push({
        gameId: game.gamedbGameId,
        title: game.title,
        reason: `${label} Round ${entry.round} winner`,
      });
    }
  }
  return pool;
}

/**
 * Each category's seeds: the copied ones when it has any, otherwise the first
 * games from its own pool, then from the other pools. A game nominated in one
 * category is never reused in another, and pool order is kept, so the same
 * pools always give the same nominations.
 */
export function fillSandboxSeeds(
  pools: Record<NominationKind, ISandboxNominationSeed[]>,
  seeds: Partial<Record<NominationKind, ISandboxNominationSeed[]>> = {},
  counts: Partial<Record<NominationKind, number>> = {},
): Record<NominationKind, ISandboxNominationSeed[]> {
  const filled = {} as Record<NominationKind, ISandboxNominationSeed[]>;
  const used = new Set<number>();
  for (const kind of NOMINATION_KINDS) {
    const copied = seeds[kind]?.slice(0, SANDBOX_MAX_NOMINATIONS) ?? [];
    if (copied.length) filled[kind] = copied;
    for (const seed of copied) used.add(seed.gameId);
  }
  for (const kind of NOMINATION_KINDS) {
    if (filled[kind]) continue;
    const order = [kind, ...NOMINATION_KINDS.filter((other) => other !== kind)];
    const picked: ISandboxNominationSeed[] = [];
    const wanted = clampCount(counts[kind]);
    for (const seed of order.flatMap((source) => pools[source])) {
      if (picked.length >= wanted) break;
      if (used.has(seed.gameId)) continue;
      used.add(seed.gameId);
      picked.push(seed);
    }
    filled[kind] = picked;
  }
  return filled;
}

/** A fresh round collecting nominations, with voting due to open in five days. */
export function createSandboxState(params: ICreateSandboxParams): IVotingSandboxState {
  const opensAt = new Date(params.now.getTime() + 5 * DAY_MS);
  let nextId = 1;
  const nominations = {} as Record<NominationKind, ISandboxNomination[]>;
  const seeds = fillSandboxSeeds(params.pools, params.seeds, params.nominationCounts);
  for (const kind of NOMINATION_KINDS) {
    nominations[kind] = seeds[kind].map((seed) => ({
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
    runoffOpensAt: null,
    runoffClosesAt: null,
    runoffClosedAt: null,
    nominations,
    votes: [],
    pendingTies: {},
    runoffTies: {},
    winners: {},
    outbox: [],
    nextId,
  };
}

function toDateOrNull(value: string | null): Date | null {
  return value ? new Date(value) : null;
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
    runoffOpensAt: toDateOrNull(state.runoffOpensAt),
    runoffClosesAt: toDateOrNull(state.runoffClosesAt),
    runoffClosedAt: toDateOrNull(state.runoffClosedAt),
    runoffOpen: state.phase === "runoff",
    runoffEnded: state.runoffClosedAt !== null,
    pendingTies: state.pendingTies,
    runoffTies: state.runoffTies,
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
    runoffOpensAt: null,
    runoffClosesAt: null,
    runoffClosedAt: null,
    runoffOpen: false,
    runoffEnded: false,
    pendingTies: {},
    runoffTies: {},
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

function voteBallot(vote: ISandboxVote): VoteBallot {
  return vote.runoff ? "runoff" : "main";
}

/** One category's votes on one ballot. */
function ballotVotes(
  state: IVotingSandboxState,
  kind: NominationKind,
  ballot: VoteBallot,
): ISandboxVote[] {
  return state.votes.filter((vote) => vote.kind === kind && voteBallot(vote) === ballot);
}

export function sandboxVotesForUser(
  state: IVotingSandboxState,
  kind: NominationKind,
  userId: string,
  ballot: VoteBallot = "main",
): IVoteEntry[] {
  return ballotVotes(state, kind, ballot)
    .filter((vote) => vote.userId === userId)
    .map((vote) => toVoteEntry(state, vote));
}

/** The anonymous tally: one row per nomination that has votes, as the API groups it. */
export function sandboxTally(
  state: IVotingSandboxState,
  kind: NominationKind,
  ballot: VoteBallot = "main",
): IVoteTally {
  const rows = new Map<number, IVoteTallyRow>();
  for (const vote of ballotVotes(state, kind, ballot)) {
    const row = rows.get(vote.nominationId) ?? {
      nominationId: vote.nominationId,
      gamedbGameId: vote.gameId,
      voteCount: 0,
    };
    row.voteCount += 1;
    rows.set(vote.nominationId, row);
  }
  return { rows: [...rows.values()], cap: ballot === "runoff" ? RUNOFF_CAP : state.cap };
}

/** The tied games still on a category's runoff ballot; empty when it has no runoff. */
function runoffGames(state: IVotingSandboxState, kind: NominationKind): INominationEntry[] {
  const tied = state.pendingTies[toVotingRoundCategory(kind)] ?? [];
  return tied.length ? filterRunoffNominations(toNominationEntries(state, kind), tied) : [];
}

/** A category's runoff tally merged over its tied games, most votes first. */
function runoffRows(state: IVotingSandboxState, kind: NominationKind): ITallyDisplayRow[] {
  const tied = state.runoffTies[toVotingRoundCategory(kind)] ?? [];
  return mergeTallyWithNominations(
    sandboxTally(state, kind, "runoff").rows,
    filterRunoffNominations(toNominationEntries(state, kind), tied),
  );
}

/**
 * Refuses a runoff cast the way the API does (422): `voting_closed` for a
 * category with no runoff, `not_in_runoff` for a game that did not tie.
 */
function refuseRunoffCast(
  state: IVotingSandboxState,
  kind: NominationKind,
  gameId: number,
): void {
  const games = runoffGames(state, kind);
  if (!games.length) {
    throw new UserFacingError(
      `voting_closed: sandbox Round ${state.roundNumber} has no ` +
        `${nominationKindLabel(kind)} runoff.`,
    );
  }
  if (!games.some((game) => game.gamedbGameId === gameId)) {
    throw new UserFacingError("not_in_runoff: that game did not tie, so it is not in the runoff.");
  }
}

/**
 * Casts or toggles a vote the way the API does: votes are per game, picking a
 * game already voted for takes that vote back, and a vote past the cap drops
 * the member's oldest vote with a warning. While the runoff is open the cast
 * goes to the runoff ballot, with a cap of one, and only for a tied game. Null
 * when the nomination is not in the round (the API's 404).
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

  const ballot: VoteBallot = state.phase === "runoff" ? "runoff" : "main";
  if (ballot === "runoff") refuseRunoffCast(state, kind, nomination.gameId);
  const runoff = ballot === "runoff";
  const cap = runoff ? RUNOFF_CAP : state.cap;

  const mine = ballotVotes(state, kind, ballot).filter((vote) => vote.userId === userId);
  const existing = mine.find((vote) => vote.gameId === nomination.gameId);
  if (existing) {
    state.votes = state.votes.filter((vote) => vote.id !== existing.id);
    return {
      action: "unvoted",
      vote: null,
      removedVotes: [toVoteEntry(state, existing)],
      cap,
      warning: null,
      runoff,
    };
  }

  const removed: ISandboxVote[] = [];
  let warning: string | null = null;
  if (mine.length >= cap) {
    const oldest = [...mine].sort((a, b) => a.votedAt.localeCompare(b.votedAt) || a.id - b.id)[0];
    if (oldest) {
      removed.push(oldest);
      state.votes = state.votes.filter((vote) => vote.id !== oldest.id);
      warning =
        `You were at the vote cap (${cap}), so your oldest vote (${oldest.title}) ` +
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
    ...(runoff ? { runoff } : {}),
  };
  state.votes.push(vote);
  return {
    action: "voted",
    vote: toVoteEntry(state, vote),
    removedVotes: removed.map((entry) => toVoteEntry(state, entry)),
    cap,
    warning,
    runoff,
  };
}

export function isSimulatedVoter(userId: string): boolean {
  return userId.startsWith(SIMULATED_VOTER_PREFIX);
}

/**
 * Replaces a category's simulated votes with ones that produce `outcome` on
 * their own: one vote per simulated voter, spread over the category's games in
 * nomination order. While the runoff is open this seeds the runoff ballot,
 * over the category's tied games only. Real members' votes are kept and count
 * on top. Throws when the category has too few votable games for the outcome,
 * or no runoff to seed.
 */
export function seedSandboxOutcome(
  state: IVotingSandboxState,
  kind: NominationKind,
  outcome: SandboxOutcome,
  now: Date,
): void {
  const runoff = state.phase === "runoff";
  const games = runoff
    ? runoffGames(state, kind)
    : dedupeNominationsByGame(toNominationEntries(state, kind));
  if (runoff && !games.length) {
    throw new UserFacingError(`${nominationKindLabel(kind)} has no runoff to seed.`);
  }
  const needed = OUTCOME_MIN_NOMINATIONS[outcome];
  if (games.length < needed) {
    const noun = runoff ? "tied game(s) in its runoff" : "votable game(s)";
    throw new UserFacingError(
      `${nominationKindLabel(kind)} has ${games.length} ${noun}; ` +
        `"${outcome}" needs at least ${needed}.`,
    );
  }
  state.votes = state.votes.filter(
    (vote) =>
      vote.kind !== kind || !isSimulatedVoter(vote.userId) || Boolean(vote.runoff) !== runoff,
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
        ...(runoff ? { runoff } : {}),
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
 * wins, games sharing the top count go to a runoff between them, and a
 * category with no votes has no winner. The results post is queued, then
 * either the runoff or the decision.
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
    state.phase = "runoff";
    state.runoffTies = structuredClone(state.pendingTies);
    state.runoffOpensAt = now.toISOString();
    state.runoffClosesAt = new Date(now.getTime() + SANDBOX_RUNOFF_WINDOW_MS).toISOString();
    enqueue(state, "runoff_opened");
  } else {
    decide(state, now);
  }
}

/**
 * Closes the runoff and settles it as the API does: per category still tied,
 * a sole runoff leader wins; a runoff that ties again narrows to its leaders,
 * and one with no votes keeps the whole tie, both left for an admin pick. The
 * runoff results are queued, then the decision or the admins' tie prompt.
 */
export function closeSandboxRunoff(state: IVotingSandboxState, now: Date): void {
  if (state.phase !== "runoff") {
    throw new UserFacingError(
      `Sandbox Round ${state.roundNumber} is ${state.phase}; only an open runoff can close.`,
    );
  }
  for (const kind of NOMINATION_KINDS) {
    const category = toVotingRoundCategory(kind);
    const tied = state.pendingTies[category];
    if (!tied?.length) continue;
    const leaders = pickWinningRows(runoffRows(state, kind)).filter((row) =>
      tied.some((game) => game.gameId === row.gamedbGameId),
    );
    const [winner] = leaders;
    if (leaders.length === 1 && winner) {
      state.winners[category] = [winner.gamedbGameId];
      delete state.pendingTies[category];
    } else if (leaders.length) {
      state.pendingTies[category] = tied.filter((game) =>
        leaders.some((row) => row.gamedbGameId === game.gameId),
      );
    }
  }
  state.runoffClosedAt = now.toISOString();
  state.runoffClosesAt = now.toISOString();
  enqueue(state, "runoff_closed");
  if (Object.keys(state.pendingTies).length) {
    state.phase = "tie";
    enqueue(state, "tie_pending");
  } else {
    decide(state, now);
  }
}

/** Closes whichever ballot is open: the main vote, or the runoff. */
export function closeSandboxBallot(state: IVotingSandboxState, now: Date): VoteBallot {
  if (state.phase === "runoff") {
    closeSandboxRunoff(state, now);
    return "runoff";
  }
  closeSandboxVoting(state, now);
  return "main";
}

/**
 * Breaks a category's tie. Refuses what the API refuses (422): a category with
 * no tie (`no_tie`) and a pick outside the tied games (`invalid_pick`). An
 * admin may settle a category while its runoff is open, as the API allows;
 * the runoff then skips it. Breaking the last tie decides the round.
 */
export function resolveSandboxTie(
  state: IVotingSandboxState,
  category: VotingRoundCategory,
  gameIds: number[],
  now: Date,
): void {
  const settling = state.phase === "tie" || state.phase === "runoff";
  const tied = settling ? state.pendingTies[category] : undefined;
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
  if (!valid) return null;
  // Sandboxes saved before runoffs lack these; they never had a runoff.
  return {
    runoffOpensAt: null,
    runoffClosesAt: null,
    runoffClosedAt: null,
    runoffTies: {},
    pendingTies: {},
    winners: {},
    ...state,
  } as IVotingSandboxState;
}
