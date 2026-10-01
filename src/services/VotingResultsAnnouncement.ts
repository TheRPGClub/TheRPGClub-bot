import { AttachmentBuilder, channelMention, type Client } from "discord.js";
import {
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
} from "@discordjs/builders";
import { NOMINATION_KINDS, nominationKindLabel } from "../classes/Nomination.js";
import { apiVotingDataSource, type IVotingDataSource } from "./VotingDataSource.js";
import {
  buildRehearsalNoticeText,
  buildTallyText,
  buildWinnerAnnouncementText,
  mergeTallyWithNominations,
  pickWinningRows,
  type ITallyDisplayRow,
} from "../functions/VoteResultsUtils.js";
import { ensureWinnerThread, type WinnerKindLabel } from "./WinnerThreadService.js";
import {
  buildAccentContainer,
  buildComponentsV2Flags,
  buildTextContainer,
} from "../functions/ComponentsV2Utils.js";
import { COLOR_HIGHLIGHT, COLOR_PRIMARY } from "../config/colors.js";
import { ANNOUNCEMENT_CHANNEL_ID } from "../config/channels.js";
import { fetchGameCoverBuffer } from "./GameImageService.js";
import { fetchSendableChannel } from "../functions/ChannelUtils.js";
import { logError } from "../utilities/LogUtils.js";

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
  /** Where the tallies and nominations are read; the API unless the sandbox runs. */
  source?: IVotingDataSource;
  /** False for a game with no GameDB images to fetch, such as a sandbox fixture. */
  hasCover?: (gameId: number) => boolean;
}

/**
 * Adds a gallery of the winning games' covers to the container and returns
 * the attachments it references. Games without a cover are left out.
 */
async function addWinnerCovers(
  container: ContainerBuilder,
  gameIds: number[],
): Promise<AttachmentBuilder[]> {
  const covers = await Promise.all(
    gameIds.map((gameId) => fetchGameCoverBuffer(gameId).catch(() => null)),
  );
  const files: AttachmentBuilder[] = [];
  const gallery = new MediaGalleryBuilder();
  for (const [index, gameId] of gameIds.entries()) {
    const cover = covers[index];
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
  const source = options.source ?? apiVotingDataSource;
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
      source.getTally(kind, round.roundNumber),
      source.listNominations(kind, round.roundNumber),
    ]);
    if (!nominations.length) {
      continue;
    }
    const rows = mergeTallyWithNominations(tally.rows, nominations);
    tallyContainers.push(
      buildAccentContainer(
        buildTallyText({
          kindLabel,
          roundNumber: round.roundNumber,
          rows,
          cap: tally.cap,
          votingOpen: false,
          voteDeadline: null,
        }),
        COLOR_PRIMARY,
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
    const container = buildAccentContainer(text, COLOR_HIGHLIGHT);
    if (winner && (options.hasCover?.(winner.gamedbGameId) ?? true)) {
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
