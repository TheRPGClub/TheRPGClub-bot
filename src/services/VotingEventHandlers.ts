import type { Client } from "discord.js";
import Gotm, { reloadGotmRoundFromDb } from "../classes/Gotm.js";
import NrGotm, { reloadNrGotmRoundFromDb } from "../classes/NrGotm.js";
import type { IVotingEvent } from "../classes/VotingEvents.js";
import VotingRounds, {
  type IVotingRound,
  type VotingRoundCategory,
} from "../classes/VotingRounds.js";
import { ADMIN_CHANNEL_ID, ANNOUNCEMENT_CHANNEL_ID } from "../config/channels.js";
import { NOMINATION_DISCUSSION_CHANNEL_IDS } from "../config/nominationChannels.js";
import { fetchSendableChannel } from "../functions/ChannelUtils.js";
import { toUnixTimestamp } from "../functions/DateFormatUtils.js";
import { ensureVoteScheduledEvent } from "../functions/VoteScheduledEvent.js";
import {
  hasVotableNominations,
  loadNominationsByKind,
  postVotePanels,
} from "../functions/VotePanelPosting.js";
import { logError, logWarn } from "../utilities/LogUtils.js";
import {
  announceVotingResults,
  NothingToAnnounceError,
} from "./VotingResultsAnnouncement.js";
import { ensureWinnerThread, type WinnerKindLabel } from "./WinnerThreadService.js";

/**
 * What handling an event came to. Both outcomes are acked: "skipped" means
 * the post no longer applies (the round moved on, or there was nothing to
 * post). A handler throws when the post failed and should be retried.
 */
export type VotingEventOutcome = "delivered" | "skipped";

const CATEGORY_LABEL: Record<VotingRoundCategory, WinnerKindLabel> = {
  gotm: "GOTM",
  nr_gotm: "NR-GOTM",
};

export function buildNominationReminderText(votingOpensAt: Date): string {
  const voteUnix = toUnixTimestamp(votingOpensAt);
  return (
    `Voting is <t:${voteUnix}:R> (<t:${voteUnix}:D>)!\n` +
    "Please nominate games for the upcoming vote so they can be included."
  );
}

export function buildTiePendingText(round: IVotingRound): string {
  const lines = [
    `## Round ${round.roundNumber} voting ended in a tie`,
    "An admin needs to pick the winner for each tied category below. The round is " +
      "decided, and nominations for the next one open, once every tie is broken.",
  ];
  for (const [category, games] of Object.entries(round.pendingTies)) {
    const label = CATEGORY_LABEL[category as VotingRoundCategory] ?? category;
    const titles = (games ?? []).map((game) => `**${game.title}**`).join(", ");
    lines.push(`- ${label}: ${titles}`);
  }
  return lines.join("\n");
}

async function requireRound(event: IVotingEvent): Promise<IVotingRound> {
  const round = await VotingRounds.getByRound(event.roundNumber);
  if (!round) {
    throw new Error(`Voting round ${event.roundNumber} was not found for event ${event.id}.`);
  }
  return round;
}

async function postNominationReminder(
  client: Client,
  event: IVotingEvent,
): Promise<VotingEventOutcome> {
  const round = await requireRound(event);
  if (!round.nominationsOpen) {
    return "skipped";
  }

  const content = buildNominationReminderText(round.votingOpensAt);
  let sent = 0;
  for (const channelId of NOMINATION_DISCUSSION_CHANNEL_IDS) {
    const channel = await fetchSendableChannel(client, channelId);
    if (!channel) {
      logWarn("VotingEventHandlers.reminder", `Skipped channel ${channelId}: cannot send.`);
      continue;
    }
    try {
      await channel.send(content);
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
): Promise<VotingEventOutcome> {
  const round = await requireRound(event);
  if (!round.votingOpen) {
    return "skipped";
  }

  const nominationsByKind = await loadNominationsByKind(round.roundNumber);
  if (!hasVotableNominations(nominationsByKind)) {
    logWarn(
      "VotingEventHandlers.votingOpened",
      `Round ${round.roundNumber} opened with no votable nominations; no panels posted.`,
    );
    return "skipped";
  }

  const result = await postVotePanels({
    client,
    channelId: ANNOUNCEMENT_CHANNEL_ID,
    roundNumber: round.roundNumber,
    voteDeadline: round.votingClosesAt,
    nominationsByKind,
  });
  if (result.posted === 0) {
    throw new Error(`No Round ${round.roundNumber} voting panel could be posted.`);
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
): Promise<VotingEventOutcome> {
  const round = await requireRound(event);
  try {
    await announceVotingResults(client, {
      roundNumber: round.roundNumber,
      monthLabel: round.monthYear,
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
): Promise<VotingEventOutcome> {
  const round = await requireRound(event);
  if (round.phase !== "tie") {
    return "skipped";
  }
  const channel = await fetchSendableChannel(client, ADMIN_CHANNEL_ID);
  if (!channel) {
    throw new Error(`Admin channel ${ADMIN_CHANNEL_ID} was not found or cannot be sent to.`);
  }
  await channel.send({ content: buildTiePendingText(round), allowedMentions: { parse: [] } });
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
async function scheduleNextVoteEvent(client: Client, decidedRound: number): Promise<void> {
  const next = await VotingRounds.getCurrent();
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

async function finishDecidedRound(
  client: Client,
  event: IVotingEvent,
): Promise<VotingEventOutcome> {
  // The API recorded the winners; the caches only load at startup otherwise.
  await reloadGotmRoundFromDb(event.roundNumber);
  await reloadNrGotmRoundFromDb(event.roundNumber);
  await ensureRoundWinnerThreads(client, event.roundNumber);
  // Throws to retry the event; the steps above are safe to repeat.
  await scheduleNextVoteEvent(client, event.roundNumber);
  return "delivered";
}

/** Performs the Discord side of one voting event. Throws to have it retried. */
export async function handleVotingEvent(
  client: Client,
  event: IVotingEvent,
): Promise<VotingEventOutcome> {
  switch (event.kind) {
    case "nomination_reminder_5d":
    case "nomination_reminder_1d":
      return postNominationReminder(client, event);
    case "voting_opened":
      return postVotingPanels(client, event);
    case "voting_closed":
      return postVotingResults(client, event);
    case "tie_pending":
      return postTiePendingNotice(client, event);
    case "round_decided":
      return finishDecidedRound(client, event);
    case "unknown":
      logWarn("VotingEventHandlers", `Unknown voting event kind "${event.rawKind}"; acking.`);
      return "skipped";
  }
}
