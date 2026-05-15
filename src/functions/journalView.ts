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
import { getUserEmojiString } from "../services/UserEmojiService.js";
import { formatTableDate, formatPlaytimeHours } from "../commands/profile.command.js";
import { COMPONENTS_V2_FLAG } from "../config/flags.js";

const JOURNAL_PAGE_SIZE = 5;

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
  prevPageCustomId: (page: number) => string;
  nextPageCustomId: (page: number) => string;
  /** When provided, builds owner management buttons (Add/Edit/Delete) prepended to the nav row */
  buildOwnerButtons?: (safePage: number, hasEntries: boolean) => ButtonBuilder[];
  /** Buttons appended to the end of the nav row; omitted entirely when no other nav buttons exist */
  navRowTrailingButtons?: ButtonBuilder[];
  /** Extra rows appended after the nav row */
  extraRows?: Array<ActionRowBuilder<ButtonBuilder>>;
  /** Fetch and display the "Now Playing since" date in the header */
  includeNowPlayingMeta?: boolean;
  /** Fetch and display the completions block below the main section */
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

  const [game, total] = await Promise.all([
    Game.getGameById(gameId),
    Member.countGameJournalEntries(ownerId, gameId, countViewerId),
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
  const emojiPrefix = getUserEmojiString(ownerId);
  const ownerTag = emojiPrefix ? `${emojiPrefix} <@${ownerId}>` : `<@${ownerId}>`;

  const pageInfo = totalPages > 1 ? `, page ${safePage} of ${totalPages}` : "";
  const publicQualifier = isOwnerView ? "" : "public ";
  const footer = `-# ${total} ${publicQualifier}${entryLabel(total)}${pageInfo}`;

  let headerContent = `## ${gameTitle}\n${ownerTag}'s Game Journal\n\n`;
  if (nowPlayingMeta?.addedAt) {
    headerContent += `Now Playing since ${formatTableDate(nowPlayingMeta.addedAt)}\n`;
  }

  const entryLines: string[] = [];
  if (!entries.length) {
    entryLines.push("No journal entries yet.");
  } else {
    for (const entry of entries) {
      if (!isOwnerView && !entry.isPublic) {
        entryLines.push(
          `### Private Entry\n-# ${formatTableDate(entry.createdAt)}\nThis entry is private.`,
        );
        continue;
      }
      const titleLine = entry.title ? `### ${entry.title}` : "### Untitled Entry";
      const date = formatTableDate(entry.createdAt);
      const privacyLabel = isOwnerView ? ` | ${entry.isPublic ? "Public" : "Private"}` : "";
      entryLines.push(`${titleLine}\n-# ${date}${privacyLabel}\n${trimContent(entry.body)}`);
    }
  }
  entryLines.push(footer);

  const section = new SectionBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(headerContent))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(entryLines.join("\n\n")),
    );
  if (coverUrl) {
    section.setThumbnailAccessory(new ThumbnailBuilder().setURL(coverUrl));
  }

  const container = new ContainerBuilder().addSectionComponents(section);

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
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`Completions:\n${completionLines.join("\n")}`),
    );
  }

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

  const components: Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>> = [container];
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
