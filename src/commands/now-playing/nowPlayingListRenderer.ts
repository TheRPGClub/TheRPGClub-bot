import {
  type User,
  AttachmentBuilder,
  MessageFlags,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Client,
} from "discord.js";
import {
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ButtonBuilder as V2ButtonBuilder,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import { SeparatorSpacingSize } from "discord-api-types/v10";
import crypto from "node:crypto";
import Member, { type IMemberNowPlayingEntry } from "../../classes/Member.js";
import { fetchGameCoverBuffer } from "../../services/GameImageService.js";
import {
  safeReply,
  safeUpdate,
  safeUserFetch,
  type AnyRepliable,
} from "../../functions/InteractionUtils.js";
import {
  buildActionButton,
  buildButtonRow,
  buildJournalSelectRow,
  buildUserHeaderContainer,
  buildSelectRow,
} from "../../functions/uiComponents.js";
import {
  buildComponentsV2Flags,
  buildTextContainer,
  safeV2TextContent,
} from "../../functions/ComponentsV2Utils.js";
import { composeVoteImage } from "../../services/collageGenerator.js";
import {
  getOrReplaceBackblazeImage,
  hasBackblazeB2Config,
} from "../../services/BackblazeB2Service.js";
import { renderUsernameWithEmoji } from "../../services/UserEmojiService.js";
import { truncateWithEllipsis } from "../../utilities/ValidationUtils.js";
import { logError } from "../../utilities/LogUtils.js";
import { safeIgnore } from "../../utilities/AsyncUtils.js";
import { DISCORD_SELECT_OPTIONS_MAX, truncateLabel } from "../../config/textLimits.js";
import {
  NOW_PLAYING_LIST_EDIT_PREFIX,
  NOW_PLAYING_JOURNAL_VIEW_SELECT_PREFIX,
  NOW_PLAYING_COMPOSITE_MAX,
  NOW_PLAYING_EDIT_MENU_SORT_PREFIX,
  NOW_PLAYING_EDIT_MENU_PLATFORM_PREFIX,
  NOW_PLAYING_EDIT_MENU_COMPLETE_PREFIX,
  NOW_PLAYING_EDIT_MENU_REMOVE_PREFIX,
  NOW_PLAYING_EDIT_MENU_START_JOURNAL_PREFIX,
  NOW_PLAYING_JOURNAL_OPEN_PREFIX,
  NOW_PLAYING_ALL_SELECT_ID,
} from "./nowPlayingIds.js";
import {
  type NowPlayingListComponents,
  type NowPlayingPayloadComponents,
} from "./nowPlayingTypes.js";
import {
  nowPlayingListContexts,
  NOW_PLAYING_CONTEXT_TTL_MS,
} from "./nowPlayingContexts.js";
import {
  formatEntry,
  getDisplayNowPlayingEntries,
} from "../../functions/NowPlayingUtils.js";

export function buildNowPlayingListLines(
  entries: IMemberNowPlayingEntry[],
  guildId: string | null,
): string[] {
  const lines: string[] = [];
  entries.forEach((entry) => {
    lines.push(`- ${formatEntry(entry, guildId)}`);
    if (entry.note) {
      lines.push(`  - ${entry.note}`);
    }
  });
  return lines;
}

export function buildNowPlayingListContainer(title: string, lines: string[]): ContainerBuilder {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(safeV2TextContent(`# ${title}`, 250)),
  );
  if (lines.length) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(safeV2TextContent(lines.join("\n"), 3500)),
    );
  }
  return container;
}

export function buildNowPlayingMessageContainer(
  title: string,
  message: string,
): ContainerBuilder {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(safeV2TextContent(`# ${title}`, 250)),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(safeV2TextContent(message, 1000)),
  );
  return container;
}

export function buildComponentPayload(
  components: Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>>,
  files?: AttachmentBuilder[],
): {
  components: Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>>;
  files?: AttachmentBuilder[];
} {
  if (files && files.length) {
    // eslint-disable-next-line local/dynamic-components-require-chunking
    return { components, files };
  }
  // eslint-disable-next-line local/dynamic-components-require-chunking
  return { components };
}

export async function buildNowPlayingAttachments(
  entries: IMemberNowPlayingEntry[],
  maxImages: number = Number.POSITIVE_INFINITY,
  includeImages: boolean = true,
): Promise<{
  files: AttachmentBuilder[];
  thumbnailsByGameId: Map<number, string>;
  covers: Array<{ gameId: number; title: string; imageData: Buffer; imageUrl: string }>;
}> {
  if (!includeImages) {
    return {
      files: [],
      thumbnailsByGameId: new Map<number, string>(),
      covers: [],
    };
  }
  const seen = new Set<number>();
  const uniqueEntries: IMemberNowPlayingEntry[] = [];
  for (const entry of entries) {
    if (!entry.gameId || seen.has(entry.gameId)) continue;
    seen.add(entry.gameId);
    if (uniqueEntries.length >= maxImages) break;
    uniqueEntries.push(entry);
  }

  const results = await Promise.all(
    uniqueEntries.map(async (entry) => {
      const cover = await fetchGameCoverBuffer(entry.gameId!);
      if (!cover) return null;
      return {
        gameId: entry.gameId!, title: entry.title, imageData: cover.buffer, imageUrl: cover.url,
      };
    }),
  );
  const covers = results.filter((c): c is NonNullable<typeof c> => c !== null);

  return { files: [], thumbnailsByGameId: new Map<number, string>(), covers };
}

export async function buildNowPlayingListPayload(
  target: User,
  entries: IMemberNowPlayingEntry[],
  guildId: string | null,
  showPrivateOnlyJournalButtons: boolean = false,
  singleUserMode: boolean = false,
): Promise<{ components: NowPlayingPayloadComponents; files: AttachmentBuilder[] }> {
  const { files, covers } = await buildNowPlayingAttachments(
    entries, NOW_PLAYING_COMPOSITE_MAX,
  );
  const listComponents = buildNowPlayingEntryComponents(
    entries,
    target.id,
    guildId,
    await buildNowPlayingCompositeImageUrl(files, covers, target.id),
    showPrivateOnlyJournalButtons,
    singleUserMode,
    singleUserMode,
  );
  const ownerName = target.displayName ?? target.username ?? target.id;
  const headerCustomId = singleUserMode
    ? `${NOW_PLAYING_LIST_EDIT_PREFIX}:${target.id}`
    : undefined;
  const headerContainer = buildUserHeaderContainer(
    target.id,
    ownerName,
    "Now Playing",
    headerCustomId,
  );
  const journalSelectRow = buildNowPlayingJournalSelectRow(entries, target.id);
  const trailingComponents: NowPlayingPayloadComponents =
    journalSelectRow ? [journalSelectRow] : [];
  return { components: [headerContainer, ...listComponents, ...trailingComponents], files };
}

export function buildNowPlayingJournalSelectRow(
  entries: IMemberNowPlayingEntry[],
  ownerId: string,
): ActionRowBuilder<StringSelectMenuBuilder> | null {
  const journalEntries = entries
    .filter((e) => e.journalEnabled && e.hasJournalEntry)
    .map((e) => ({
      gameId: e.gameId,
      title: e.title,
      journalCount: e.journalCount,
      lastJournalAt: e.lastJournalAt,
    }));
  return buildJournalSelectRow(
    `${NOW_PLAYING_JOURNAL_VIEW_SELECT_PREFIX}:${ownerId}`,
    journalEntries,
  );
}

export async function buildNowPlayingCompositeImageUrl(
  files: AttachmentBuilder[],
  covers: Array<{ gameId: number; title: string; imageData: Buffer; imageUrl: string }>,
  ownerId: string,
): Promise<string | null> {
  if (!covers.length) {
    return null;
  }

  const sourceHash = buildNowPlayingCompositeSourceHash(ownerId, covers);
  if (hasBackblazeB2Config()) {
    try {
      const stored = await getOrReplaceBackblazeImage(
        `generated/now-playing/${ownerId}/composite`,
        sourceHash,
        () => composeVoteImage({
          roundNumber: 1,
          voteType: "GOTM",
          covers,
          sortByTitle: false,
        }),
      );
      return stored.url;
    } catch (error) {
      logError("now-playing/backblazeUpload", error);
    }
  }

  const imageBuffer = await composeVoteImage({
    roundNumber: 1,
    voteType: "GOTM",
    covers,
    sortByTitle: false,
  });
  const filename = "now_playing_composite.png";
  files.push(new AttachmentBuilder(imageBuffer, { name: filename }));
  return `attachment://${filename}`;
}

export function buildNowPlayingCompositeSourceHash(
  ownerId: string,
  covers: Array<{ gameId: number; title: string; imageUrl: string }>,
): string {
  const hash = crypto.createHash("sha256");
  // eslint-disable-next-line local/no-direct-interaction-response-methods
  hash.update(`owner:${ownerId}|count:${covers.length}|`);
  covers.forEach((cover) => {
    // eslint-disable-next-line local/no-direct-interaction-response-methods
    hash.update(`id:${cover.gameId}|title:${cover.title}|url:${cover.imageUrl}|`);
  });
  return hash.digest("hex");
}

export async function buildNowPlayingManageRow(
  ownerId: string,
): Promise<ActionRowBuilder<ButtonBuilder>> {
  const entries = await Member.getNowPlaying(ownerId).then(getDisplayNowPlayingEntries);
  const hasGamesWithoutJournal = entries.some((e) => !e.hasJournalEntry);
  const buttons: ButtonBuilder[] = [];
  if (hasGamesWithoutJournal) {
    buttons.push(
      buildActionButton("add", `${NOW_PLAYING_EDIT_MENU_START_JOURNAL_PREFIX}:${ownerId}`, "Start a Game Journal"),
    );
  }
  buttons.push(
    buildActionButton({ customId: `${NOW_PLAYING_EDIT_MENU_SORT_PREFIX}:${ownerId}`, label: "Sort", style: ButtonStyle.Secondary }),
    buildActionButton({ customId: `${NOW_PLAYING_EDIT_MENU_PLATFORM_PREFIX}:${ownerId}`, label: "Edit Platform", style: ButtonStyle.Secondary }),
    buildActionButton({ customId: `${NOW_PLAYING_EDIT_MENU_COMPLETE_PREFIX}:${ownerId}`, label: "Add Completion", style: ButtonStyle.Secondary }),
    buildActionButton("delete", `${NOW_PLAYING_EDIT_MENU_REMOVE_PREFIX}:${ownerId}`, "Remove Game"),
  );
  return buildButtonRow(...buttons);
}

export function buildNowPlayingEditMenuComponents(
  ownerId: string,
  entries: IMemberNowPlayingEntry[],
  statusMessage: string | null = null,
): Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>> {
  const introLines = ["## Manage Now Playing\nChoose an action."];
  if (statusMessage) {
    introLines.push(`-# ${statusMessage}`);
  }
  const introContainer = buildTextContainer(introLines.join("\n"));
  const listContainer = entries.length
    ? buildNowPlayingEntryComponents(
      entries,
      ownerId,
      null,
      null,
      true,
      true,
    )[0]
    : buildNowPlayingMessageContainer(
      "Your Now Playing List",
      "Your Now Playing list is empty.",
    );
  const firstRow = buildButtonRow(
    buildActionButton({ customId: `${NOW_PLAYING_EDIT_MENU_SORT_PREFIX}:${ownerId}`, label: "Sort", style: ButtonStyle.Secondary }),
    buildActionButton({ customId: `${NOW_PLAYING_EDIT_MENU_PLATFORM_PREFIX}:${ownerId}`, label: "Edit Platform", style: ButtonStyle.Secondary }),
  );
  const secondRow = buildButtonRow(
    buildActionButton({ customId: `${NOW_PLAYING_EDIT_MENU_COMPLETE_PREFIX}:${ownerId}`, label: "Add Completion", style: ButtonStyle.Secondary }),
    buildActionButton("delete", `${NOW_PLAYING_EDIT_MENU_REMOVE_PREFIX}:${ownerId}`, "Remove Game"),
  );
  return [introContainer, listContainer, firstRow, secondRow];
}

export async function returnToNowPlayingEditMenu(
  interaction: AnyRepliable,
  ownerId: string,
): Promise<void> {
  const row = await buildNowPlayingManageRow(ownerId);
  const flags = buildComponentsV2Flags(true);
  const anyInteraction = interaction as any;
  const isAcked = Boolean(
    anyInteraction.__rpgDeferred ?? anyInteraction.__rpgAcked ??
    anyInteraction.deferred ?? anyInteraction.replied,
  );
  if (isAcked) {
    safeIgnore(safeReply(interaction, { components: [row], flags }));
  } else {
    safeIgnore(safeUpdate(interaction, { components: [row], flags }));
  }
}

export async function buildNowPlayingEditInitialComponents(
  ownerId: string,
  statusMessage: string | null = null,
): Promise<Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>>> {
  const entries = await Member.getNowPlaying(ownerId).then(getDisplayNowPlayingEntries);
  return buildNowPlayingEditMenuComponents(ownerId, entries, statusMessage);
}

export async function withPmNowPlayingList(
  _ownerId: string,
  _guildId: string | null,
  components: Array<ContainerBuilder | ActionRowBuilder<any>>,
): Promise<Array<ContainerBuilder | ActionRowBuilder<any>>> {
  return components;
}

export async function refreshNowPlayingListFromContext(
  interaction: { client: Client; guildId: string | null; user: User },
  userId: string,
): Promise<boolean> {
  if (!nowPlayingListContexts.size) {
    return false;
  }
  let updatedAny = false;
  let allListsCache: Awaited<ReturnType<typeof Member.getAllNowPlaying>> | null = null;

  for (const [key, context] of nowPlayingListContexts.entries()) {
    if (Date.now() - context.createdAt > NOW_PLAYING_CONTEXT_TTL_MS) {
      nowPlayingListContexts.delete(key);
      continue;
    }

    const shouldRefresh = context.view === "everyone" ||
      context.view === "everyone-selected" ||
      context.ownerUserId === userId;
    if (!shouldRefresh) {
      continue;
    }

    const channel = await interaction.client.channels
      .fetch(context.channelId)
      .catch(() => null);
    if (!channel?.isTextBased()) {
      nowPlayingListContexts.delete(key);
      continue;
    }

    const message = await channel.messages
      .fetch(context.messageId)
      .catch(() => null);
    if (!message) {
      nowPlayingListContexts.delete(key);
      continue;
    }

    try {
      if (context.view === "single" && context.ownerUserId) {
        const ownerId = context.ownerUserId;
        const target = ownerId === interaction.user.id
          ? interaction.user
          : await safeUserFetch(interaction.client, ownerId);
        if (!target) {
          continue;
        }
        const isEphemeral = message.flags?.has(MessageFlags.Ephemeral) ?? false;
        const title = ownerId === interaction.user.id && isEphemeral
          ? "Your Now Playing List"
          : `**${renderUsernameWithEmoji(ownerId, target.displayName ?? target.username ?? "User")}**'s Now Playing List`;
        const entries = getDisplayNowPlayingEntries(await Member.getNowPlaying(ownerId));

        if (!entries.length) {
          const ownerName = target.displayName ?? target.username ?? target.id;
          const header = buildUserHeaderContainer(
            ownerId,
            ownerName,
            "Now Playing",
            `${NOW_PLAYING_LIST_EDIT_PREFIX}:${ownerId}`,
          );
          const emptyMessage = ownerId === interaction.user.id
            ? "Your Now Playing list is empty."
            : `No Now Playing entries found for ${renderUsernameWithEmoji(ownerId, ownerName)}.`;
          const container = buildNowPlayingMessageContainer(title, emptyMessage);
          const components = [header, container];
          await message.edit({
            components,
            flags: buildComponentsV2Flags(isEphemeral),
          });
          updatedAny = true;
          continue;
        }

        const payload = await buildNowPlayingListPayload(
          target,
          entries,
          message.guildId ?? interaction.guildId,
          ownerId === interaction.user.id,
          true,
        );
        await message.edit({
          components: payload.components,
          files: payload.files,
          flags: buildComponentsV2Flags(isEphemeral),
        });
        updatedAny = true;
        continue;
      }

      if (!allListsCache) {
        allListsCache = await Member.getAllNowPlaying();
      }

      if (context.view === "everyone") {
        if (!allListsCache.length) {
          const container = buildNowPlayingMessageContainer(
            "Now Playing - Everyone",
            "No Now Playing data found for anyone yet.",
          );
          await message.edit({ components: [container] });
          updatedAny = true;
          continue;
        }
        const sortedLists = [...allListsCache].sort((a, b) => {
          const nameA = (a.globalName ?? a.username ?? a.userId).toLowerCase();
          const nameB = (b.globalName ?? b.username ?? b.userId).toLowerCase();
          return nameA.localeCompare(nameB);
        });
        const lines = sortedLists.map((record) => {
          const displayName = record.globalName ?? record.username ?? record.userId;
          const count = record.entries.length;
          const suffix = count === 1 ? "game" : "games";
          return `**${renderUsernameWithEmoji(record.userId, displayName)}**: ${count} ${suffix}`;
        });
        const container = buildNowPlayingListContainer("Now Playing - Everyone", lines);
        const selectRow = buildNowPlayingMemberSelect(sortedLists);
        await message.edit({
          components: [container, selectRow],
        });
        updatedAny = true;
        continue;
      }

      if (context.view === "everyone-selected" && context.selectedUserId) {
        const selectedUserId = context.selectedUserId;
        const target =
          (await safeUserFetch(interaction.client, selectedUserId)) ??
          interaction.user;
        const entries = getDisplayNowPlayingEntries(
          await Member.getNowPlaying(selectedUserId),
        );
        if (!entries.length) {
          const ownerName = target.displayName ?? target.username ?? target.id;
          const header = buildUserHeaderContainer(
            selectedUserId,
            ownerName,
            "Now Playing",
            `${NOW_PLAYING_LIST_EDIT_PREFIX}:${selectedUserId}`,
          );
          const container = buildNowPlayingMessageContainer(
            "Now Playing - Everyone",
            `No Now Playing entries found for ${renderUsernameWithEmoji(selectedUserId, ownerName)}.`,
          );
          await message.edit({
            components: [header, container],
          });
          updatedAny = true;
          continue;
        }
        const payload = await buildNowPlayingListPayload(
          target,
          entries,
          message.guildId ?? interaction.guildId,
          false,
          true,
        );
        await message.edit({
          components: payload.components,
          files: payload.files,
        });
        updatedAny = true;
      }
    } catch (err: unknown) {
      const error = err as { code?: number; rawError?: { code?: number } };
      const code = error?.code ?? error?.rawError?.code;
      if (code === 10008) {
        nowPlayingListContexts.delete(key);
        continue;
      }
      throw err;
    }
  }

  return updatedAny;
}

export function buildNowPlayingEntryComponents(
  entries: IMemberNowPlayingEntry[],
  ownerId: string,
  guildId: string | null,
  imageUrl: string | null,
  showPrivateOnlyJournalButtons: boolean = false,
  showHeaderEditHint: boolean = false,
  singleUserMode: boolean = false,
): NowPlayingListComponents {
  const container = new ContainerBuilder();
  if (imageUrl) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder()
          .setURL(imageUrl)
          .setDescription("Now Playing image"),
      ),
    );
    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false),
    );
  }
  if (singleUserMode) {
    const entryBlocks = entries.map((entry, index) => {
      const entryTitle = formatEntry(entry, guildId);
      const journalMark = entry.hasJournalEntry ? " \u{1F4D2}" : "";
      return `${index + 1}. ${entryTitle}${journalMark}`;
    });
    const combined = trimTextDisplayContent(entryBlocks.join("\n"));
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(safeV2TextContent(combined, 3500)),
    );
  } else {
    entries.forEach((entry, index) => {
      if (index === 0) {
        container.addSeparatorComponents(
          new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false),
        );
      }
      const entryTitle = formatEntry(entry, guildId);
      const journalMark = entry.hasJournalEntry ? " \u{1F4D2}" : "";
      const content = trimTextDisplayContent(`${index + 1}. ${entryTitle}${journalMark}`);
      const shouldShowJournalButton = entry.journalEnabled &&
        (showPrivateOnlyJournalButtons || entry.hasJournalEntry);
      if (shouldShowJournalButton) {
        const section = new SectionBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent(safeV2TextContent(content, 3500)),
        );
        section.setButtonAccessory(
          new V2ButtonBuilder()
            .setCustomId(`${NOW_PLAYING_JOURNAL_OPEN_PREFIX}:${ownerId}:${entry.gameId}:1`)
            .setLabel("Game Journal")
            .setStyle(ButtonStyle.Secondary),
        );
        container.addSectionComponents(section);
      } else {
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(safeV2TextContent(content, 3500)),
        );
      }
    });
  }
  if (showHeaderEditHint) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "-# *Note: List owner can use button in the header to maintain this list.*",
      ),
    );
  }
  return [container];
}

export function trimTextDisplayContent(content: string): string {
  if (content.length <= 4000) {
    return content;
  }
  return truncateWithEllipsis(content, 4000);
}

export function buildNowPlayingMemberSelect(
  lists: Array<{
    userId: string;
    username: string | null;
    globalName: string | null;
    entries: Array<unknown>;
  }>,
  selectedUserId?: string,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const sorted = [...lists].sort((a, b) => {
    const nameA = (a.globalName ?? a.username ?? a.userId).toLowerCase();
    const nameB = (b.globalName ?? b.username ?? b.userId).toLowerCase();
    return nameA.localeCompare(nameB);
  });

  const options = sorted.slice(0, DISCORD_SELECT_OPTIONS_MAX).map((record) => {
    const displayName = record.globalName ?? record.username ?? record.userId;
    return {
      label: truncateLabel(displayName),
      value: record.userId,
      description: `${record.entries.length} ${record.entries.length === 1 ? "game" : "games"}`,
      default: record.userId === selectedUserId,
    };
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId(NOW_PLAYING_ALL_SELECT_ID)
    .setPlaceholder("View a member's Now Playing list")
    .addOptions(options);

  return buildSelectRow(select);
}
