import type { Client } from "discord.js";
import { NOMINATION_KINDS, nominationKindLabel } from "../classes/Nomination.js";
import type { IVotingEvent } from "../classes/VotingEvents.js";
import type { VotingRoundCategory } from "../classes/VotingRounds.js";
import { ADMIN_CHANNEL_ID } from "../config/channels.js";
import { TEST_GUILD_ID } from "../config/testMode.js";
import { fetchSendableChannel } from "../functions/ChannelUtils.js";
import {
  buildComponentsV2Flags,
  buildTextContainer,
} from "../functions/ComponentsV2Utils.js";
import type { IVotePanelIds } from "../functions/VotePanelComponents.js";
import { buildFinalWinnersText } from "../functions/VoteResultsUtils.js";
import { describeRequestError, UserFacingError } from "../utilities/ApiErrorUtils.js";
import { persistedSessionStore } from "./PersistedInteractionSessionStore.js";
import type { IVotingDataSource } from "./VotingDataSource.js";
import {
  handleVotingEvent,
  type IVotingEventContext,
  type VotingEventOutcome,
} from "./VotingEventHandlers.js";
import {
  createVotingEventDeliveryState,
  processVotingEvents,
} from "./VotingEventService.js";
import {
  castSandboxVote,
  isFixtureGameId,
  parseSandboxState,
  resolveSandboxTie,
  sandboxTally,
  sandboxVotesForUser,
  sandboxWinnerTitles,
  toNominationEntries,
  toSandboxNextRound,
  toSandboxVotingRound,
  type ISandboxQueuedEvent,
  type IVotingSandboxState,
} from "./VotingSandboxModel.js";
import { commandMention } from "./CommandMentionService.js";

// The voting sandbox's runtime: one sandbox round per admin, persisted in the
// wizard session table (its own command_key, never read by production) so the
// panels it posts keep working after a restart, and delivered through the same
// event handlers and delivery loop the API's outbox uses.

const SESSION_KIND = "vote-sandbox";
const SESSION_ID = "current";

export const SANDBOX_CUSTOM_ID_PREFIX = {
  cast: "vsbx-cast",
  mine: "vsbx-mine",
  tally: "vsbx-tally",
  tie: "vsbx-tie",
} as const;

export const NO_SANDBOX_MESSAGE = "You have no voting sandbox. Run /vote-sandbox start.";

export const SANDBOX_ENDED_MESSAGE =
  "This sandbox panel belongs to a voting sandbox that has ended or been restarted.";

const sandboxes = new Map<string, IVotingSandboxState>();
/**
 * Bumped by every save and end. A restore that finds it moved while its read
 * was in flight read an older row, so it must not replace what memory holds.
 */
const generations = new Map<string, number>();
const locks = new Map<string, Promise<unknown>>();
const delivering = new Set<string>();

function sessionLookup(ownerId: string): {
  kind: string;
  sessionId: string;
  ownerId: string;
  channelId: null;
} {
  return { kind: SESSION_KIND, sessionId: SESSION_ID, ownerId, channelId: null };
}

/** The admin's sandbox, from memory or (after a restart) the persisted copy. */
export async function loadSandbox(ownerId: string): Promise<IVotingSandboxState | null> {
  const cached = sandboxes.get(ownerId);
  if (cached) return cached;
  const generation = generations.get(ownerId) ?? 0;
  const record = await persistedSessionStore.load(sessionLookup(ownerId));
  if ((generations.get(ownerId) ?? 0) !== generation) {
    return sandboxes.get(ownerId) ?? null;
  }
  const state = record ? parseSandboxState(record.state) : null;
  if (state) sandboxes.set(ownerId, state);
  return state;
}

/** Persists first, so memory never holds a state the persisted row lacks. */
async function saveSandbox(state: IVotingSandboxState): Promise<void> {
  await persistedSessionStore.save({
    kind: SESSION_KIND,
    sessionId: SESSION_ID,
    ownerId: state.ownerId,
    location: { channelId: null, guildId: TEST_GUILD_ID || null },
    state,
  });
  bumpGeneration(state.ownerId);
  sandboxes.set(state.ownerId, state);
}

function bumpGeneration(ownerId: string): void {
  generations.set(ownerId, (generations.get(ownerId) ?? 0) + 1);
}

/** Runs `task` after any earlier one for the same admin, so writes never interleave. */
function serialize<T>(ownerId: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(ownerId) ?? Promise.resolve();
  const next = previous.then(task, task);
  locks.set(
    ownerId,
    next.catch(() => undefined),
  );
  return next;
}

export async function startSandbox(state: IVotingSandboxState): Promise<void> {
  await serialize(state.ownerId, () => saveSandbox(state));
}

/**
 * Applies `change` to the admin's sandbox and persists it. With `sandboxId`,
 * refuses a sandbox other than the one a panel was posted for.
 */
export function mutateSandbox<T>(
  ownerId: string,
  change: (state: IVotingSandboxState) => T,
  sandboxId?: string,
): Promise<T> {
  return serialize(ownerId, async () => {
    const state = await loadSandbox(ownerId);
    if (!state || (sandboxId && state.id !== sandboxId)) {
      throw new UserFacingError(sandboxId ? SANDBOX_ENDED_MESSAGE : NO_SANDBOX_MESSAGE);
    }
    // A change that throws partway, or a save that fails, leaves the sandbox as it was.
    const draft = structuredClone(state);
    const result = change(draft);
    await saveSandbox(draft);
    return result;
  });
}

export async function endSandbox(ownerId: string): Promise<boolean> {
  return serialize(ownerId, async () => {
    const existed = Boolean(await loadSandbox(ownerId));
    bumpGeneration(ownerId);
    sandboxes.delete(ownerId);
    const record = await persistedSessionStore.load(sessionLookup(ownerId));
    if (record) await persistedSessionStore.remove(record.rowId);
    // Again once the row is gone: a restore that read it after the first bump
    // must not bring the sandbox back.
    bumpGeneration(ownerId);
    sandboxes.delete(ownerId);
    return existed;
  });
}

export interface ISandboxTarget {
  ownerId: string;
  sandboxId: string;
}

/**
 * Sandbox ids are `<prefix>:<owner>:<sandbox>:<round>:<kind or category>[:<chunk>]`.
 * Everything a handler needs is in the id, so no read runs before it defers.
 */
function sandboxIdBase(target: ISandboxTarget, roundNumber: number): string {
  return `${target.ownerId}:${target.sandboxId}:${roundNumber}`;
}

export function buildSandboxPanelIds(target: ISandboxTarget): IVotePanelIds {
  return {
    cast: (kind, round, chunk) =>
      `${SANDBOX_CUSTOM_ID_PREFIX.cast}:${sandboxIdBase(target, round)}:${kind}:${chunk}`,
    mine: (kind, round) =>
      `${SANDBOX_CUSTOM_ID_PREFIX.mine}:${sandboxIdBase(target, round)}:${kind}`,
    tally: (kind, round) =>
      `${SANDBOX_CUSTOM_ID_PREFIX.tally}:${sandboxIdBase(target, round)}:${kind}`,
  };
}

export function buildSandboxTieSelectId(
  target: ISandboxTarget,
  roundNumber: number,
  category: VotingRoundCategory,
): string {
  return `${SANDBOX_CUSTOM_ID_PREFIX.tie}:${sandboxIdBase(target, roundNumber)}:${category}`;
}

export interface IParsedSandboxCustomId extends ISandboxTarget {
  roundNumber: number;
  /** The kind or category, then the select chunk for a cast id. */
  rest: string[];
}

export function parseSandboxCustomId(customId: string): IParsedSandboxCustomId | null {
  const [, ownerId, sandboxId, rawRound, ...rest] = customId.split(":");
  const roundNumber = Number(rawRound);
  if (!ownerId || !/^\d+$/.test(ownerId) || !sandboxId || !rest.length) return null;
  if (!Number.isInteger(roundNumber) || roundNumber <= 0) return null;
  return { ownerId, sandboxId, roundNumber, rest };
}

async function requireSandbox(target: ISandboxTarget): Promise<IVotingSandboxState> {
  const state = await loadSandbox(target.ownerId);
  if (!state || state.id !== target.sandboxId) {
    throw new UserFacingError(SANDBOX_ENDED_MESSAGE);
  }
  return state;
}

/** Reads and writes one sandbox round in place of the API. */
export function createSandboxDataSource(target: ISandboxTarget): IVotingDataSource {
  const refuseOtherRound = (state: IVotingSandboxState, roundNumber: number): void => {
    if (roundNumber !== state.roundNumber) {
      throw new UserFacingError(`The sandbox has no Round ${roundNumber}.`);
    }
  };
  return {
    getRound: async (roundNumber) => {
      const state = await requireSandbox(target);
      if (roundNumber === state.roundNumber) return toSandboxVotingRound(state);
      const next = toSandboxNextRound(state);
      return next?.roundNumber === roundNumber ? next : null;
    },
    getCurrentRound: async () => {
      const state = await requireSandbox(target);
      return toSandboxNextRound(state) ?? toSandboxVotingRound(state);
    },
    listNominations: async (kind, roundNumber) => {
      const state = await requireSandbox(target);
      return roundNumber === state.roundNumber ? toNominationEntries(state, kind) : [];
    },
    getTally: async (kind, roundNumber) => {
      const state = await requireSandbox(target);
      return roundNumber === state.roundNumber
        ? sandboxTally(state, kind)
        : { rows: [], cap: state.cap };
    },
    getVotesForUser: async (kind, roundNumber, userId) => {
      const state = await requireSandbox(target);
      return roundNumber === state.roundNumber ? sandboxVotesForUser(state, kind, userId) : [];
    },
    castVote: (kind, roundNumber, userId, nominationId) =>
      mutateSandbox(
        target.ownerId,
        (state) => {
          refuseOtherRound(state, roundNumber);
          return castSandboxVote(state, kind, userId, nominationId, new Date());
        },
        target.sandboxId,
      ),
    resolveTie: (roundNumber, category, gameIds) =>
      mutateSandbox(
        target.ownerId,
        (state) => {
          refuseOtherRound(state, roundNumber);
          resolveSandboxTie(state, category, gameIds, new Date());
          return toSandboxVotingRound(state);
        },
        target.sandboxId,
      ),
  };
}

export function buildSandboxPanelNotice(state: IVotingSandboxState): string {
  return (
    "## 🧪 VOTING SANDBOX\nVotes cast here are stored in the sandbox only and never " +
    `touch a real round. Sandbox \`${state.id}\`, run by <@${state.ownerId}>.`
  );
}

export function buildSandboxDecidedText(state: IVotingSandboxState): string {
  const lines = [`## 🧪 Sandbox Round ${state.roundNumber} decided`];
  for (const kind of NOMINATION_KINDS) {
    lines.push(
      buildFinalWinnersText({
        kindLabel: nominationKindLabel(kind),
        roundNumber: state.roundNumber,
        monthLabel: state.monthYear,
        titles: sandboxWinnerTitles(state, kind),
      }).replace(/^# /, "### "),
    );
  }
  lines.push(
    "-# Live, round_decided also reloads the GOTM caches and creates the winner threads. " +
      "Both write through the API, so the sandbox skips them.",
  );
  return lines.join("\n");
}

async function postSandboxDecided(client: Client, target: ISandboxTarget): Promise<void> {
  const state = await requireSandbox(target);
  const channel = await fetchSendableChannel(client, ADMIN_CHANNEL_ID);
  if (!channel) {
    throw new Error(`Admin channel ${ADMIN_CHANNEL_ID} was not found or cannot be sent to.`);
  }
  await channel.send({
    components: [buildTextContainer(buildSandboxDecidedText(state))],
    flags: buildComponentsV2Flags(false),
    allowedMentions: { parse: [] },
  });
}

export function buildSandboxEventContext(state: IVotingSandboxState): IVotingEventContext {
  const target = { ownerId: state.ownerId, sandboxId: state.id };
  return {
    source: createSandboxDataSource(target),
    rehearsal: true,
    panelIds: buildSandboxPanelIds(target),
    panelNotice: buildSandboxPanelNotice(state),
    tieSelectId: (round, category) => buildSandboxTieSelectId(target, round, category),
    hasCover: (gameId) => !isFixtureGameId(gameId),
    recordWinners: (client) => postSandboxDecided(client, target),
  };
}

function toVotingEvent(
  state: IVotingSandboxState,
  queued: ISandboxQueuedEvent,
): IVotingEvent {
  return {
    id: queued.id,
    roundNumber: state.roundNumber,
    kind: queued.kind,
    rawKind: queued.kind,
    payload: {},
    availableAt: new Date(),
    expiresAt: null,
    attempts: 0,
  };
}

/**
 * Delivers the sandbox's queued events through the live delivery loop and
 * handlers, oldest first, and reports each one. A failed event stays queued,
 * holding back the ones after it, exactly as the API outbox would.
 */
export async function deliverSandboxOutbox(client: Client, ownerId: string): Promise<string[]> {
  if (delivering.has(ownerId)) {
    return ["Another delivery for this sandbox is already running."];
  }
  delivering.add(ownerId);
  try {
    const state = await loadSandbox(ownerId);
    if (!state?.outbox.length) return [];
    const context = buildSandboxEventContext(state);
    const events = state.outbox.map((queued) => toVotingEvent(state, queued));
    const lines: string[] = [];
    const handle = async (
      eventClient: Client,
      event: IVotingEvent,
    ): Promise<VotingEventOutcome> => {
      try {
        const outcome = await handleVotingEvent(eventClient, event, context);
        lines.push(`\`${event.rawKind}\`: ${outcome}.`);
        return outcome;
      } catch (err) {
        lines.push(`\`${event.rawKind}\`: failed, left queued. ${describeRequestError(err)}`);
        throw err;
      }
    };
    const ack = (id: number): Promise<void> =>
      mutateSandbox(ownerId, (current) => {
        current.outbox = current.outbox.filter((queued) => queued.id !== id);
      });
    await processVotingEvents(client, events, handle, ack, createVotingEventDeliveryState());
    const left = (await loadSandbox(ownerId))?.outbox.length ?? 0;
    if (left) {
      lines.push(
        `${left} event(s) still queued. ` +
          `Retry with ${commandMention("vote-sandbox deliver")}.`,
      );
    }
    return lines;
  } finally {
    delivering.delete(ownerId);
  }
}
