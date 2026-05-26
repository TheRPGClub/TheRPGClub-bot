import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import {
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "@discordjs/builders";
import Member, { type ICompletionRecord } from "../classes/Member.js";
import Game from "../classes/Game.js";
import { getThreadsByGameId } from "../classes/Thread.js";
import { formatTableDate, formatPlaytimeHours } from "../commands/profile.command.js";
import { COMPONENTS_V2_FLAG } from "../config/flags.js";
import { buildUserHeaderContainer } from "./uiComponents.js";

const JOURNAL_PAGE_SIZE = 3;

function trimContent(text: string): string {
  return text.length <= 4000 ? text : `${text.slice(0, 3997)}...`;
}

function entryLabel(n: number): string {
  return n === 1 ? "entry" : "entries";
}

export interface JournalViewOptions {
  ownerId: string;
  /** null or "__public__" = public-only view; ownerId = owner view (includes private entries) */
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
  /** Fetch and display the Now Playing / completion status in the game info container */
  includeNowPlayingMeta?: boolean;
  /** Fetch and display completions in the game info container and entries container */
  includeCompletions?: boolean;
}

export async function buildJournalView(options: JournalViewOptions): Promise<{
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
    includeNowPlayingMeta,
    includeCompletions,
  } = options;

  const isOwnerView =
    viewerId !== null && viewerId !== "__public__" && viewerId === ownerId;
  const countViewerId = isOwnerView ? ownerId : "__public__";
  const entriesViewerId: string | null = isOwnerView ? ownerId : null;

  const [game, total, threadIds, memberRecord] = await Promise.all([
    Game.getGameById(gameId),
    Member.countGameJournalEntries(ownerId, gameId, countViewerId),
    getThreadsByGameId(gameId),
    Member.getByUserId(ownerId),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / JOURNAL_PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const offset = (safePage - 1) * JOURNAL_PAGE_SIZE;

  const [entries, nowPlayingMeta, completions] = await Promise.all([
    Member.getGameJournalEntries(ownerId, gameId, {
      viewerUserId: entriesViewerId,
      limit: JOURNAL_PAGE_SIZE,
      offset,
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
  if (game?.imageData) {
    const filename = `game_journal_${gameId}.png`;
    files.push(new AttachmentBuilder(game.imageData, { name: filename }));
    coverUrl = `attachment://${filename}`;
  }

  const gameTitle = game?.title ?? `Game #${gameId}`;
  const ownerName = memberRecord?.globalName ?? memberRecord?.username ?? ownerId;
  // Header title and status
  const threadId = threadIds[0] ?? null;
  const gameTitlePart =
    guildId && threadId
      ? `[${gameTitle}](https://discord.com/channels/${guildId}/${threadId})`
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
  );

  // Container 2: entries + footer
  const pageInfo = totalPages > 1 ? `, page ${safePage} of ${totalPages}` : "";
  const publicQualifier = isOwnerView ? "" : "public ";
  const footer = `-# ${total} ${publicQualifier}${entryLabel(total)}${pageInfo}`;

  const entryParts: string[] = [];
  if (!entries.length) {
    entryParts.push("No journal entries yet.");
  } else {
    for (const entry of entries) {
      if (!isOwnerView && !entry.isPublic) {
        entryParts.push(
          `### Private Entry\n-# ${formatTableDate(entry.createdAt)}\nThis entry is private.`,
        );
        continue;
      }
      const titleLine = entry.title ? `### ${entry.title}` : `### Entry #${entry.entryNumber}`;
      const date = formatTableDate(entry.createdAt);
      const privacyLabel = isOwnerView ? ` | ${entry.isPublic ? "Public" : "Private"}` : "";
      entryParts.push(`${titleLine}\n-# ${date}${privacyLabel}\n${trimContent(entry.body)}`);
    }
  }

  if (completions.length) {
    const completionLines: string[] = [];
    for (const completion of completions) {
      const platform = completion.platformId
        ? await Game.getPlatformById(completion.platformId).catch(() => null)
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

  const gameContainer = new ContainerBuilder();
  const entriesText = new TextDisplayBuilder().setContent(entryParts.join(`\n\u00A0\n`));
  if (coverUrl) {
    gameContainer.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(entriesText)
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(coverUrl)),
    );
  } else {
    gameContainer.addTextDisplayComponents(entriesText);
  }

  // Nav row
  const navRow = new ActionRowBuilder<ButtonBuilder>();
  if (buildOwnerButtons) {
    navRow.addComponents(...buildOwnerButtons(safePage, entries.length > 0));
  }
  if (safePage > 1) {
    navRow.addComponents(
      new ButtonBuilder()
        .setCustomId(prevPageCustomId(safePage - 1))
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary),
    );
  }
  if (safePage < totalPages) {
    navRow.addComponents(
      new ButtonBuilder()
        .setCustomId(nextPageCustomId(safePage + 1))
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary),
    );
  }
  if (navRow.components.length > 0 && navRowTrailingButtons?.length) {
    navRow.addComponents(...navRowTrailingButtons);
  }

  const components: Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>> = [
    userHeaderContainer,
    gameContainer,
  ];
  if (navRow.components.length > 0) {
    components.push(navRow);
  }
  if (extraRows?.length) {
    components.push(...extraRows);
  }

  return {
    components,
    files,
    allowedMentions: { users: [] },
    flags: COMPONENTS_V2_FLAG,
  };
}

