import { AttachmentBuilder, channelMention, type Client } from "discord.js";
import {
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
} from "@discordjs/builders";
import { NOMINATION_KINDS, nominationKindLabel } from "../classes/Nomination.js";
import {
  toVotingRoundCategory,
  type IVotingRound,
  type VotingRoundCategory,
} from "../classes/VotingRounds.js";
import { apiVotingDataSource, type IVotingDataSource } from "./VotingDataSource.js";
import {
  ballotKindLabel,
  buildFinalWinnersText,
  buildRehearsalNoticeText,
  buildRunoffResultText,
  buildTallyText,
  buildWinnerAnnouncementText,
  filterRunoffNominations,
  mergeTallyWithNominations,
  pickWinningRows,
  type ITallyDisplayRow,
} from "../functions/VoteResultsUtils.js";
import { ensureWinnerThread, type WinnerKindLabel } from "./WinnerThreadService.js";
import { VOTING_CATEGORY_LABEL } from "../functions/VotingTiePrompt.js";
import {
  buildAccentContainer,
  buildComponentsV2Flags,
  buildTextContainer,
} from "../functions/ComponentsV2Utils.js";
import {
  COLOR_HIGHLIGHT,
  COLOR_NEUTRAL,
  COLOR_PRIMARY,
  COLOR_WARNING,
} from "../config/colors.js";
import { ANNOUNCEMENT_CHANNEL_ID } from "../config/channels.js";
import { fetchGameCoverBuffer } from "./GameImageService.js";
import { fetchSendableChannel, type SendableChannel } from "../functions/ChannelUtils.js";
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

interface IWinnerAnnouncement {
  kindLabel: WinnerKindLabel;
  text: string;
  soleWinner: ITallyDisplayRow | null;
  /** Gold for a winner, amber for a tie, grey when no votes were cast. */
  accentColor: number;
}

/** The accent a category's verdict carries: a sole winner, a tie, or nothing. */
function verdictAccent(winnerCount: number): number {
  if (winnerCount === 1) return COLOR_HIGHLIGHT;
  return winnerCount ? COLOR_WARNING : COLOR_NEUTRAL;
}

/**
 * One message per category naming its winner, with the winning game's cover
 * and (outside a rehearsal) a link to its winner thread.
 */
async function postWinnerAnnouncements(
  client: Client,
  sendable: SendableChannel,
  roundNumber: number,
  winnerAnnouncements: IWinnerAnnouncement[],
  options: { rehearsal: boolean; hasCover?: (gameId: number) => boolean },
): Promise<string[]> {
  const { rehearsal } = options;
  const posted: string[] = [];
  for (const announcement of winnerAnnouncements) {
    const files: AttachmentBuilder[] = [];
    let text = announcement.text;
    const winner = announcement.soleWinner;
    if (winner && !rehearsal) {
      // Winner threads are best-effort: a failure here must not block the
      // announcement itself. A category left tied gets its thread once an
      // admin breaks the tie (the round_decided voting event).
      try {
        const threadResult = await ensureWinnerThread({
          client,
          gameId: winner.gamedbGameId,
          gameTitle: winner.gameTitle,
          roundNumber,
          kindLabel: announcement.kindLabel,
        });
        if (threadResult.threadId) {
          text += `\nJoin the discussion in ${channelMention(threadResult.threadId)}!`;
        }
      } catch (error) {
        logError("VotingResultsAnnouncement.ensureWinnerThread", error);
      }
    }
    const container = buildAccentContainer(text, announcement.accentColor);
    if (winner && (options.hasCover?.(winner.gamedbGameId) ?? true)) {
      files.push(...(await addWinnerCovers(container, [winner.gamedbGameId])));
    }
    const message: unknown = await sendable.send({
      components: [container],
      files,
      flags: buildComponentsV2Flags(false),
      allowedMentions: { parse: [] },
    });
    const url = (message as { url?: unknown } | null)?.url;
    if (typeof url === "string") posted.push(url);
  }
  return posted;
}

/**
 * Sends one results post: the tallies (under the rehearsal banner when it is
 * one), then each category's winner announcement. Throws
 * NothingToAnnounceError when there is no tally to post.
 */
async function postResults(
  client: Client,
  roundNumber: number,
  tallyContainers: ContainerBuilder[],
  announcements: IWinnerAnnouncement[],
  options: IAnnounceResultsOptions,
): Promise<void> {
  if (!tallyContainers.length) {
    throw new NothingToAnnounceError(roundNumber);
  }
  const channelId = options.channelIdOverride ?? ANNOUNCEMENT_CHANNEL_ID;
  const rehearsal = Boolean(options.rehearsal);
  const sendable = await fetchSendableChannel(client, channelId);
  if (!sendable) {
    throw new Error(`Results channel ${channelId} was not found or cannot be sent to.`);
  }
  await sendable.send({
    components: rehearsal
      ? [buildTextContainer(buildRehearsalNoticeText(roundNumber)), ...tallyContainers]
      : tallyContainers,
    flags: buildComponentsV2Flags(false),
    allowedMentions: { parse: [] },
  });
  await postWinnerAnnouncements(client, sendable, roundNumber, announcements, {
    rehearsal,
    hasCover: options.hasCover,
  });
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
  const source = options.source ?? apiVotingDataSource;
  // A round from before runoffs (or with no API row) had its ties settled by an
  // admin, so only a tie the API sent to a runoff is announced as one.
  const runoffTies = (await source.getRound(round.roundNumber))?.runoffTies ?? {};

  const monthLabel = round.monthLabel;
  const tallyContainers: ContainerBuilder[] = [];
  const winnerAnnouncements: IWinnerAnnouncement[] = [];

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
        runoff: Boolean(runoffTies[toVotingRoundCategory(kind)]?.length),
      }),
      soleWinner: winners.length === 1 ? winners[0] ?? null : null,
      accentColor: verdictAccent(winners.length),
    });
  }

  await postResults(client, round.roundNumber, tallyContainers, winnerAnnouncements, options);
}

/**
 * Posts the runoff's results to the announcements channel once it has closed:
 * one message with each runoff category's runoff tally, then each category's
 * verdict. A sole leader is announced as the winner the way the main results
 * are; a runoff that tied again says the admins will pick. Throws
 * NothingToAnnounceError when the round had no runoff.
 */
export async function announceRunoffResults(
  client: Client,
  round: IVotingRound,
  options: IAnnounceResultsOptions = {},
): Promise<void> {
  const source = options.source ?? apiVotingDataSource;

  const tallyContainers: ContainerBuilder[] = [];
  const announcements: IWinnerAnnouncement[] = [];
  for (const kind of NOMINATION_KINDS) {
    const category = toVotingRoundCategory(kind);
    const tied = round.runoffTies[category] ?? [];
    if (!tied.length) {
      continue;
    }
    const kindLabel = nominationKindLabel(kind);
    const [tally, nominations] = await Promise.all([
      source.getTally(kind, round.roundNumber, "runoff"),
      source.listNominations(kind, round.roundNumber),
    ]);
    const rows = mergeTallyWithNominations(
      tally.rows,
      filterRunoffNominations(nominations, tied),
    );
    tallyContainers.push(
      buildAccentContainer(
        buildTallyText({
          kindLabel: ballotKindLabel(kindLabel, "runoff"),
          roundNumber: round.roundNumber,
          rows,
          cap: tally.cap,
          votingOpen: false,
          voteDeadline: null,
        }),
        COLOR_PRIMARY,
      ),
    );
    const leaders = pickWinningRows(rows);
    const stillTied = (round.pendingTies[category] ?? []).map((game) => game.title);
    announcements.push({
      kindLabel,
      text: buildRunoffResultText({
        kindLabel,
        roundNumber: round.roundNumber,
        monthLabel: round.monthYear,
        leaders,
        stillTied,
      }),
      soleWinner: !stillTied.length && leaders.length === 1 ? leaders[0] ?? null : null,
      accentColor: stillTied.length ? COLOR_WARNING : verdictAccent(leaders.length === 1 ? 1 : 0),
    });
  }

  await postResults(client, round.roundNumber, tallyContainers, announcements, options);
}

/** The games an admin picked to break one category's tie. */
export interface ITieBreakPick {
  category: VotingRoundCategory;
  games: Array<{ gameId: number; title: string }>;
}

/**
 * Announces an admin's tie-break pick in the announcements channel, the way the
 * results name a winner: the cover and winner thread for a sole winner, joint winners
 * named together. A rehearsal posts the test banner first and creates no thread.
 * Returns links to the posts.
 */
export async function announceTieBreak(
  client: Client,
  round: IVotingRound,
  pick: ITieBreakPick,
  options: IAnnounceResultsOptions = {},
): Promise<string[]> {
  const channelId = options.channelIdOverride ?? ANNOUNCEMENT_CHANNEL_ID;
  const rehearsal = Boolean(options.rehearsal);
  const sendable = await fetchSendableChannel(client, channelId);
  if (!sendable) {
    throw new Error(`Results channel ${channelId} was not found or cannot be sent to.`);
  }
  if (rehearsal) {
    await sendable.send({
      components: [buildTextContainer(buildRehearsalNoticeText(round.roundNumber))],
      flags: buildComponentsV2Flags(false),
      allowedMentions: { parse: [] },
    });
  }
  const kindLabel = VOTING_CATEGORY_LABEL[pick.category];
  const [sole] = pick.games;
  const text = buildFinalWinnersText({
    kindLabel,
    roundNumber: round.roundNumber,
    monthLabel: round.monthYear,
    titles: pick.games.map((game) => game.title),
  }) + "\n-# The vote tied, so the admins picked the winner.";
  return postWinnerAnnouncements(
    client,
    sendable,
    round.roundNumber,
    [{
      kindLabel,
      text,
      soleWinner: pick.games.length === 1 && sole
        ? { gamedbGameId: sole.gameId, gameTitle: sole.title, nominationId: 0, voteCount: 0 }
        : null,
      accentColor: verdictAccent(1),
    }],
    { rehearsal, hasCover: options.hasCover },
  );
}
