import type { Client } from "discord.js";
import Gotm, { reloadGotmRoundFromDb } from "../classes/Gotm.js";
import {
  NOMINATION_KINDS,
  type INominationEntry,
  type NominationKind,
} from "../classes/Nomination.js";
import type { VoteBallot } from "../classes/Vote.js";
import NrGotm, { reloadNrGotmRoundFromDb } from "../classes/NrGotm.js";
import type { IVotingEvent } from "../classes/VotingEvents.js";
import { toVotingRoundCategory, type IVotingRound } from "../classes/VotingRounds.js";
import { ADMIN_CHANNEL_ID, ANNOUNCEMENT_CHANNEL_ID } from "../config/channels.js";
import { POST_FEATURE_KEYS } from "../config/featureGate.js";
import { NOMINATION_DISCUSSION_CHANNEL_IDS } from "../config/nominationChannels.js";
import { fetchSendableChannel } from "../functions/ChannelUtils.js";
import { toUnixTimestamp } from "../functions/DateFormatUtils.js";
import { buildComponentsV2Flags, buildTextSend } from "../functions/ComponentsV2Utils.js";
import { commandMention } from "./CommandMentionService.js";
import {
  buildTiePromptComponents,
  type TieBreakSelectIdBuilder,
} from "../functions/VotingTiePrompt.js";
import type { IVotePanelIds } from "../functions/VotePanelComponents.js";
import { filterRunoffNominations } from "../functions/VoteResultsUtils.js";
import { ensureVoteScheduledEvent } from "../functions/VoteScheduledEvent.js";
import {
  hasVotableNominations,
  loadNominationsByKind,
  postVotePanels,
} from "../functions/VotePanelPosting.js";
import { logError, logWarn } from "../utilities/LogUtils.js";
import {
  announceRunoffResults,
  announceVotingResults,
  NothingToAnnounceError,
} from "./VotingResultsAnnouncement.js";
import { ensureWinnerThread, type WinnerKindLabel } from "./WinnerThreadService.js";
import { apiVotingDataSource, type IVotingDataSource } from "./VotingDataSource.js";
import { logSuppressedPost, resolveVotingPostTarget } from "./FeaturePostRouting.js";
import { featureFlagCache } from "./FeatureAccessService.js";
import type { IFeatureFlagSource } from "../functions/FeatureGate.js";

/**
 * What handling an event came to. Both outcomes are acked: "skipped" means
 * the post no longer applies (the round moved on, or there was nothing to
 * post). A handler throws when the post failed and should be retried.
 */
export type VotingEventOutcome = "delivered" | "skipped";

/**
 * Where an event's posts read the round from and how they look. The live
 * context reads the API and has every side effect; the voting sandbox
 * (/vote-sandbox, test mode only) passes its own so the same handlers run
 * against an in-memory round.
 */
export interface IVotingEventContext {
  source: IVotingDataSource;
  /** Adds a banner to the results post and never creates a winner thread there. */
  rehearsal: boolean;
  /** Panel ids per ballot; the live ones when absent. */
  panelIds?: Record<VoteBallot, IVotePanelIds>;
  panelNotice?: string;
  tieSelectId?: TieBreakSelectIdBuilder;
  /**
   * The round_decided step before the next vote is scheduled. Live, it reloads
   * the GOTM caches and creates the winner threads, both of which write
   * through the API, so the sandbox replaces it.
   */
  recordWinners: (client: Client, roundNumber: number) => Promise<void>;
  /**
   * Set while the Voting & GOTM Feature is in Preview (bot#1521): every public post goes to
   * this channel (bot-dev) instead, the results as a rehearsal, and nothing public is made
   * (no winner thread, no scheduled event).
   */
  previewChannelId?: string;
  /**
   * Reloads the bot's GOTM caches for a decided round, posting nothing: what round_decided
   * still does in Preview and Off. reloadDecidedRound unless a test passes its own.
   */
  reloadRound?: (roundNumber: number) => Promise<void>;
}

export function buildNominationReminderText(roundNumber: number, votingOpensAt: Date): string {
  const voteUnix = toUnixTimestamp(votingOpensAt);
  return [
    `### 📝 Round ${roundNumber} nominations are open`,
    `Voting opens <t:${voteUnix}:R> (<t:${voteUnix}:F>).`,
    `Nominate games with ${commandMention("gotm nominate")} so they make the ballot.`,
  ].join("\n");
}

async function requireRound(
  event: IVotingEvent,
  context: IVotingEventContext,
): Promise<IVotingRound> {
  const round = await context.source.getRound(event.roundNumber);
  if (!round) {
    throw new Error(`Voting round ${event.roundNumber} was not found for event ${event.id}.`);
  }
  return round;
}

async function postNominationReminder(
  client: Client,
  event: IVotingEvent,
  context: IVotingEventContext,
): Promise<VotingEventOutcome> {
  const round = await requireRound(event, context);
  if (!round.nominationsOpen) {
    return "skipped";
  }

  const reminder = buildTextSend(
    buildNominationReminderText(round.roundNumber, round.votingOpensAt),
  );
  let sent = 0;
  const channelIds = context.previewChannelId
    ? [context.previewChannelId]
    : NOMINATION_DISCUSSION_CHANNEL_IDS;
  for (const channelId of channelIds) {
    const channel = await fetchSendableChannel(client, channelId);
    if (!channel) {
      logWarn("VotingEventHandlers.reminder", `Skipped channel ${channelId}: cannot send.`);
      continue;
    }
    try {
      await channel.send(reminder);
      sent += 1;
    } catch (err) {
      logError("VotingEventHandlers.reminder", err);
    }
  }
  if (!sent) {
    throw new Error(`The Round ${round.roundNumber} nomination reminder reached no channel.`);
  }
  return "delivered";
}

async function postVotingPanels(
  client: Client,
  event: IVotingEvent,
  context: IVotingEventContext,
): Promise<VotingEventOutcome> {
  const round = await requireRound(event, context);
  if (!round.votingOpen) {
    return "skipped";
  }

  const nominationsByKind = await loadNominationsByKind(round.roundNumber, context.source);
  if (!hasVotableNominations(nominationsByKind)) {
    logWarn(
      "VotingEventHandlers.votingOpened",
      `Round ${round.roundNumber} opened with no votable nominations; no panels posted.`,
    );
    return "skipped";
  }

  const result = await postVotePanels({
    client,
    channelId: context.previewChannelId ?? ANNOUNCEMENT_CHANNEL_ID,
    roundNumber: round.roundNumber,
    monthLabel: round.monthYear,
    voteDeadline: round.votingClosesAt,
    nominationsByKind,
    source: context.source,
    ids: context.panelIds?.main,
    notice: context.panelNotice,
    featureRouted: true,
  });
  if (result.posted === 0) {
    throw new Error(
      `No Round ${round.roundNumber} voting panel could be posted.\n${result.lines.join("\n")}`,
    );
  }
  if (result.failed > 0) {
    // Retrying would repost the panels that did go out; /admin voting-open
    // reposts them all if the missing one matters.
    logWarn("VotingEventHandlers.votingOpened", result.lines.join("\n"));
  }
  return "delivered";
}

async function postVotingResults(
  client: Client,
  event: IVotingEvent,
  context: IVotingEventContext,
): Promise<VotingEventOutcome> {
  const round = await requireRound(event, context);
  try {
    await announceVotingResults(
      client,
      { roundNumber: round.roundNumber, monthLabel: round.monthYear },
      {
        rehearsal: context.rehearsal,
        source: context.source,
        channelIdOverride: context.previewChannelId,
        featureRouted: true,
      },
    );
  } catch (err) {
    if (err instanceof NothingToAnnounceError) {
      return "skipped";
    }
    throw err;
  }
  return "delivered";
}

/**
 * The runoff panels: one per category the runoff is still deciding, offering
 * only its tied games. A category an admin already settled is left out.
 */
async function postRunoffPanels(
  client: Client,
  event: IVotingEvent,
  context: IVotingEventContext,
): Promise<VotingEventOutcome> {
  const round = await requireRound(event, context);
  if (!round.runoffOpen) {
    return "skipped";
  }

  const listed = await loadNominationsByKind(round.roundNumber, context.source);
  const nominationsByKind = new Map<NominationKind, INominationEntry[]>(
    NOMINATION_KINDS.map((kind) => [
      kind,
      filterRunoffNominations(
        listed.get(kind) ?? [],
        round.pendingTies[toVotingRoundCategory(kind)] ?? [],
      ),
    ]),
  );
  if (!hasVotableNominations(nominationsByKind)) {
    logWarn(
      "VotingEventHandlers.runoffOpened",
      `Round ${round.roundNumber}'s runoff has no tied games left to vote on; no panels posted.`,
    );
    return "skipped";
  }

  const result = await postVotePanels({
    client,
    channelId: context.previewChannelId ?? ANNOUNCEMENT_CHANNEL_ID,
    roundNumber: round.roundNumber,
    monthLabel: round.monthYear,
    voteDeadline: round.runoffClosesAt,
    nominationsByKind,
    source: context.source,
    ids: context.panelIds?.runoff,
    notice: context.panelNotice,
    featureRouted: true,
    ballot: "runoff",
  });
  if (result.posted === 0) {
    throw new Error(
      `No Round ${round.roundNumber} runoff panel could be posted.\n${result.lines.join("\n")}`,
    );
  }
  if (result.failed > 0) {
    // As with the voting panels, a retry would repost the ones that went out.
    logWarn("VotingEventHandlers.runoffOpened", result.lines.join("\n"));
  }
  return "delivered";
}

async function postRunoffResults(
  client: Client,
  event: IVotingEvent,
  context: IVotingEventContext,
): Promise<VotingEventOutcome> {
  const round = await requireRound(event, context);
  if (!round.runoffEnded) {
    return "skipped";
  }
  try {
    await announceRunoffResults(client, round, {
      rehearsal: context.rehearsal,
      source: context.source,
      channelIdOverride: context.previewChannelId,
      featureRouted: true,
    });
  } catch (err) {
    if (err instanceof NothingToAnnounceError) {
      return "skipped";
    }
    throw err;
  }
  return "delivered";
}

async function postTiePendingNotice(
  client: Client,
  event: IVotingEvent,
  context: IVotingEventContext,
): Promise<VotingEventOutcome> {
  const round = await requireRound(event, context);
  if (round.phase !== "tie") {
    return "skipped";
  }
  const channel = await fetchSendableChannel(client, ADMIN_CHANNEL_ID);
  if (!channel) {
    throw new Error(`Admin channel ${ADMIN_CHANNEL_ID} was not found or cannot be sent to.`);
  }
  await channel.send({
    components: buildTiePromptComponents(round, context.tieSelectId),
    flags: buildComponentsV2Flags(false),
    allowedMentions: { parse: [] },
  });
  return "delivered";
}

async function ensureRoundWinnerThreads(client: Client, roundNumber: number): Promise<void> {
  const winners: Array<{ kindLabel: WinnerKindLabel; gameId: number; title: string }> = [
    ...Gotm.getByRound(roundNumber).flatMap((entry) =>
      entry.gameOfTheMonth.map((game) => ({
        kindLabel: "GOTM" as const,
        gameId: game.gamedbGameId,
        title: game.title,
      })),
    ),
    ...NrGotm.getByRound(roundNumber).flatMap((entry) =>
      entry.gameOfTheMonth.map((game) => ({
        kindLabel: "NR-GOTM" as const,
        gameId: game.gamedbGameId,
        title: game.title,
      })),
    ),
  ];
  for (const winner of winners) {
    // Best-effort, as in the results announcement: an existing linked thread
    // is left unchanged, so re-running this for a redelivered event is safe.
    try {
      await ensureWinnerThread({
        client,
        gameId: winner.gameId,
        gameTitle: winner.title,
        roundNumber,
        kindLabel: winner.kindLabel,
      });
    } catch (err) {
      logError("VotingEventHandlers.ensureWinnerThread", err);
    }
  }
}

/**
 * The Discord scheduled event reminding members of the next round's vote.
 * Throws when the next round is not scheduled yet, so the event is retried
 * until the API has it; an existing event is reused, so retries are safe.
 */
async function scheduleNextVoteEvent(
  client: Client,
  decidedRound: number,
  source: IVotingDataSource,
): Promise<void> {
  const next = await source.getCurrentRound();
  if (!next || next.roundNumber <= decidedRound) {
    throw new Error(`The round after Round ${decidedRound} is not scheduled yet.`);
  }
  if (next.votingOpensAt.getTime() <= Date.now()) {
    return;
  }

  const channel = await client.channels.fetch(ANNOUNCEMENT_CHANNEL_ID).catch(() => null);
  const guild = channel && "guild" in channel ? channel.guild : null;
  if (!guild) {
    throw new Error(`No guild was found for announcements channel ${ANNOUNCEMENT_CHANNEL_ID}.`);
  }

  await ensureVoteScheduledEvent(guild, {
    roundNumber: next.roundNumber,
    monthYear: next.monthYear,
    startsAt: next.votingOpensAt,
  });
}

async function reloadDecidedRound(roundNumber: number): Promise<void> {
  // The API recorded the winners; the caches only load at startup otherwise.
  await reloadGotmRoundFromDb(roundNumber);
  await reloadNrGotmRoundFromDb(roundNumber);
}

async function recordLiveWinners(client: Client, roundNumber: number): Promise<void> {
  await reloadDecidedRound(roundNumber);
  await ensureRoundWinnerThreads(client, roundNumber);
}

export const LIVE_VOTING_EVENT_CONTEXT: IVotingEventContext = {
  source: apiVotingDataSource,
  rehearsal: false,
  recordWinners: recordLiveWinners,
};

async function finishDecidedRound(
  client: Client,
  event: IVotingEvent,
  context: IVotingEventContext,
): Promise<VotingEventOutcome> {
  await context.recordWinners(client, event.roundNumber);
  // A Preview round makes nothing public, so members get no scheduled event either.
  if (context.previewChannelId) return "delivered";
  // Throws to retry the event; the step above is safe to repeat.
  await scheduleNextVoteEvent(client, event.roundNumber, context.source);
  return "delivered";
}

/**
 * The live context as the Voting & GOTM Feature's flag routes it (bot#1521), resolved once
 * per event and passed down to every post: unchanged when Live, its public posts sent to
 * the bot-dev channel in Preview, and null when Off (its public posts are suppressed). A
 * rehearsal (the sandbox) is never routed.
 */
async function routeVotingEventContext(
  context: IVotingEventContext,
  flags: IFeatureFlagSource,
): Promise<IVotingEventContext | null> {
  if (context.rehearsal) return context;
  const target = await resolveVotingPostTarget(undefined, flags);
  if (!target) return null;
  if (!target.rehearsal) return context;
  const reloadRound = context.reloadRound ?? reloadDecidedRound;
  return {
    ...context,
    rehearsal: true,
    previewChannelId: target.channelId,
    recordWinners: (_client, roundNumber) => reloadRound(roundNumber),
  };
}

/**
 * Performs the Discord side of one voting event. Throws to have it retried. While the
 * Voting & GOTM Feature is Off, an event that posts publicly is skipped (acked, nothing
 * posted); the admin channel's tie prompt still goes out, and a decided round still
 * reloads the bot's GOTM caches (no winner threads and no scheduled event: those are
 * public, and Off pauses the Feature's automated activity).
 */
export async function handleVotingEvent(
  client: Client,
  event: IVotingEvent,
  baseContext: IVotingEventContext = LIVE_VOTING_EVENT_CONTEXT,
  flags: IFeatureFlagSource = featureFlagCache,
): Promise<VotingEventOutcome> {
  if (event.kind === "tie_pending") return postTiePendingNotice(client, event, baseContext);
  if (event.kind === "unknown") {
    logWarn("VotingEventHandlers", `Unknown voting event kind "${event.rawKind}"; acking.`);
    return "skipped";
  }
  const context = await routeVotingEventContext(baseContext, flags);
  if (!context) {
    logSuppressedPost(POST_FEATURE_KEYS.voting, `voting event ${event.id} (${event.kind})`);
    if (event.kind === "round_decided") {
      await (baseContext.reloadRound ?? reloadDecidedRound)(event.roundNumber);
    }
    return "skipped";
  }
  switch (event.kind) {
    case "nomination_reminder_5d":
    case "nomination_reminder_1d":
      return postNominationReminder(client, event, context);
    case "voting_opened":
      return postVotingPanels(client, event, context);
    case "voting_closed":
      return postVotingResults(client, event, context);
    case "runoff_opened":
      return postRunoffPanels(client, event, context);
    case "runoff_closed":
      return postRunoffResults(client, event, context);
    case "round_decided":
      return finishDecidedRound(client, event, context);
  }
}
