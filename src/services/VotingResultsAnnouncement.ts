import { AttachmentBuilder, channelMention, type Client } from "discord.js";
import {
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
} from "@discordjs/builders";
import { DateTime } from "luxon";
import {
  listNominationsForRound,
  NOMINATION_KINDS,
  nominationKindLabel,
} from "../classes/Nomination.js";
import { getVoteTally } from "../classes/Vote.js";
import {
  buildRehearsalNoticeText,
  buildFinalWinnersText,
  buildTallyText,
  buildWinnerAnnouncementText,
  mergeTallyWithNominations,
  pickWinningRows,
  type ITallyDisplayRow,
} from "../functions/VoteResultsUtils.js";
import { ensureWinnerThread, type WinnerKindLabel } from "./WinnerThreadService.js";
import {
  buildComponentsV2Flags,
  buildTextContainer,
} from "../functions/ComponentsV2Utils.js";
import { VOTE_TIME_ZONE } from "../functions/VoteDateUtils.js";
import { ANNOUNCEMENT_CHANNEL_ID } from "../config/channels.js";
import { fetchGameCoverBuffer } from "./GameImageService.js";
import { fetchSendableChannel } from "../functions/ChannelUtils.js";
import { logError } from "../utilities/LogUtils.js";

/**
 * The month the round is played, e.g. "August 2026". Voting opens on the
 * last Friday of the month before, so the label is one month after the
 * round's vote-open date (in the club's US Eastern convention).
 */
export function resolveRoundMonthLabel(nextVoteAt: Date): string {
  return DateTime.fromJSDate(nextVoteAt)
    .setZone(VOTE_TIME_ZONE)
    .plus({ months: 1 })
    .toFormat("MMMM yyyy");
}

/** The round whose results are announced, and the month its winners are played. */
export interface IResultsRound {
  roundNumber: number;
  monthLabel: string;
}

/** Thrown when no category of the round had nominations, so there is nothing to post. */
export class NothingToAnnounceError extends Error {
  constructor(roundNumber: number) {
    super(`No nominations were found for Round ${roundNumber}; nothing to announce.`);
    this.name = "NothingToAnnounceError";
  }
}

export interface IAnnounceResultsOptions {
  /** Posts somewhere other than announcements, e.g. a rehearsal channel. */
  channelIdOverride?: string;
  /**
   * Marks the run as a rehearsal: the announcement carries a test banner and
   * no winner thread is created or renamed. Nothing else about the output
   * changes, so the real copy is what gets reviewed.
   */
  rehearsal?: boolean;
}

/**
 * Adds a gallery of the winning games' covers to the container and returns
 * the attachments it references. Games without a cover are left out.
 */
async function addWinnerCovers(
  container: ContainerBuilder,
  gameIds: number[],
): Promise<AttachmentBuilder[]> {
  const files: AttachmentBuilder[] = [];
  const gallery = new MediaGalleryBuilder();
  for (const gameId of gameIds) {
    const cover = await fetchGameCoverBuffer(gameId).catch(() => null);
    if (!cover) {
      continue;
    }
    const filename = `winner_${gameId}.png`;
    files.push(new AttachmentBuilder(cover.buffer, { name: filename }));
    gallery.addItems(
      new MediaGalleryItemBuilder()
        .setURL(`attachment://${filename}`)
        .setDescription("Winning game cover"),
    );
  }
  if (files.length) {
    container.addMediaGalleryComponents(gallery);
  }
  return files;
}

/**
 * Posts the round's results to the announcements channel: one message with
 * the full tallies, then one winner announcement per category (with the
 * winning game's cover when available). Throws when nothing can be posted so
 * callers can surface the failure.
 */
export async function announceVotingResults(
  client: Client,
  round: IResultsRound,
  options: IAnnounceResultsOptions = {},
): Promise<void> {
  const channelId = options.channelIdOverride ?? ANNOUNCEMENT_CHANNEL_ID;
  const rehearsal = Boolean(options.rehearsal);
  const sendable = await fetchSendableChannel(client, channelId);
  if (!sendable) {
    throw new Error(`Results channel ${channelId} was not found or cannot be sent to.`);
  }

  const monthLabel = round.monthLabel;
  const tallyContainers: ContainerBuilder[] = [];
  const winnerAnnouncements: Array<{
    kindLabel: WinnerKindLabel;
    text: string;
    soleWinner: ITallyDisplayRow | null;
  }> = [];

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
    winnerAnnouncements.push({
      kindLabel,
      text: buildWinnerAnnouncementText({
        kindLabel,
        roundNumber: round.roundNumber,
        monthLabel,
        winners,
      }),
      soleWinner: winners.length === 1 ? winners[0] ?? null : null,
    });
  }

  if (!tallyContainers.length) {
    throw new NothingToAnnounceError(round.roundNumber);
  }

  await sendable.send({
    components: rehearsal
      ? [buildTextContainer(buildRehearsalNoticeText(round.roundNumber)), ...tallyContainers]
      : tallyContainers,
    flags: buildComponentsV2Flags(false),
    allowedMentions: { parse: [] },
  });

  for (const announcement of winnerAnnouncements) {
    const files: AttachmentBuilder[] = [];
    let text = announcement.text;
    const winner = announcement.soleWinner;
    if (winner && !rehearsal) {
      // Winner threads are best-effort: a failure here must not block the
      // announcement itself. A tie gets its thread once an admin breaks it
      // (the round_decided voting event).
      try {
        const threadResult = await ensureWinnerThread({
          client,
          gameId: winner.gamedbGameId,
          gameTitle: winner.gameTitle,
          roundNumber: round.roundNumber,
          kindLabel: announcement.kindLabel,
        });
        if (threadResult.threadId) {
          text += `\nJoin the discussion in ${channelMention(threadResult.threadId)}!`;
        }
      } catch (error) {
        logError("VotingResultsAnnouncement.ensureWinnerThread", error);
      }
    }
    const container = buildTextContainer(text);
    if (winner) {
      files.push(...(await addWinnerCovers(container, [winner.gamedbGameId])));
    }
    await sendable.send({
      components: [container],
      files,
      flags: buildComponentsV2Flags(false),
      allowedMentions: { parse: [] },
    });
  }
}

/** One category's settled winners, in the order the admins recorded them. */
export interface IRoundWinnerCategory {
  kindLabel: WinnerKindLabel;
  games: Array<{ gamedbGameId: number; title: string }>;
}

/**
 * Posts the round's final winners, one message per category, as the admins
 * recorded them (ties broken, several picks allowed). Unlike
 * announceVotingResults, no tallies are posted: those went out when voting
 * closed. Each winner's thread is linked; a rehearsal skips thread work.
 */
export async function announceRoundWinners(
  client: Client,
  round: IResultsRound,
  categories: IRoundWinnerCategory[],
  options: IAnnounceResultsOptions = {},
): Promise<void> {
  const channelId = options.channelIdOverride ?? ANNOUNCEMENT_CHANNEL_ID;
  const rehearsal = Boolean(options.rehearsal);
  const withWinners = categories.filter((category) => category.games.length);
  if (!withWinners.length) {
    throw new NothingToAnnounceError(round.roundNumber);
  }
  const sendable = await fetchSendableChannel(client, channelId);
  if (!sendable) {
    throw new Error(`Results channel ${channelId} was not found or cannot be sent to.`);
  }

  for (const [index, category] of withWinners.entries()) {
    const lines = [
      buildFinalWinnersText({
        kindLabel: category.kindLabel,
        roundNumber: round.roundNumber,
        monthLabel: round.monthLabel,
        titles: category.games.map((game) => game.title),
      }),
    ];
    if (!rehearsal) {
      for (const game of category.games) {
        // Best-effort, as in announceVotingResults: a thread failure must not
        // block the announcement.
        try {
          const threadResult = await ensureWinnerThread({
            client,
            gameId: game.gamedbGameId,
            gameTitle: game.title,
            roundNumber: round.roundNumber,
            kindLabel: category.kindLabel,
          });
          if (threadResult.threadId) {
            lines.push(
              `Join the **${game.title}** discussion in ` +
                `${channelMention(threadResult.threadId)}!`,
            );
          }
        } catch (error) {
          logError("VotingResultsAnnouncement.announceRoundWinners", error);
        }
      }
    }
    const containers: ContainerBuilder[] = [];
    if (rehearsal && index === 0) {
      containers.push(buildTextContainer(buildRehearsalNoticeText(round.roundNumber)));
    }
    const container = buildTextContainer(lines.join("\n"));
    const files = await addWinnerCovers(
      container,
      category.games.map((game) => game.gamedbGameId),
    );
    containers.push(container);
    await sendable.send({
      components: containers,
      files,
      flags: buildComponentsV2Flags(false),
      allowedMentions: { parse: [] },
    });
  }
}
