import { AttachmentBuilder, type Client } from "discord.js";
import {
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
} from "@discordjs/builders";
import { DateTime } from "luxon";
import BotVotingInfo, { type IBotVotingInfoEntry } from "../classes/BotVotingInfo.js";
import {
  listNominationsForRound,
  NOMINATION_KINDS,
  nominationKindLabel,
} from "../classes/Nomination.js";
import { getVoteTally } from "../classes/Vote.js";
import {
  buildTallyText,
  buildWinnerAnnouncementText,
  mergeTallyWithNominations,
  pickWinningRows,
} from "../functions/VoteResultsUtils.js";
import { isRoundDecided } from "../functions/VotingRound.js";
import {
  buildComponentsV2Flags,
  buildTextContainer,
} from "../functions/ComponentsV2Utils.js";
import { VOTE_TIME_ZONE } from "../functions/VoteDateUtils.js";
import { ANNOUNCEMENT_CHANNEL_ID } from "../config/channels.js";
import { fetchGameCoverBuffer } from "./GameImageService.js";
import { logError } from "../utilities/LogUtils.js";

// Results should land close to the deadline (e.g. a 10pm close is announced
// at 10pm, not 11pm), so this polls tighter than the hourly nomination
// reminder sweep. Each idle cycle costs a single voting_info GET, so the API
// load stays negligible.
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let resultsTimer: NodeJS.Timeout | null = null;
let currentlyChecking = false;

export function startVotingResultsService(client: Client): void {
  if (resultsTimer) {
    return;
  }

  const run = async (): Promise<void> => {
    if (currentlyChecking) {
      return;
    }
    currentlyChecking = true;
    try {
      await checkAndAnnounceResults(client);
    } catch (err) {
      logError("VotingResultsService.check", err);
    } finally {
      currentlyChecking = false;
    }
  };

  void run();
  resultsTimer = setInterval(() => {
    void run();
  }, CHECK_INTERVAL_MS);
}

/**
 * Announces results once per round. A null vote_ends_at doubles as the "not
 * yet announced" marker: the automatic path runs only while the round is on
 * its default (derived) deadline, and stamps vote_ends_at with that deadline
 * after posting. /admin voting-close sets vote_ends_at itself and announces
 * immediately, so this sweep never double-posts behind it.
 */
async function checkAndAnnounceResults(client: Client): Promise<void> {
  const current = await BotVotingInfo.getCurrentRound();
  if (!current) {
    return;
  }
  if (current.voteEndsAt) {
    return;
  }
  if (!current.votingEnded) {
    return;
  }
  if (isRoundDecided(current.roundNumber)) {
    return;
  }

  await announceVotingResults(client, current);
  await BotVotingInfo.updateVoteEndsAt(
    current.roundNumber,
    current.voteDeadline ?? new Date(),
  );
}

/**
 * The month the round is played, e.g. "August 2026". Voting opens on the
 * last Friday of the month before, so the label is one month after the
 * round's vote-open date (in the club's US Eastern convention).
 */
function resolveRoundMonthLabel(nextVoteAt: Date): string {
  return DateTime.fromJSDate(nextVoteAt)
    .setZone(VOTE_TIME_ZONE)
    .plus({ months: 1 })
    .toFormat("MMMM yyyy");
}

/**
 * Posts the round's results to the announcements channel: one message with
 * the full tallies, then one winner announcement per category (with the
 * winning game's cover when available). Throws when nothing can be posted so
 * callers can surface the failure.
 */
export async function announceVotingResults(
  client: Client,
  round: IBotVotingInfoEntry,
  channelIdOverride?: string,
): Promise<void> {
  const channelId = channelIdOverride ?? ANNOUNCEMENT_CHANNEL_ID;
  const channel = await client.channels.fetch(channelId);
  const sendable =
    channel?.isTextBased() && typeof (channel as any).send === "function"
      ? (channel as any)
      : null;
  if (!sendable) {
    throw new Error(`Results channel ${channelId} was not found or cannot be sent to.`);
  }

  const monthLabel = resolveRoundMonthLabel(round.nextVoteAt);
  const tallyContainers: ContainerBuilder[] = [];
  const winnerAnnouncements: Array<{ text: string; coverGameId: number | null }> = [];

  for (const kind of NOMINATION_KINDS) {
    const kindLabel = nominationKindLabel(kind);
    const [tally, nominations] = await Promise.all([
      getVoteTally(kind, round.roundNumber),
      listNominationsForRound(kind, round.roundNumber),
    ]);
    if (!nominations.length) {
      continue;
    }
    const rows = mergeTallyWithNominations(tally.rows, nominations);
    tallyContainers.push(
      buildTextContainer(
        buildTallyText({
          kindLabel,
          roundNumber: round.roundNumber,
          rows,
          cap: tally.cap,
          votingOpen: false,
          voteDeadline: null,
        }),
      ),
    );
    const winners = pickWinningRows(rows);
    const soleWinner = winners.length === 1 ? winners[0] : null;
    winnerAnnouncements.push({
      text: buildWinnerAnnouncementText({
        kindLabel,
        roundNumber: round.roundNumber,
        monthLabel,
        winners,
      }),
      coverGameId: soleWinner?.gamedbGameId ?? null,
    });
  }

  if (!tallyContainers.length) {
    throw new Error(
      `No nominations were found for Round ${round.roundNumber}; nothing to announce.`,
    );
  }

  await sendable.send({
    components: tallyContainers,
    flags: buildComponentsV2Flags(false),
    allowedMentions: { parse: [] },
  });

  for (const announcement of winnerAnnouncements) {
    const files: AttachmentBuilder[] = [];
    const container = buildTextContainer(announcement.text);
    if (announcement.coverGameId) {
      const cover = await fetchGameCoverBuffer(announcement.coverGameId).catch(() => null);
      if (cover) {
        const filename = `winner_${announcement.coverGameId}.png`;
        files.push(new AttachmentBuilder(cover.buffer, { name: filename }));
        container.addMediaGalleryComponents(
          new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder()
              .setURL(`attachment://${filename}`)
              .setDescription("Winning game cover"),
          ),
        );
      }
    }
    await sendable.send({
      components: [container],
      files,
      flags: buildComponentsV2Flags(false),
      allowedMentions: { parse: [] },
    });
  }
}
