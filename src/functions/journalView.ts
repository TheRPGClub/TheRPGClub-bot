import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
} from "discord.js";
import { ContainerBuilder } from "@discordjs/builders";
import Member, {
  type ICompletionRecord,
  type IGameJournalEntry,
} from "../classes/Member.js";
import Game from "../classes/Game.js";
import { buildMaskedLink } from "./ComponentsV2Utils.js";
import Thread from "../classes/Thread.js";
import { formatTableDate, formatPlaytimeHours } from "./DateFormatUtils.js";
import { buildComponentsV2EditFlags, buildContentContainer } from "./ComponentsV2Utils.js";
import { buildButtonRow, buildUserHeaderContainer } from "./uiComponents.js";
import { buildPrevNextButtons } from "./PaginationUtils.js";
import { truncateWithEllipsis } from "../utilities/ValidationUtils.js";
import GamePlatformRegionService from "../classes/GamePlatformRegionService.js";
import { fetchGameCoverBuffer } from "../services/GameImageService.js";

const JOURNAL_PAGE_SIZE = 1;

function trimContent(text: string): string {
  return truncateWithEllipsis(text, 4000);
}

function entryLabel(n: number): string {
  return n === 1 ? "entry" : "entries";
}

export function formatJournalEntryTitle(entry: IGameJournalEntry): string {
  return entry.title?.trim() ? entry.title.trim() : `Entry #${entry.entryNumber}`;
}

// Status line shown above the manage controls once a delete confirm is answered.
export function formatJournalDeleteStatus(removed: IGameJournalEntry | null): string {
  return removed
    ? `-# Deleted **${formatJournalEntryTitle(removed)}**.`
    : "-# Delete cancelled. Nothing was deleted.";
}

export interface IJournalViewOptions {
  ownerId: string;
  /** null or "__public__" = viewer-only; ownerId = owner view (shows management controls) */
  viewerId: string | null;
  gameId: number;
  page: number;
  /** Used to build a clickable thread link in the game title; omit to show plain title */
  guildId?: string | null;
  prevPageCustomId: (page: number) => string;
  nextPageCustomId: (page: number) => string;
  /** When provided, builds owner management buttons (Add/Edit/Delete) prepended to the nav row */
  buildOwnerButtons?: (safePage: number, hasEntries: boolean) => ButtonBuilder[];
  /** Buttons appended to the end of the nav row; omitted entirely when no other nav buttons exist */
  navRowTrailingButtons?: ButtonBuilder[];
  /** Extra rows appended after the nav row */
  extraRows?: Array<ActionRowBuilder<ButtonBuilder>>;
  /** Custom ID for the header section button; defaults to a non-interactive label button */
  headerButtonCustomId?: string;
  /** Fetch and display the Now Playing / completion status in the game info container */
  includeNowPlayingMeta?: boolean;
  /** Fetch and display completions in the game info container and entries container */
  includeCompletions?: boolean;
}

export async function buildJournalView(options: IJournalViewOptions): Promise<{
  components: Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>>;
  files: AttachmentBuilder[];
  allowedMentions: { users: string[] };
  flags: number;
}> {
  const {
    ownerId,
    viewerId,
    gameId,
    page,
    guildId,
    prevPageCustomId,
    nextPageCustomId,
    buildOwnerButtons,
    navRowTrailingButtons,
    extraRows,
    headerButtonCustomId,
    includeNowPlayingMeta,
    includeCompletions,
  } = options;

  const [game, total, threadIds, memberRecord, cover] = await Promise.all([
    Game.getGameById(gameId),
    Member.countGameJournalEntries(ownerId, gameId, viewerId),
    Thread.getThreadsByGameId(gameId),
    Member.getByUserId(ownerId),
    fetchGameCoverBuffer(gameId),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / JOURNAL_PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const offset = (safePage - 1) * JOURNAL_PAGE_SIZE;

  const [entries, nowPlayingMeta, completions] = await Promise.all([
    Member.getGameJournalEntries(ownerId, gameId, {
      limit: JOURNAL_PAGE_SIZE,
      offset,
      viewerUserId: viewerId,
    }),
    includeNowPlayingMeta
      ? Member.getNowPlayingEntryMeta(ownerId, gameId)
      : Promise.resolve(null),
    includeCompletions
      ? Member.getCompletionsForGame(ownerId, gameId)
      : Promise.resolve([] as ICompletionRecord[]),
  ]);

  const files: AttachmentBuilder[] = [];
  let coverUrl: string | null = null;
  if (cover) {
    const filename = `game_journal_${gameId}.png`;
    files.push(new AttachmentBuilder(cover.buffer, { name: filename }));
    coverUrl = `attachment://${filename}`;
  }

  const gameTitle = game?.title ?? `Game #${gameId}`;
  const ownerName = memberRecord?.globalName ?? memberRecord?.username ?? ownerId;
  // Header title and status
  const threadId = threadIds[0] ?? null;
  const gameTitlePart =
    guildId && threadId
      ? buildMaskedLink(gameTitle, `https://discord.com/channels/${guildId}/${threadId}`)
      : gameTitle;

  let statusLine = "";
  if (nowPlayingMeta?.addedAt) {
    statusLine = `Now Playing since ${formatTableDate(nowPlayingMeta.addedAt)}`;
  } else if (completions.length > 0) {
    const latest = completions[0];
    const completedDate = latest.completedAt
      ? formatTableDate(latest.completedAt)
      : "Unknown Date";
    statusLine = `${latest.completionType} on ${completedDate}`;
  }

  const headerTitleLines = [`${gameTitlePart} Game Journal`];
  if (statusLine) headerTitleLines.push(statusLine);
  const userHeaderContainer = buildUserHeaderContainer(
    ownerId,
    ownerName,
    headerTitleLines.join("\n"),
    headerButtonCustomId,
  );

  // Container 2: entries + footer
  const footer = `-# ${total} ${entryLabel(total)}`;

  const entryParts: string[] = [];
  if (!entries.length) {
    entryParts.push("No journal entries yet.");
  } else {
    for (const entry of entries) {
      const titleLine = entry.title ? `### ${entry.title}` : `### Entry #${entry.entryNumber}`;
      const date = formatTableDate(entry.createdAt);
      entryParts.push(`${titleLine}\n-# ${date}\n${trimContent(entry.body)}`);
    }
  }

  if (completions.length) {
    const completionLines: string[] = [];
    for (const completion of completions) {
      const platform = completion.platformId
        ? await GamePlatformRegionService.getPlatformById(completion.platformId).catch(() => null)
        : null;
      const platformName = platform?.abbreviation ?? platform?.name ?? "Unknown Platform";
      const completedDate = completion.completedAt
        ? formatTableDate(completion.completedAt)
        : "Unknown Date";
      const playtime = formatPlaytimeHours(completion.finalPlaytimeHours);
      const parts = [
        completion.completionType,
        completedDate,
        platformName,
        playtime,
        `Completion #${completion.completionId}`,
      ].filter(Boolean);
      completionLines.push(`- ${parts.join(" | ")}`);
    }
    entryParts.push(`Completions:\n${completionLines.join("\n")}`);
  }

  entryParts.push(footer);

  const gameContainer = buildContentContainer(entryParts.join(`\n\u00A0\n`), coverUrl);

  // Nav row
  const navButtons: ButtonBuilder[] = [];
  if (buildOwnerButtons) {
    navButtons.push(...buildOwnerButtons(safePage, entries.length > 0));
  }
  // Entries are newest first, so paging backward shows the next (newer) entry.
  navButtons.push(...buildPrevNextButtons(
    prevPageCustomId(safePage - 1),
    nextPageCustomId(safePage + 1),
    safePage - 1,
    totalPages,
    { prev: "Next Entry", next: "Previous Entry" },
  ));
  if (navRowTrailingButtons?.length) {
    navButtons.push(...navRowTrailingButtons);
  }

  const components: Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>> = [
    userHeaderContainer,
    gameContainer,
  ];
  if (navButtons.length > 0) {
    components.push(buildButtonRow(...navButtons));
  }
  if (extraRows?.length) {
    components.push(...extraRows);
  }

  return {
    components,
    files,
    allowedMentions: { users: [] },
    flags: buildComponentsV2EditFlags(),
  };
}
