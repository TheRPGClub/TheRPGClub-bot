import {
  ApplicationCommandOptionType,
  type CommandInteraction,
  type User,
  AttachmentBuilder,
  MessageFlags,
  ComponentType,
  ModalBuilder,
  ModalSubmitInteraction,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputStyle,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
  type ActionRow,
  type MessageActionRowComponent,
  type Message,
  userMention,
} from "discord.js";
import {
  Discord,
  Slash,
  SlashOption,
  SlashGroup,
  SelectMenuComponent,
  ButtonComponent,
  ModalComponent,
} from "discordx";
import {
  ContainerBuilder,
  ModalBuilder as ComponentsModalBuilder,
  ActionRowBuilder as ComponentsActionRowBuilder,
  TextInputBuilder as ComponentsTextInputBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ButtonBuilder as V2ButtonBuilder,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import { SeparatorSpacingSize, TextInputStyle as ApiTextInputStyle } from "discord-api-types/v10";
import Member, { type IMemberNowPlayingEntry } from "../classes/Member.js";
import {
  extractErrorMessage,
  getModalField,
  isInteractionSettled,
  safeDeferReply,
  safeDeferUpdate,
  safeReply,
  safeUpdate,
  safeUserFetch,
  sanitizeUserInput,
  type AnyRepliable,
  replyIfNotOwner,
} from "../functions/InteractionUtils.js";
import Game, { type IGame } from "../classes/Game.js";
import { buildJournalView } from "../functions/journalView.js";
import {
  buildActionButton,
  buildButtonRow,
  buildTextInputRow,
  buildUserHeaderContainer,
  buildSelectRow,
} from "../functions/uiComponents.js";
import { igdbService } from "../services/IGDB/IgdbService.js";
import {
  createIgdbSession,
  type IgdbSelectOption,
} from "../services/IGDB/IgdbSelectService.js";
import {
  announceCompletion,
  notifyUnknownCompletionPlatform,
} from "../functions/CompletionHelpers.js";
import {
  buildComponentsV2Flags,
  buildComponentsV2EditFlags,
  buildTextContainer,
  buildTextReply,
  buildTitledContainer,
  safeV2TextContent,
} from "../functions/ComponentsV2Utils.js";
import {
  autocompleteGameCompletionPlatform,
  autocompleteGameCompletionTitle,
  resolveGameCompletionPlatformId,
} from "./game-completion/completion-autocomplete.utils.js";
import {
  COMPLETION_TYPES,
  type CompletionType,
  parseCompletionDateInput,
} from "../commands/profile.command.js";
import {
  formatDiscordTimestamp,
  formatPlaytimeHours,
  formatTableDate,
} from "../functions/DateFormatUtils.js";
import { parseTitleWithYear } from "../functions/GameTitleAutocompleteUtils.js";
import { STANDARD_PLATFORM_IDS } from "../config/standardPlatforms.js";
import {
  NOW_PLAYING_HELP_PREFIX,
  NOW_PLAYING_HELP_TEXTS,
} from "./now-playing-help.js";

import { renderUsernameWithEmoji } from "../services/UserEmojiService.js";
import {
  isPositiveInt,
  isValidPlaytimeHours,
} from "../utilities/ValidationUtils.js";
import { logError } from "../utilities/LogUtils.js";
import {
  DISCORD_AUTOCOMPLETE_DESC_MAX,
  DISCORD_SELECT_LABEL_MAX,
  DISCORD_SELECT_OPTIONS_MAX,
} from "../config/textLimits.js";
import { assertCustomIdSegments, parseCustomIdSegmentsMin } from "../utilities/CustomIdUtils.js";
import { safeIgnore } from "../utilities/AsyncUtils.js";

import {
  MAX_NOW_PLAYING_NOTE_LEN,
  NOW_PLAYING_SEARCH_LIMIT,
  NOW_PLAYING_SORT_SLOT_PREFIX,
  NOW_PLAYING_SORT_SAVE_PREFIX,
  NOW_PLAYING_SORT_RESET_PREFIX,
  NOW_PLAYING_NOTE_MODAL_ID,
  NOW_PLAYING_NOTE_INPUT_ID,
  NOW_PLAYING_NOTE_MODAL_MAX_FIELDS,
  NOW_PLAYING_ADD_MODAL_ID,
  NOW_PLAYING_ADD_TITLE_INPUT_ID,
  NOW_PLAYING_ADD_NOTE_INPUT_ID,
  NOW_PLAYING_ADD_PLATFORM_SELECT_PREFIX,
  NOW_PLAYING_EDIT_PLATFORM_SLOT_PREFIX,
  NOW_PLAYING_EDIT_PLATFORM_SAVE_PREFIX,
  NOW_PLAYING_EDIT_PLATFORM_RESET_PREFIX,
  NOW_PLAYING_COMPLETE_MODAL_ID,
  NOW_PLAYING_COMPLETE_DATE_INPUT_ID,
  NOW_PLAYING_COMPLETE_HOURS_INPUT_ID,
  NOW_PLAYING_COMPLETE_NOTE_INPUT_ID,
  NOW_PLAYING_COMPLETE_PICK_PREFIX,
  NOW_PLAYING_COMPLETE_TYPE_SELECT_PREFIX,
  NOW_PLAYING_COMPLETE_REMOVE_SELECT_PREFIX,
  NOW_PLAYING_COMPLETE_ANNOUNCE_SELECT_PREFIX,
  NOW_PLAYING_COMPLETE_NOTE_SELECT_PREFIX,
  NOW_PLAYING_COMPLETE_DETAILS_PREFIX,
  NOW_PLAYING_COMPLETE_PLATFORM_SELECT_PREFIX,
  NOW_PLAYING_GALLERY_MAX,
  NOW_PLAYING_LIST_EDIT_PREFIX,
  NOW_PLAYING_EDIT_MENU_START_JOURNAL_SELECT_PREFIX,
  NOW_PLAYING_REMOVE_SELECT_PREFIX,
  NOW_PLAYING_JOURNAL_ADD_PREFIX,
  NOW_PLAYING_JOURNAL_EDIT_PREFIX,
  NOW_PLAYING_JOURNAL_DELETE_PREFIX,
  NOW_PLAYING_JOURNAL_DELETE_SELECT_PREFIX,
  NOW_PLAYING_JOURNAL_DELETE_CONFIRM_PREFIX,
  NOW_PLAYING_JOURNAL_PAGE_PREFIX,
  NOW_PLAYING_JOURNAL_HEADER_PREFIX,
  NOW_PLAYING_JOURNAL_MODAL_ID,
  NOW_PLAYING_JOURNAL_EDIT_MODAL_ID,
  NOW_PLAYING_JOURNAL_TITLE_INPUT_ID,
  NOW_PLAYING_JOURNAL_BODY_INPUT_ID,
} from "./now-playing/nowPlayingIds.js";
import {
  type NowPlayingAddSession,
  type NowPlayingCompletionWizardSession,
  type NowPlayingCompletionPlatformSession,
  type NowPlayingListContext,
  type NowPlayingJournalContext,
} from "./now-playing/nowPlayingTypes.js";
import {
  nowPlayingAddSessions,
  nowPlayingAddPlatformSessions,
  nowPlayingCompletionWizardSessions,
  nowPlayingCompletionPlatformSessions,
  nowPlayingListContexts,
  nowPlayingJournalContexts,
  journalOwnerMenu,
  nowPlayingOwnerMenu,
  createNowPlayingCompletionWizardSession,
  clearNowPlayingAddSession,
  buildNowPlayingContextKey,
  trackNowPlayingListContext,
  setNowPlayingListContext,
  trackNowPlayingJournalContext,
  refreshJournalMessages,
  NOW_PLAYING_CONTEXT_TTL_MS,
  NOW_PLAYING_JOURNAL_CONTEXT_TTL_MS,
} from "./now-playing/nowPlayingContexts.js";
import {
  buildNowPlayingSortStateToken,
  parseNowPlayingSortStateToken,
  encodeNowPlayingSortState,
  parseNowPlayingPlatformStateToken,
  encodeNowPlayingPlatformState,
  buildNowPlayingPlatformStateFromCurrent,
  formatEntryTitleWithPlatform,
  getDisplayNowPlayingEntries,
} from "../functions/NowPlayingUtils.js";
import {
  buildNowPlayingListLines,
  buildNowPlayingListContainer,
  buildNowPlayingMessageContainer,
  buildComponentPayload,
  buildNowPlayingAttachments,
  buildNowPlayingListPayload,
  buildNowPlayingActionRow,
  buildNowPlayingManageRow,
  returnToNowPlayingEditMenu,
  buildNowPlayingEditInitialComponents,
  withPmNowPlayingList,
  withNowPlayingActions,
  hasDisplayableNowPlayingNotes,
  refreshNowPlayingListFromContext,
  trimTextDisplayContent,
  buildNowPlayingMemberSelect,
} from "./now-playing/nowPlayingListRenderer.js";

async function confirmDuplicateCompletion(
  interaction: CommandInteraction | ModalSubmitInteraction | ButtonInteraction,
  gameTitle: string,
  existing: Awaited<ReturnType<typeof Member.getRecentCompletionForGame>>,
): Promise<boolean> {
  if (!existing) return true;

  const promptId = `np-comp-dup:${interaction.user.id}`;
  const yesId = `${promptId}:yes`;
  const noId = `${promptId}:no`;
  const dateText = existing.completedAt
    ? formatDiscordTimestamp(existing.completedAt)
    : "No date";
  const playtimeText = formatPlaytimeHours(existing.finalPlaytimeHours);
  const detailParts = [existing.completionType, dateText, playtimeText].filter(Boolean);
  const noteLine = existing.note ? `\n> ${existing.note}` : "";

  const container = buildTextContainer(`We found a completion for **${gameTitle}** within the last week:\n` +
          `• ${detailParts.join(" - ")} (Completion #${existing.completionId})${noteLine}\n\n` +
          "Add another completion anyway?");
  const row = buildButtonRow(
    buildActionButton({ customId: yesId, label: "Add Another", style: ButtonStyle.Danger }),
    buildActionButton("cancel", noId),
  );

  const payload = {
    components: [container, row],
    flags: buildComponentsV2Flags(true),
  };

  let message: Message | null = null;
  try {
    if (isInteractionSettled(interaction)) {
      const reply = await safeReply(interaction, { ...payload, __forceFollowUp: true } as any);
      message = reply as Message;
    } else {
      const reply = await safeReply(interaction, { ...payload, withResponse: true } as any);
      message = reply.resource?.message ?? null;
    }
  } catch {
    try {
      const reply = await safeReply(interaction, { ...payload, __forceFollowUp: true } as any);
      message = reply as Message;
    } catch {
      return false;
    }
  }

  if (!message || typeof message.awaitMessageComponent !== "function") {
    return false;
  }

  try {
    const selection = await message.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i) =>
        i.user.id === interaction.user.id && i.customId.startsWith(promptId),
      time: 120_000,
    });
    const confirmed = selection.customId.endsWith(":yes");
    const resultContainer = buildTextContainer(confirmed ? "Adding another completion." : "Cancelled.");
    await safeUpdate(selection, {
      components: [resultContainer],
      flags: buildComponentsV2Flags(true),
    });
    return confirmed;
  } catch {
    return false;
  }
}

function buildEditNoteModal(
  ownerId: string,
  gameId: number,
  title: string,
  currentNote: string | null,
): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`${NOW_PLAYING_NOTE_MODAL_ID}:${ownerId}:${gameId}`)
    .setTitle("Edit Now Playing Note")
    .addComponents(buildTextInputRow({
      customId: NOW_PLAYING_NOTE_INPUT_ID,
      label: title.slice(0, 45),
      style: TextInputStyle.Paragraph,
      required: false,
      maxLength: MAX_NOW_PLAYING_NOTE_LEN,
      value: currentNote ?? "",
    }));
}

function buildEditNotesModal(
  ownerId: string,
  entries: Array<{
    gameId: number;
    title: string;
    platformName: string | null;
    platformAbbreviation: string | null;
    note: string | null;
  }>,
): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`${NOW_PLAYING_NOTE_MODAL_ID}:${ownerId}`)
    .setTitle("Edit Now Playing Notes");

  entries.forEach((entry) => {
    modal.addComponents(buildTextInputRow({
      customId: `${NOW_PLAYING_NOTE_INPUT_ID}:${entry.gameId}`,
      label: formatEntryTitleWithPlatform(entry).slice(0, 45),
      style: TextInputStyle.Paragraph,
      required: false,
      maxLength: MAX_NOW_PLAYING_NOTE_LEN,
      value: entry.note ?? "",
    }));
  });

  return modal;
}

@Discord()
@SlashGroup({ description: "Show now playing data", name: "now-playing" })
@SlashGroup("now-playing")
export class NowPlayingCommand {
  @Slash({ description: "Add a game to your now playing list", name: "add" })
  async addNowPlayingSlash(
    @SlashOption({
      autocomplete: autocompleteGameCompletionTitle,
      description: "Game title (autocomplete from GameDB)",
      name: "title",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    rawTitle: string,
    @SlashOption({
      autocomplete: autocompleteGameCompletionPlatform,
      description: "Platform (autocomplete from all GameDB platforms)",
      name: "platform",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    rawPlatform: string,
    @SlashOption({
      description: "Optional note",
      name: "note",
      required: false,
      type: ApplicationCommandOptionType.String,
      maxLength: MAX_NOW_PLAYING_NOTE_LEN,
    })
    rawNote: string | undefined,
    @SlashOption({
      description: "Show only to you",
      name: "private",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showPrivate: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const title = sanitizeUserInput(rawTitle, { preserveNewlines: false }).trim();
    const noteInput = sanitizeUserInput(rawNote ?? "", { preserveNewlines: true }).trim();
    const note = noteInput ? noteInput : null;
    const ephemeral = showPrivate === true;
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(ephemeral) });

    if (!title) {
      const container = buildTextContainer("Please provide a game title from autocomplete.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(ephemeral),
      });
      return;
    }

    const game = await this.resolveNowPlayingGameByTitle(title);
    if (!game) {
      const container = buildTextContainer(`I could not find a unique GameDB match for "${title}". Please choose from autocomplete.`);
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(ephemeral),
      });
      return;
    }

    const platformId = await resolveGameCompletionPlatformId(rawPlatform);
    if (!platformId) {
      const container = buildTextContainer("Please choose a platform from autocomplete.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(ephemeral),
      });
      return;
    }

    const platform = await Game.getPlatformById(platformId);
    if (!platform) {
      const container = buildTextContainer("Selected platform was not found.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(ephemeral),
      });
      return;
    }

    try {
      await Member.addNowPlaying(interaction.user.id, game.id, platformId, note);
      const trimmedNote = note?.trim();
      if (trimmedNote) {
        await Member.addGameJournalEntry({
          userId: interaction.user.id,
          gameId: game.id,
          body: trimmedNote,
        });
      }
    } catch (err: any) {
      const msg = extractErrorMessage(err);
      const container = buildTextContainer(`Could not add to Now Playing: ${msg}`);
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(ephemeral),
      });
      return;
    }

    const replacedCurrentChannelMessage = !ephemeral && interaction.channelId
      ? await this.replaceNowPlayingMessageInCurrentChannel(interaction, interaction.user.id)
      : false;
    safeIgnore(refreshNowPlayingListFromContext(interaction, interaction.user.id));
    if (replacedCurrentChannelMessage) {
      return;
    }
    await this.showSingle(interaction, interaction.user, ephemeral);
  }

  @Slash({ description: "Show now playing data", name: "list" })
  async nowPlaying(
    @SlashOption({
      description: "Member to view; defaults to you.",
      name: "member",
      required: false,
      type: ApplicationCommandOptionType.User,
    })
    member: User | undefined,
    @SlashOption({
      description: "Show everyone with Now Playing entries.",
      name: "all",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showAll: boolean | undefined,
    @SlashOption({
      description: "Show only to you",
      name: "private",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showPrivate: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const showAllFlag = showAll === true;
    const target = member ?? interaction.user;
    const ephemeral = showPrivate === true;
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(ephemeral) });

    if (!ephemeral) {
      await this.deleteEligibleNowPlayingMessageInCurrentChannel(
        interaction,
        showAllFlag
          ? (context) => context.view === "everyone" || context.view === "everyone-selected"
          : (context) => context.view === "single" && context.ownerUserId === target.id,
      );
    }

    if (showAllFlag) {
      await this.showEveryone(interaction, ephemeral);
      return;
    }

    await this.showSingle(interaction, target, ephemeral);
  }

  @Slash({ description: "Search for who is playing a GameDB title", name: "search" })
  async searchNowPlaying(
    @SlashOption({
      description: "Game title to search in GameDB",
      name: "title",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    title: string,
    @SlashOption({
      description: "Show only to you",
      name: "private",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showPrivate: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const query = sanitizeUserInput(title, { preserveNewlines: false });
    const ephemeral = showPrivate === true;
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(ephemeral) });

    if (!query) {
      const container = buildTextContainer("Please provide a title to search.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(ephemeral),
      });
      return;
    }

    const nowPlayingRows = await Member.getNowPlayingByTitleSearch(query);
    if (!nowPlayingRows.length) {
      const container = buildTextContainer(`No one is currently playing GameDB titles matching "${query}".`);
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(ephemeral),
      });
      return;
    }

    const usersByGameId = new Map<number, { title: string; users: string[] }>();
    for (const row of nowPlayingRows) {
      const record = usersByGameId.get(row.gameId) ?? { title: row.title, users: [] };
      record.users.push(userMention(row.userId));
      usersByGameId.set(row.gameId, record);
    }

    const sortedGames = Array.from(usersByGameId.entries())
      .map(([gameId, record]) => ({ gameId, title: record.title, users: record.users }))
      .sort((a, b) => a.title.localeCompare(b.title));
    const totalGames = sortedGames.length;
    const limitedGames = sortedGames.slice(0, NOW_PLAYING_SEARCH_LIMIT);

    const lines: string[] = [];
    for (const game of limitedGames) {
      const uniqueUsers = Array.from(new Set(game.users));
      const displayedUsers = uniqueUsers.slice(0, 30);
      const remaining = uniqueUsers.length - displayedUsers.length;
      const userList = `${displayedUsers.join(", ")}${remaining > 0 ? ` (+${remaining} more)` : ""}`;
      lines.push(`- **${game.title}**: ${userList}`);
    }

    const contentLines = [
      "## Now Playing Search",
      `Query: "**${query}**"`,
      ...lines,
    ];
    if (totalGames > limitedGames.length) {
      contentLines.push(
        "",
        `Showing first ${limitedGames.length} of ${totalGames} titles with active players.`,
      );
    }
    const content = trimTextDisplayContent(contentLines.join("\n"));
    const container = buildTextContainer(content);

    await safeReply(interaction, {
      components: [container],
      flags: buildComponentsV2Flags(ephemeral),
    });
  }

  @ModalComponent({ id: NOW_PLAYING_ADD_MODAL_ID })
  async handleAddNowPlayingModal(interaction: ModalSubmitInteraction): Promise<void> {
    const query = getModalField(interaction, NOW_PLAYING_ADD_TITLE_INPUT_ID);
    const noteRaw = getModalField(interaction, NOW_PLAYING_ADD_NOTE_INPUT_ID);
    if (!query) {
      const container = buildTextContainer("Please provide a title to search.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    if (noteRaw.length > MAX_NOW_PLAYING_NOTE_LEN) {
      const container = buildTextContainer(`Note must be ${MAX_NOW_PLAYING_NOTE_LEN} characters or fewer.`);
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    try {
      const results = await Game.searchGames(query);
      if (!results.length) {
        await this.startNowPlayingIgdbImportFromInteraction(
          interaction,
          {
            userId: interaction.user.id,
            query,
            note: noteRaw.length ? noteRaw : null,
          },
          "reply",
        );
        return;
      }
      const sessionId = `np-${interaction.user.id}`;
      const session: NowPlayingAddSession = {
        userId: interaction.user.id,
        query,
        note: noteRaw.length ? noteRaw : null,
      };
      nowPlayingAddSessions.set(sessionId, session);

      const options: Array<{ label: string; value: string; description?: string }> =
        results.slice(0, 23).map((g) => ({
        label: g.title.substring(0, 100),
        value: String(g.id),
      }));

      options.push({
        label: "Import another game from IGDB",
        value: "import-igdb",
        description: "Search IGDB and import a new GameDB entry",
      });

      const selectId = `nowplaying-add-select:${sessionId}`;
      const selectRow = buildSelectRow(
        new StringSelectMenuBuilder()
          .setCustomId(selectId)
          .setPlaceholder("Select the game to add")
          .addOptions(options),
      );

      const contentLines = [
        "## Now Playing Add",
        "Select a game to add to your Now Playing list:",
      ];
      if (results.length > options.length - 1) {
        contentLines.push(`Showing first ${options.length - 1} results.`);
      }
      const content = trimTextDisplayContent(contentLines.join("\n"));
      const container = buildTextContainer(content)
        .addActionRowComponents(selectRow.toJSON());

      const reply = await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
        withResponse: true,
      } as any);
      const replyMessage = reply?.resource?.message ?? null;

      session.timeoutId = setTimeout(async () => {
        try {
          if (!nowPlayingAddSessions.has(sessionId)) {
            return;
          }
          if (!replyMessage) {
            return;
          }
          const hasMatchingSelect = replyMessage.components.some(
            (row: ActionRow<MessageActionRowComponent>) => {
            if (!("components" in row)) return false;
            const actionRow = row as ActionRow<MessageActionRowComponent>;
            return actionRow.components.some(
              (component) =>
                "customId" in component && component.customId === selectId,
            );
          });
          if (!hasMatchingSelect) return;

          const timeoutContainer = buildTextContainer("Timed out waiting for a selection. No changes made.");
          await safeReply(interaction, {
            components: [timeoutContainer],
            flags: buildComponentsV2Flags(true),
          });
          clearNowPlayingAddSession(sessionId);
        } catch {
          // ignore
        }
      }, 60_000);
    } catch (err: any) {
      const msg = extractErrorMessage(err);
      const container = buildTextContainer(`Could not add to Now Playing: ${msg}`);
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
    }
  }

  private buildNowPlayingAddModal(): ModalBuilder {
    return new ModalBuilder()
      .setCustomId(NOW_PLAYING_ADD_MODAL_ID)
      .setTitle("Add Now Playing Game")
      .addComponents(
        buildTextInputRow({ customId: NOW_PLAYING_ADD_TITLE_INPUT_ID, label: "Game title", maxLength: 100 }),
        buildTextInputRow({
          customId: NOW_PLAYING_ADD_NOTE_INPUT_ID,
          label: "Note (optional)",
          style: TextInputStyle.Paragraph,
          required: false,
          maxLength: MAX_NOW_PLAYING_NOTE_LEN,
        }),
      );
  }

  private async resolveNowPlayingGameByTitle(searchTerm: string): Promise<IGame | null> {
    const parsed = parseTitleWithYear(searchTerm);
    const normalizedSearchTerm = parsed.title.trim();
    if (!normalizedSearchTerm) {
      return null;
    }

    const existing = await Game.searchGames(normalizedSearchTerm);
    const exact = existing.find((game) => {
      if (game.title.toLowerCase() !== normalizedSearchTerm.toLowerCase()) {
        return false;
      }
      if (parsed.year == null) {
        return true;
      }

      const releaseDate = game.initialReleaseDate instanceof Date
        ? game.initialReleaseDate
        : game.initialReleaseDate
          ? new Date(game.initialReleaseDate)
          : null;
      return releaseDate instanceof Date && !Number.isNaN(releaseDate.getTime())
        ? releaseDate.getFullYear() === parsed.year
        : false;
    });
    if (exact) {
      return exact;
    }
    if (existing.length === 1) {
      return existing[0] ?? null;
    }
    return null;
  }

  private buildNowPlayingCompletionConfigContainer(
    entry: IMemberNowPlayingEntry,
    sessionId: string,
    session: NowPlayingCompletionWizardSession,
    thumbnailUrl: string | null,
  ): ContainerBuilder {
    void thumbnailUrl;
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("## Add Completion"),
    );
    const headerLines = [`### ${formatEntryTitleWithPlatform(entry)}`];
    if (entry.note) {
      headerLines.push(`Current Note: ${entry.note}`);
    }
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        safeV2TextContent(trimTextDisplayContent(headerLines.join("\n")), 3500),
      ),
    );

    const typeSelect = new StringSelectMenuBuilder()
      .setCustomId(`${NOW_PLAYING_COMPLETE_TYPE_SELECT_PREFIX}:${sessionId}`)
      .setPlaceholder("Completion type")
      .addOptions(
        COMPLETION_TYPES.map((type) => ({
          label: type,
          value: type,
          default: type === session.completionType,
        })),
      );
    const removeSelect = new StringSelectMenuBuilder()
      .setCustomId(`${NOW_PLAYING_COMPLETE_REMOVE_SELECT_PREFIX}:${sessionId}`)
      .setPlaceholder("Remove from Now Playing?")
      .addOptions(
        {
          label: "Yes",
          value: "yes",
          default: session.removeFromNowPlaying,
        },
        {
          label: "No",
          value: "no",
          default: !session.removeFromNowPlaying,
        },
      );
    const announceSelect = new StringSelectMenuBuilder()
      .setCustomId(`${NOW_PLAYING_COMPLETE_ANNOUNCE_SELECT_PREFIX}:${sessionId}`)
      .setPlaceholder("Announce completion?")
      .addOptions(
        {
          label: "Yes",
          value: "yes",
          default: session.announce,
        },
        {
          label: "No",
          value: "no",
          default: !session.announce,
        },
      );
    const noteSelect = new StringSelectMenuBuilder()
      .setCustomId(`${NOW_PLAYING_COMPLETE_NOTE_SELECT_PREFIX}:${sessionId}`)
      .setPlaceholder("Add a Completion Note")
      .addOptions(
        {
          label: "Yes",
          value: "yes",
          default: session.addCompletionNote,
        },
        {
          label: "No",
          value: "no",
          default: !session.addCompletionNote,
        },
      );
    const detailsButton = buildActionButton({
      customId: `${NOW_PLAYING_COMPLETE_DETAILS_PREFIX}:${sessionId}`,
      label: "Continue",
      style: ButtonStyle.Primary,
    });
    const cancelButton = buildActionButton("cancel", `nowplaying-list-cancel:${session.userId}`);

    const typeRow = buildSelectRow(typeSelect);
    const removeRow = buildSelectRow(removeSelect);
    const announceRow = buildSelectRow(announceSelect);
    const noteRow = buildSelectRow(noteSelect);
    const helpButton = buildActionButton({
      customId: `${NOW_PLAYING_HELP_PREFIX}:completion-config:${session.userId}`,
      label: "?",
      style: ButtonStyle.Secondary,
    });
    const buttonRow = buildButtonRow(
      detailsButton,
      cancelButton,
      helpButton,
    );

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("Completion Type"),
    );
    container.addActionRowComponents(typeRow.toJSON());
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("Remove from Now Playing"),
    );
    container.addActionRowComponents(removeRow.toJSON());
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("Announce Completion"),
    );
    container.addActionRowComponents(announceRow.toJSON());
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("Add a Completion Note"),
    );
    container.addActionRowComponents(noteRow.toJSON());
    container.addActionRowComponents(buttonRow.toJSON());
    return container;
  }

  private async renderNowPlayingCompletionConfig(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
    sessionId: string,
    session: NowPlayingCompletionWizardSession,
  ): Promise<void> {
    const entries = await Member.getNowPlaying(session.userId);
    const entry = entries.find((item) => item.gameId === session.gameId);
    if (!entry) {
      const container = buildTextContainer("That game is no longer in your Now Playing list.");
      await safeUpdate(interaction, { components: [container] });
      return;
    }

    let thumbnailUrl: string | null = null;
    const files: AttachmentBuilder[] = [];
    const includeImages = interaction.guildId != null;
    const game = await Game.getGameById(entry.gameId);
    if (includeImages && game?.imageData) {
      const filename = `now_playing_completion_${entry.gameId}.png`;
      files.push(new AttachmentBuilder(game.imageData, { name: filename }));
      thumbnailUrl = `attachment://${filename}`;
    }

    const container = this.buildNowPlayingCompletionConfigContainer(
      entry,
      sessionId,
      session,
      thumbnailUrl,
    );
    const pmComponents = await withPmNowPlayingList(
      session.userId,
      interaction.guildId,
      [container],
    );
    if (files.length) {
      await safeUpdate(interaction, { components: pmComponents, files });
    } else {
      await safeUpdate(interaction, { components: pmComponents });
    }
  }

  private async promptNowPlayingCompletionPick(
    interaction: ButtonInteraction,
    ownerId: string,
    sessionId: string,
  ): Promise<void> {
    const current = await Member.getNowPlaying(ownerId);
    if (!current.length) {
      const container = buildTextContainer("Your Now Playing list is empty.");
      const pmComponents = await withPmNowPlayingList(
        ownerId, interaction.guildId, [container],
      );
      await safeUpdate(interaction, { components: pmComponents });
      return;
    }

    if (current.length === 1) {
      const session = nowPlayingCompletionWizardSessions.get(sessionId);
      const entry = current[0];
      if (!session || !entry?.gameId) {
        const container = buildTextContainer("Unable to start completion flow.");
        await safeUpdate(interaction, { components: [container] });
        return;
      }
      session.gameId = entry.gameId;
      await this.renderNowPlayingCompletionConfig(interaction, sessionId, session);
      return;
    }

    const entries = getDisplayNowPlayingEntries(current);
    const includeImages = interaction.guildId != null;
    const { files, thumbnailsByGameId } = await buildNowPlayingAttachments(
      entries,
      NOW_PLAYING_GALLERY_MAX,
      includeImages,
    );
    const components = this.buildNowPlayingCompletionComponents(
      entries,
      ownerId,
      sessionId,
      thumbnailsByGameId,
    );
    const pmComponents = await withPmNowPlayingList(ownerId, interaction.guildId, components);
    await safeUpdate(interaction, buildComponentPayload(pmComponents as any, files));
  }

  @ModalComponent({ id: /^nowplaying-complete-modal:[^:]+$/ })
  async handleNowPlayingCompletionModal(
    interaction: ModalSubmitInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(true) });
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [sessionId] = segs;
    const session = nowPlayingCompletionWizardSessions.get(sessionId);
    if (!session) {
      const container = buildTextContainer("This completion prompt has expired.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (await replyIfNotOwner(interaction, session.userId, "This completion prompt isn't for you.")) return;

    if (!session.gameId) {
      const container = buildTextContainer("Select a game first before submitting details.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const completionDateInput = getModalField(interaction, NOW_PLAYING_COMPLETE_DATE_INPUT_ID);
    const finalPlaytimeRaw = getModalField(interaction, NOW_PLAYING_COMPLETE_HOURS_INPUT_ID);
    const noteInput = session.addCompletionNote
      ? getModalField(interaction, NOW_PLAYING_COMPLETE_NOTE_INPUT_ID)
      : "";

    let completedAt: Date | null = null;
    try {
      completedAt = this.parseNowPlayingCompletionDate(completionDateInput);
    } catch (err: any) {
      const container = buildTextContainer(err?.message ?? "Invalid completion date.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const finalPlaytimeHours = finalPlaytimeRaw
      ? Number(finalPlaytimeRaw)
      : null;
    if (finalPlaytimeHours !== null && !isValidPlaytimeHours(finalPlaytimeHours)) {
      const container = buildTextContainer("Final playtime must be a non-negative number of hours.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const note = noteInput ? noteInput : null;

    const game = await Game.getGameById(session.gameId);
    if (!game) {
      const container = buildTextContainer("That game could not be found.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const referenceDate = completedAt ?? new Date();
    const recentCompletion = await Member.getRecentCompletionForGame(
      session.userId,
      session.gameId,
      referenceDate,
    );
    if (recentCompletion) {
      const confirmed = await confirmDuplicateCompletion(
        interaction,
        game.title,
        recentCompletion,
      );
      if (!confirmed) {
        return;
      }
    }

    const nowPlayingEntries = await Member.getNowPlaying(session.userId);
    const selectedEntry = nowPlayingEntries.find((item) => item.gameId === session.gameId);
    const existingPlatformId = selectedEntry?.platformId ?? null;
    if (existingPlatformId) {
      await this.finalizeNowPlayingCompletion(
        interaction,
        sessionId,
        {
          sessionId,
          userId: session.userId,
          gameId: game.id,
          completionType: session.completionType,
          completedAt,
          finalPlaytimeHours,
          note,
          removeFromNowPlaying: session.removeFromNowPlaying,
          announce: session.announce,
          returnToList: session.returnToList,
          platforms: [],
        },
        game,
        existingPlatformId,
      );
      return;
    }

    await this.promptNowPlayingCompletionPlatformSelection(
      interaction,
      sessionId,
      session,
      game,
      completedAt,
      finalPlaytimeHours,
      note,
    );
    return;
  }

  @SelectMenuComponent({ id: /^np-complete-platform:[^:]+$/ })
  async handleNowPlayingCompletionPlatformSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [platformSessionId] = segs;
    const session = nowPlayingCompletionPlatformSessions.get(platformSessionId);
    if (!session) {
      const container = buildTextContainer("This completion prompt has expired.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (await replyIfNotOwner(interaction, session.userId, "This completion prompt isn't for you.")) return;

    const selected = interaction.values?.[0];
    const isOther = selected === "other";
    let platformId: number | null = null;
    if (!isOther) {
      const parsedId = Number(selected);
      if (Number.isInteger(parsedId)) {
        platformId = parsedId;
      }
    }
    const valid = isOther || (
      platformId !== null &&
      session.platforms.some((platform) => platform.id === platformId)
    );
    if (!valid) {
      const container = buildTextContainer("Invalid platform selection.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    await safeDeferUpdate(interaction);
    nowPlayingCompletionPlatformSessions.delete(platformSessionId);

    const game = await Game.getGameById(session.gameId);
    if (!game) {
      const container = buildTextContainer("That game could not be found.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (isOther) {
      await notifyUnknownCompletionPlatform(interaction, game.title, game.id);
    }

    await this.finalizeNowPlayingCompletion(
      interaction,
      session.sessionId,
      session,
      game,
      platformId,
    );
  }

  private async promptNowPlayingCompletionPlatformSelection(
    interaction: ModalSubmitInteraction,
    sessionId: string,
    session: NowPlayingCompletionWizardSession,
    game: IGame,
    completedAt: Date | null,
    finalPlaytimeHours: number | null,
    note: string | null,
  ): Promise<void> {
    const platforms = await Game.getPlatformsForGameWithStandard(game.id, STANDARD_PLATFORM_IDS);
    if (!platforms.length) {
      const container = buildTextContainer("No platform data is available for this game.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const platformOptions = platforms.map((platform) => ({
      id: platform.id,
      name: platform.name,
    }));
    const platformSessionId = `np-comp-platform-${session.userId}`;
    nowPlayingCompletionPlatformSessions.set(platformSessionId, {
      sessionId,
      userId: session.userId,
      gameId: game.id,
      completionType: session.completionType,
      completedAt,
      finalPlaytimeHours,
      note,
      removeFromNowPlaying: session.removeFromNowPlaying,
      announce: session.announce,
      returnToList: session.returnToList,
      platforms: platformOptions,
    });

    const baseOptions = platformOptions.map((platform) => ({
      label: platform.name.slice(0, DISCORD_SELECT_LABEL_MAX),
      value: String(platform.id),
    }));
    const options = [
      ...baseOptions.slice(0, 24),
      { label: "Other", value: "other" },
    ];
    const select = new StringSelectMenuBuilder()
      .setCustomId(`${NOW_PLAYING_COMPLETE_PLATFORM_SELECT_PREFIX}:${platformSessionId}`)
      .setPlaceholder("Select the platform")
      .addOptions(options);
    const content = platformOptions.length > 24
      ? `Select the platform for **${game.title}** (showing first 24).`
      : `Select the platform for **${game.title}**.`;
    const container = buildTextContainer(content);
    await safeReply(interaction, {
      components: await withPmNowPlayingList(
        session.userId,
        interaction.guildId,
        [
          container,
          buildSelectRow(select),
        ],
      ),
      flags: buildComponentsV2Flags(true),
    });
  }

  private async finalizeNowPlayingCompletion(
    interaction: StringSelectMenuInteraction | ModalSubmitInteraction,
    sessionId: string,
    session: NowPlayingCompletionPlatformSession,
    game: IGame,
    platformId: number | null,
  ): Promise<void> {
    try {
      await Member.addCompletion({
        userId: session.userId,
        gameId: game.id,
        completionType: session.completionType,
        platformId,
        completedAt: session.completedAt,
        finalPlaytimeHours: session.finalPlaytimeHours,
        note: session.note,
      });
    } catch (err: any) {
      const msg = err?.message ?? "Failed to save completion.";
      const container = buildTextContainer(`Could not save completion: ${msg}`);
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (session.removeFromNowPlaying) {
      safeIgnore(Member.removeNowPlaying(session.userId, game.id));
    }

    if (session.announce) {
      await announceCompletion(
        interaction,
        session.userId,
        game,
        session.completionType,
        session.completedAt,
        session.finalPlaytimeHours,
      );
    }

    if (session.removeFromNowPlaying) {
      safeIgnore(refreshNowPlayingListFromContext(interaction, session.userId));
    }

    if (session.returnToList) {
      const entries = getDisplayNowPlayingEntries(
        await Member.getNowPlaying(session.userId),
      );
      if (!entries.length) {
        const container = buildTextContainer("Your Now Playing list is empty.");
        await safeReply(interaction, {
          components: [container],
          flags: buildComponentsV2Flags(true),
        });
      } else {
        const includeImages = interaction.guildId != null;
        const { files, thumbnailsByGameId } = await buildNowPlayingAttachments(
          entries,
          NOW_PLAYING_GALLERY_MAX,
          includeImages,
        );
        const components = this.buildNowPlayingCompletionComponents(
          entries,
          session.userId,
          sessionId,
          thumbnailsByGameId,
        );
        await safeReply(interaction, {
          ...buildComponentPayload(components, files),
          flags: buildComponentsV2Flags(true),
        });
      }
      return;
    }

    const detailLines = [
      "## Completion Added",
      `**Game:** ${game.title}`,
      `**Type:** ${session.completionType}`,
      `**Date:** ${formatTableDate(session.completedAt)}`,
    ];
    const playtimeText = formatPlaytimeHours(session.finalPlaytimeHours);
    if (playtimeText) {
      detailLines.push(`**Hours:** ${playtimeText}`);
    }
    if (session.note) {
      detailLines.push(`**Note:** ${session.note}`);
    }
    detailLines.push(
      `**Removed from Now Playing:** ${session.removeFromNowPlaying ? "Yes" : "No"}`,
      `**Announced:** ${session.announce ? "Yes" : "No"}`,
    );
    const content = trimTextDisplayContent(detailLines.join("\n"));
    const container = buildTextContainer(content);
    await safeReply(interaction, {
      components: [container],
      flags: buildComponentsV2Flags(true),
    });
    nowPlayingCompletionWizardSessions.delete(sessionId);
  }

  @ButtonComponent({ id: /^np-complete-pick:[^:]+:\d+$/ })
  async handleNowPlayingCompletionPick(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 2);
    if (!segs) return;
    const [sessionId, gameIdRaw] = segs;
    const session = nowPlayingCompletionWizardSessions.get(sessionId);
    if (!session) {
      const container = buildTextContainer("This completion prompt has expired.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (await replyIfNotOwner(interaction, session.userId, "This completion prompt isn't for you.")) return;

    const gameId = Number(gameIdRaw);
    if (!isPositiveInt(gameId)) {
      const container = buildTextContainer("Invalid selection.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    session.gameId = gameId;
    await this.renderNowPlayingCompletionConfig(interaction, sessionId, session);
  }

  @SelectMenuComponent({ id: /^np-complete-type:[^:]+$/ })
  async handleNowPlayingCompletionTypeSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [sessionId] = segs;
    const session = nowPlayingCompletionWizardSessions.get(sessionId);
    if (!session) {
      const container = buildTextContainer("This completion prompt has expired.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (await replyIfNotOwner(interaction, session.userId, "This completion prompt isn't for you.")) return;

    const value = interaction.values?.[0];
    if (!value || !COMPLETION_TYPES.includes(value as CompletionType)) {
      const container = buildTextContainer("Invalid completion type.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    session.completionType = value as CompletionType;
    await this.renderNowPlayingCompletionConfig(interaction, sessionId, session);
  }

  @SelectMenuComponent({ id: /^np-complete-remove:[^:]+$/ })
  async handleNowPlayingCompletionRemoveSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [sessionId] = segs;
    const session = nowPlayingCompletionWizardSessions.get(sessionId);
    if (!session) {
      const container = buildTextContainer("This completion prompt has expired.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (await replyIfNotOwner(interaction, session.userId, "This completion prompt isn't for you.")) return;

    const value = interaction.values?.[0];
    if (value !== "yes" && value !== "no") {
      const container = buildTextContainer("Invalid selection.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    session.removeFromNowPlaying = value === "yes";
    await this.renderNowPlayingCompletionConfig(interaction, sessionId, session);
  }

  @SelectMenuComponent({ id: /^np-complete-announce:[^:]+$/ })
  async handleNowPlayingCompletionAnnounceSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [sessionId] = segs;
    const session = nowPlayingCompletionWizardSessions.get(sessionId);
    if (!session) {
      const container = buildTextContainer("This completion prompt has expired.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (await replyIfNotOwner(interaction, session.userId, "This completion prompt isn't for you.")) return;

    const value = interaction.values?.[0];
    if (value !== "yes" && value !== "no") {
      const container = buildTextContainer("Invalid selection.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    session.announce = value === "yes";
    await this.renderNowPlayingCompletionConfig(interaction, sessionId, session);
  }

  @SelectMenuComponent({ id: /^np-complete-note:[^:]+$/ })
  async handleNowPlayingCompletionNoteSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [sessionId] = segs;
    const session = nowPlayingCompletionWizardSessions.get(sessionId);
    if (!session) {
      const container = buildTextContainer("This completion prompt has expired.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (await replyIfNotOwner(interaction, session.userId, "This completion prompt isn't for you.")) return;

    const value = interaction.values?.[0];
    if (value !== "yes" && value !== "no") {
      const container = buildTextContainer("Invalid selection.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    session.addCompletionNote = value === "yes";
    await this.renderNowPlayingCompletionConfig(interaction, sessionId, session);
  }

  @ButtonComponent({ id: /^np-complete-details:[^:]+$/ })
  async handleNowPlayingCompletionDetails(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [sessionId] = segs;
    const session = nowPlayingCompletionWizardSessions.get(sessionId);
    if (!session) {
      const container = buildTextContainer("This completion prompt has expired.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (await replyIfNotOwner(interaction, session.userId, "This completion prompt isn't for you.")) return;

    if (!session.gameId) {
      const container = buildTextContainer("Select a game first.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const entries = await Member.getNowPlaying(session.userId);
    const currentEntry = entries.find((entry) => entry.gameId === session.gameId);
    const noteValue = currentEntry?.note ?? "";

    const modal = new ModalBuilder()
      .setCustomId(`${NOW_PLAYING_COMPLETE_MODAL_ID}:${sessionId}`)
      .setTitle("Add Completion Details");
    const modalRows = [
      buildTextInputRow({
        customId: NOW_PLAYING_COMPLETE_DATE_INPUT_ID,
        label: "Completion date (blank unknown)",
        required: false,
        placeholder: "today or 03/10/2025",
      }),
      buildTextInputRow({
        customId: NOW_PLAYING_COMPLETE_HOURS_INPUT_ID,
        label: "Final playtime hours (optional)",
        required: false,
      }),
    ];
    if (session.addCompletionNote) {
      modalRows.push(buildTextInputRow({
        customId: NOW_PLAYING_COMPLETE_NOTE_INPUT_ID,
        label: "Note (optional)",
        style: TextInputStyle.Paragraph,
        required: false,
        maxLength: MAX_NOW_PLAYING_NOTE_LEN,
        value: noteValue ? noteValue.slice(0, MAX_NOW_PLAYING_NOTE_LEN) : undefined,
      }));
    }
    modal.addComponents(...modalRows);
    safeIgnore(interaction.showModal(modal));
  }

  @SelectMenuComponent({ id: /^nowplaying-add-select:.+$/ })
  async handleAddNowPlayingSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [sessionId] = segs;
    const session = nowPlayingAddSessions.get(sessionId);
    const ownerId = session?.userId;

    if (!session || interaction.user.id !== ownerId) {
      const container = buildTextContainer("This add prompt isn't for you.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const choice = interaction.values[0];
    if (choice === "import-igdb") {
      await this.startNowPlayingIgdbImport(interaction, session);
      return;
    }
    const gameId = Number(choice);
    if (!isPositiveInt(gameId)) {
      const container = buildTextContainer("Invalid selection. Please try again.");
      await safeUpdate(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      clearNowPlayingAddSession(sessionId);
      return;
    }

    try {
      await this.promptNowPlayingAddPlatformSelection(
        interaction,
        sessionId,
        ownerId,
        gameId,
        session.note,
        "update",
      );
    } catch (err: any) {
      const msg = extractErrorMessage(err);
      const container = buildTextContainer(`Could not add to Now Playing: ${msg}`);
      await safeUpdate(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      clearNowPlayingAddSession(sessionId);
    }
  }

  @SelectMenuComponent({ id: /^nowplaying-add-platform-select:[^:]+$/ })
  async handleAddNowPlayingPlatformSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [platformSessionId] = segs;
    const session = nowPlayingAddPlatformSessions.get(platformSessionId);
    if (!session) {
      const container = buildTextContainer("This platform prompt has expired.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (await replyIfNotOwner(interaction, session.userId, "This platform prompt isn't for you.")) return;

    const platformId = Number(interaction.values?.[0]);
    if (!isPositiveInt(platformId)) {
      const container = buildTextContainer("Invalid platform selection.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    await safeDeferUpdate(interaction);
    const loadingContainer = buildTextContainer("## Now Loading\nGenerating cover layout and loading the selected member list...");
    await safeUpdate(interaction, {
      components: [loadingContainer],
      flags: buildComponentsV2Flags(true),
    });

    try {
      await Member.addNowPlaying(session.userId, session.gameId, platformId, session.note);
      const trimmedSessionNote = session.note?.trim();
      if (trimmedSessionNote) {
        await Member.addGameJournalEntry({
          userId: session.userId,
          gameId: session.gameId,
          body: trimmedSessionNote,
        });
      }
      nowPlayingAddPlatformSessions.delete(platformSessionId);
      clearNowPlayingAddSession(session.sourceSessionId);
      const list = await Member.getNowPlaying(session.userId);
      const payload = await buildNowPlayingListPayload(
        interaction.user,
        list,
        interaction.guildId,
      );
      const refreshed = await refreshNowPlayingListFromContext(interaction, session.userId);
      if (refreshed) {
        return;
      } else {
        const components = withNowPlayingActions(
          true,
          session.userId,
          payload.components,
          false,
          hasDisplayableNowPlayingNotes(list),
        );
        await safeUpdate(interaction, {
          components,
          files: payload.files,
          flags: buildComponentsV2Flags(true),
        });
      }
    } catch (err: any) {
      const msg = extractErrorMessage(err);
      const container = buildTextContainer(`Could not add to Now Playing: ${msg}`);
      await safeUpdate(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      nowPlayingAddPlatformSessions.delete(platformSessionId);
      clearNowPlayingAddSession(session.sourceSessionId);
    }
  }

  private async promptNowPlayingAddPlatformSelection(
    interaction: StringSelectMenuInteraction,
    sourceSessionId: string,
    userId: string,
    gameId: number,
    note: string | null,
    mode: "reply" | "update",
  ): Promise<void> {
    const game = await Game.getGameById(gameId);
    if (!game) {
      throw new Error("Selected game not found. Please try again.");
    }
    const platforms = await Game.getPlatformsForGameWithStandard(game.id, STANDARD_PLATFORM_IDS);
    if (!platforms.length) {
      throw new Error("No platform data is available for this game.");
    }
    const platformSessionId = `np-add-platform-${userId}`;
    nowPlayingAddPlatformSessions.set(platformSessionId, {
      userId,
      gameId,
      note,
      sourceSessionId,
    });
    const options = platforms.slice(0, DISCORD_SELECT_OPTIONS_MAX).map((platform) => ({
      label: platform.name.slice(0, DISCORD_SELECT_LABEL_MAX),
      value: String(platform.id),
    }));
    const select = new StringSelectMenuBuilder()
      .setCustomId(`${NOW_PLAYING_ADD_PLATFORM_SELECT_PREFIX}:${platformSessionId}`)
      .setPlaceholder("Select the platform")
      .addOptions(options);
    const titleWithCap = platforms.length > options.length
      ? `Select the platform for **${game.title}** (showing first ${options.length}).`
      : `Select the platform for **${game.title}**.`;
    const container = buildTextContainer(titleWithCap);
    const payload = {
      components: [
        container,
        buildSelectRow(select),
      ],
      flags: buildComponentsV2Flags(true),
    };
    if (mode === "update") {
      await safeUpdate(interaction, payload);
    } else {
      await safeReply(interaction, payload);
    }
  }

  private async promptRemoveNowPlaying(
    interaction: AnyRepliable,
    mode: "reply" | "update" = "reply",
  ): Promise<void> {
    if (mode === "reply") {
      await safeDeferReply(interaction, { flags: buildComponentsV2Flags(true) });
    }
    const userId = interaction.user.id;
    const useDeferredEditPath = mode === "update" &&
      Boolean((interaction as any).__rpgDeferred ?? (interaction as any).deferred);
    const isEphemeral = mode === "update"
      ? ((interaction as any).message?.flags?.has(MessageFlags.Ephemeral) ?? false)
      : true;
    try {
      const entries = getDisplayNowPlayingEntries(await Member.getNowPlaying(userId));
      if (!entries.length) {
        const container = buildTextContainer("Your Now Playing list is empty.");
        const pmComponents = await withPmNowPlayingList(
          userId,
          interaction.guildId,
          [container],
        );
        if (mode === "update" && !useDeferredEditPath) {
          await safeUpdate(interaction, {
            components: pmComponents,
            flags: buildComponentsV2Flags(isEphemeral),
          });
        } else if (mode === "update") {
          await safeReply(interaction, {
            components: pmComponents,
            flags: buildComponentsV2Flags(true),
          });
        } else {
          await safeReply(interaction, {
            components: pmComponents,
            flags: buildComponentsV2Flags(true),
          });
        }
        return;
      }

      const includeImages = interaction.guildId != null;
      const { files, thumbnailsByGameId } = await buildNowPlayingAttachments(
        entries,
        NOW_PLAYING_GALLERY_MAX,
        includeImages,
      );
      const components = this.buildNowPlayingRemoveComponents(
        entries,
        userId,
        thumbnailsByGameId,
      );
      const pmComponents = await withPmNowPlayingList(
        userId,
        interaction.guildId,
        components,
      );
      if (mode === "update" && !useDeferredEditPath) {
        await safeUpdate(interaction, {
          ...buildComponentPayload(pmComponents as any, files),
          flags: buildComponentsV2Flags(isEphemeral),
        });
      } else if (mode === "update") {
        await safeReply(interaction, {
          ...buildComponentPayload(pmComponents as any, files),
          flags: buildComponentsV2Flags(true),
        });
      } else {
        await safeReply(interaction, {
          ...buildComponentPayload(pmComponents as any, files),
          flags: buildComponentsV2Flags(true),
        });
      }
    } catch (err: any) {
      const msg = extractErrorMessage(err);
      const container = buildTextContainer(`Could not remove from Now Playing: ${msg}`);
      const pmComponents = await withPmNowPlayingList(
        userId,
        interaction.guildId,
        [container],
      );
      if (mode === "update" && !useDeferredEditPath) {
        await safeUpdate(interaction, {
          components: pmComponents,
          flags: buildComponentsV2Flags(isEphemeral),
        });
      } else if (mode === "update") {
        await safeReply(interaction, {
          components: pmComponents,
          flags: buildComponentsV2Flags(true),
        });
      } else {
        await safeReply(interaction, {
          components: pmComponents,
          flags: buildComponentsV2Flags(true),
        });
      }
    }
  }

  private async promptSortNowPlayingButtons(
    interaction: ButtonInteraction,
    ownerId: string,
  ): Promise<void> {
    const isEphemeral = interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false;
    const entries = getDisplayNowPlayingEntries(
      await Member.getNowPlaying(ownerId),
    ).slice(0, 10);
    if (!entries.length) {
      const container = buildTextContainer("Your Now Playing list is empty.");
      const pmComponents = await withPmNowPlayingList(
        ownerId, interaction.guildId, [container],
      );
      await safeUpdate(interaction, {
        components: pmComponents,
        flags: buildComponentsV2Flags(isEphemeral),
      });
      return;
    }
    const stateToken = buildNowPlayingSortStateToken(entries.length);
    const components = this.buildNowPlayingSortComponents(entries, ownerId, stateToken);
    const pmComponents = await withPmNowPlayingList(
      ownerId,
      interaction.guildId,
      components,
    );
    await safeUpdate(interaction, {
      components: pmComponents,
      flags: buildComponentsV2Flags(isEphemeral),
    });
  }

  private parseNowPlayingCompletionDate(value: string): Date | null {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const normalized = trimmed.toLowerCase();
    if (normalized === "today") {
      return new Date();
    }
    if (normalized === "unknown" || normalized === "skip") {
      return null;
    }
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
    if (match) {
      const month = Number(match[1]);
      const day = Number(match[2]);
      const year = Number(match[3]);
      const parsed = new Date(year, month - 1, day);
      if (
        parsed.getFullYear() !== year ||
        parsed.getMonth() !== month - 1 ||
        parsed.getDate() !== day
      ) {
        throw new Error(
          "Could not parse completion date. Use MM/DD/YYYY, YYYY-MM-DD, 'today', or leave blank.",
        );
      }
      return parsed;
    }
    try {
      return parseCompletionDateInput(trimmed);
    } catch {
      throw new Error(
        "Could not parse completion date. Use MM/DD/YYYY, YYYY-MM-DD, 'today', or leave blank.",
      );
    }
  }

  private async promptEditNowPlayingNote(
    interaction: AnyRepliable,
    mode: "reply" | "update" = "reply",
  ): Promise<void> {
    if (mode === "reply") {
      await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    }

    const current = await Member.getNowPlayingEntries(interaction.user.id);
    if (!current.length) {
      const container = buildTextContainer("Your Now Playing list is empty.");
      const pmComponents = await withPmNowPlayingList(
        interaction.user.id,
        interaction.guildId,
        [container],
      );
      if (mode === "update" && "update" in interaction) {
        await safeUpdate(interaction, { 
          components: pmComponents, flags: buildComponentsV2Flags(true) });
      } else {
        await safeReply(interaction, {
          components: pmComponents,
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    if (!("showModal" in interaction)) {
      await safeReply(interaction, buildTextReply("Unable to open the note form right now.", true));
      return;
    }

    const editableEntries = current.filter((e) => !e.journalEnabled);
    if (!editableEntries.length) {
      const container = buildTextContainer("All of your games use Game Journal for notes.");
      const pmComponents = await withPmNowPlayingList(
        interaction.user.id,
        interaction.guildId,
        [container],
      );
      if (mode === "update" && "update" in interaction) {
        await safeUpdate(interaction, { 
          components: pmComponents, flags: buildComponentsV2Flags(true) });
      } else {
        await safeReply(interaction, {
          components: pmComponents,
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }
    const limitedEntries = editableEntries.slice(0, NOW_PLAYING_NOTE_MODAL_MAX_FIELDS);
    await interaction.showModal(
      buildEditNotesModal(interaction.user.id, limitedEntries),
    ).catch(async () => {
      await safeReply(interaction, buildTextReply("Unable to open the note form right now.", true));
    });

    if (editableEntries.length > NOW_PLAYING_NOTE_MODAL_MAX_FIELDS) {
      await safeReply(interaction, buildTextReply(`Discord modals support up to ${NOW_PLAYING_NOTE_MODAL_MAX_FIELDS} note fields at once. ` +
          "I opened the first set. Submit, then use Edit Notes again for the rest.", true));
    }
  }

  private async promptEditNowPlayingPlatform(
    interaction: AnyRepliable,
    mode: "reply" | "update" = "reply",
  ): Promise<void> {
    if (mode === "reply") {
      await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    }

    const entries = getDisplayNowPlayingEntries(await Member.getNowPlaying(interaction.user.id));
    if (!entries.length) {
      const container = buildTextContainer("Your Now Playing list is empty.");
      const pmComponents = await withPmNowPlayingList(
        interaction.user.id,
        interaction.guildId,
        [container],
      );
      if (mode === "update" && "update" in interaction) {
        await safeUpdate(interaction, { 
          components: pmComponents, flags: buildComponentsV2Flags(true) });
      } else {
        await safeReply(interaction, {
          components: pmComponents,
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    const platformOptions = await this.getNowPlayingEditPlatformOptions(entries);
    const stateToken = buildNowPlayingPlatformStateFromCurrent(entries, platformOptions);
    const components = this.buildNowPlayingEditPlatformComponents(
      entries,
      interaction.user.id,
      platformOptions,
      stateToken,
    );
    const pmComponents = await withPmNowPlayingList(
      interaction.user.id,
      interaction.guildId,
      components,
    );

    if (mode === "update" && "update" in interaction) {
      await safeUpdate(interaction, {
        components: pmComponents,
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    await safeReply(interaction, {
      components: pmComponents,
      flags: buildComponentsV2Flags(true),
    });
  }

  private async getNowPlayingEditPlatformOptions(
    entries: IMemberNowPlayingEntry[],
  ): Promise<Array<Array<{ label: string; value: string; platformId: number }>>> {
    const limitedEntries = entries.slice(0, 10);
    const optionsPerEntry = await Promise.all(
      limitedEntries.map(async (entry) => {
        const platforms = await Game.getPlatformsForGameWithStandard(
          entry.gameId,
          STANDARD_PLATFORM_IDS,
        );
        const uniqueById = new Map<number, { id: number; name: string }>();
        platforms.forEach((platform) => {
          if (!uniqueById.has(platform.id)) {
            uniqueById.set(platform.id, platform);
          }
        });
        const deduped = Array.from(uniqueById.values()).slice(0, DISCORD_SELECT_OPTIONS_MAX);
        if (!deduped.length && entry.platformId) {
          deduped.push({
            id: entry.platformId,
            name: entry.platformName ?? "Current Platform",
          });
        }
        return deduped.map((platform, optionIndex) => ({
          label: platform.name.slice(0, DISCORD_SELECT_LABEL_MAX),
          value: String(optionIndex),
          platformId: platform.id,
        }));
      }),
    );
    return optionsPerEntry;
  }

  private async promptNowPlayingEditPlatformSelection(
    interaction: AnyRepliable,
    ownerId: string,
    gameId: number,
    mode: "reply" | "update" = "reply",
  ): Promise<void> {
    const game = await Game.getGameById(gameId);
    if (!game) {
      const container = buildTextContainer("That game could not be found.");
      if (mode === "update" && "update" in interaction) {
        await safeUpdate(interaction, { 
          components: [container], flags: buildComponentsV2Flags(true) });
      } else {
        await safeReply(interaction, {
          components: [container],
          flags: buildComponentsV2Flags(true),
        });
      }
      return;
    }

    const platforms = await Game.getPlatformsForGameWithStandard(gameId, STANDARD_PLATFORM_IDS);
    if (!platforms.length) {
      const container = buildTextContainer("No platform data is available for this game.");
      if (mode === "update" && "update" in interaction) {
        await safeUpdate(interaction, { 
          components: [container], flags: buildComponentsV2Flags(true) });
      } else {
        await safeReply(interaction, {
          components: [container],
          flags: buildComponentsV2Flags(true),
        });
      }
      return;
    }

    const options = platforms.slice(0, DISCORD_SELECT_OPTIONS_MAX).map((platform) => ({
      label: platform.name.slice(0, DISCORD_SELECT_LABEL_MAX),
      value: String(platform.id),
    }));
    const select = new StringSelectMenuBuilder()
      .setCustomId(`nowplaying-edit-platform-select:${ownerId}:${gameId}`)
      .setPlaceholder("Select the platform")
      .addOptions(options);
    const content = platforms.length > options.length
      ? `Select the platform for **${game.title}** (showing first ${options.length}).`
      : `Select the platform for **${game.title}**.`;
    const container = buildTextContainer(content);
    const payload = {
      components: [
        container,
        buildSelectRow(select),
      ],
      flags: buildComponentsV2Flags(true),
    };
    const pmComponents = await withPmNowPlayingList(
      ownerId,
      interaction.guildId,
      payload.components,
    );
    if (mode === "update" && "update" in interaction) {
      await safeUpdate(interaction, { ...payload, components: pmComponents });
    } else {
      await safeReply(interaction, { ...payload, components: pmComponents });
    }
  }

  @SelectMenuComponent({ id: /^nowplaying-edit-platform-select:\d+:\d+$/ })
  async handleNowPlayingEditPlatformSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 2);
    if (!segs) return;
    const [ownerId, gameIdRaw] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This platform prompt isn't for you.")) return;

    const gameId = Number(gameIdRaw);
    const platformId = Number(interaction.values?.[0]);
    if (!isPositiveInt(gameId) || !isPositiveInt(platformId)) {
      await safeReply(interaction, buildTextReply("Invalid platform selection.", true));
      return;
    }

    const updated = await Member.updateNowPlayingPlatform(ownerId, gameId, platformId);
    if (!updated) {
      await safeReply(interaction, buildTextReply("Could not update that platform.", true));
      return;
    }

    safeIgnore(refreshNowPlayingListFromContext(interaction, ownerId));
    await returnToNowPlayingEditMenu(interaction, ownerId);
  }

  @SelectMenuComponent({ id: /^nowplaying-edit-platform-slot:\d+:\d+:[a-z0-9_]+$/ })
  async handleEditPlatformSlot(interaction: StringSelectMenuInteraction): Promise<void> {
    const isEphemeral = interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false;
    const segs = assertCustomIdSegments(interaction, 3);
    if (!segs) return;
    const [ownerId, slotRaw, stateToken] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This platform prompt isn't for you.")) return;

    const slotIndex = Number(slotRaw);
    const selectedOptionIndex = Number(interaction.values?.[0]);
    if (
      !Number.isInteger(slotIndex) ||
      slotIndex < 0 ||
      !Number.isInteger(selectedOptionIndex) ||
      selectedOptionIndex < 0
    ) {
      await safeReply(interaction, buildTextReply("Invalid selection.", true));
      return;
    }

    const entries = getDisplayNowPlayingEntries(await Member.getNowPlaying(ownerId)).slice(0, 10);
    const platformOptions = await this.getNowPlayingEditPlatformOptions(entries);
    const parsed = parseNowPlayingPlatformStateToken(stateToken, entries.length);
    if (!parsed || slotIndex >= entries.length || selectedOptionIndex > 24) {
      await safeReply(interaction, buildTextReply("This platform form has expired. Open Edit Platform again.", true));
      return;
    }
    if (selectedOptionIndex >= (platformOptions[slotIndex]?.length ?? 0)) {
      await safeReply(interaction, buildTextReply("Invalid platform selection for that game.", true));
      return;
    }

    parsed[slotIndex] = selectedOptionIndex;
    const components = this.buildNowPlayingEditPlatformComponents(
      entries,
      ownerId,
      platformOptions,
      encodeNowPlayingPlatformState(parsed),
    );
    const pmComponents = await withPmNowPlayingList(ownerId, interaction.guildId, components);
    await safeUpdate(interaction, {
      components: pmComponents,
      flags: buildComponentsV2Flags(isEphemeral),
    });
  }

  @SelectMenuComponent({ id: /^nowplaying-edit-note-select:\d+$/ })
  async handleEditNoteSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This note prompt isn't for you.")) return;

    const gameId = Number(interaction.values?.[0]);
    if (!isPositiveInt(gameId)) {
      await safeReply(interaction, buildTextReply("Invalid selection.", true));
      return;
    }

    const currentEntries = await Member.getNowPlayingEntries(ownerId);
    const currentEntry = currentEntries.find((entry) => entry.gameId === gameId);
    if (!currentEntry) {
      await safeReply(interaction, buildTextReply("Entry not found.", true));
      return;
    }

    await interaction.showModal(
      buildEditNoteModal(
        ownerId,
        gameId,
        formatEntryTitleWithPlatform(currentEntry),
        currentEntry.note ?? null,
      ),
    ).catch(async () => {
      await safeReply(interaction, buildTextReply("Unable to open the note form right now.", true));
    });
  }

  @ButtonComponent({ id: /^nowplaying-edit-note-direct:\d+:\d+$/ })
  async handleEditNoteDirect(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 2);
    if (!segs) return;
    const [ownerId, gameIdRaw] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This note prompt isn't for you.")) return;
    const gameId = Number(gameIdRaw);
    if (!isPositiveInt(gameId)) {
      await safeReply(interaction, buildTextReply("Invalid selection.", true));
      return;
    }
    const currentEntries = await Member.getNowPlayingEntries(ownerId);
    const currentEntry = currentEntries.find((entry) => entry.gameId === gameId);
    if (!currentEntry) {
      await safeReply(interaction, buildTextReply("Entry not found.", true));
      return;
    }
    if (currentEntry.journalEnabled) {
      await safeReply(interaction, buildTextReply("This game uses Game Journal for notes. Use the Journal button to add entries.", true));
      return;
    }
    setNowPlayingListContext(ownerId, interaction.message);
    await interaction.showModal(
      buildEditNoteModal(
        ownerId,
        gameId,
        formatEntryTitleWithPlatform(currentEntry),
        currentEntry.note ?? null,
      ),
    ).catch(async () => {
      await safeReply(interaction, buildTextReply("Unable to open the note form right now.", true));
    });
  }

  @SelectMenuComponent({ id: /^nowplaying-sort-slot:\d+:\d+:[a-z0-9_]+$/ })
  async handleNowPlayingSortSlot(interaction: StringSelectMenuInteraction): Promise<void> {
    const isEphemeral = interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false;
    const segs = assertCustomIdSegments(interaction, 3);
    if (!segs) return;
    const [ownerId, slotRaw, stateToken] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This sort prompt isn't for you.")) return;

    const slotIndex = Number(slotRaw);
    if (!Number.isInteger(slotIndex) || slotIndex < 0) {
      const container = buildTextContainer("Invalid selection.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    try {
      const entries = getDisplayNowPlayingEntries(await Member.getNowPlaying(ownerId)).slice(0, 10);
      const parsed = parseNowPlayingSortStateToken(stateToken, entries.length);
      const selectedValue = interaction.values[0] ?? "";
      const selectedIndex = Number(selectedValue);
      if (
        !parsed ||
        !Number.isInteger(selectedIndex) ||
        selectedIndex < 0 ||
        selectedIndex >= entries.length ||
        slotIndex >= entries.length
      ) {
        const container = buildTextContainer("This sort form has expired. Open Sort again.");
        await safeUpdate(interaction, {
          components: [container],
          flags: buildComponentsV2Flags(isEphemeral),
        });
        return;
      }

      for (let i = 0; i < parsed.length; i += 1) {
        if (i !== slotIndex && parsed[i] === selectedIndex) {
          parsed[i] = -1;
        }
      }
      parsed[slotIndex] = selectedIndex;
      const components = this.buildNowPlayingSortComponents(
        entries,
        ownerId,
        encodeNowPlayingSortState(parsed),
      );
      const pmComponents = await withPmNowPlayingList(
        ownerId, interaction.guildId, components,
      );
      await safeUpdate(interaction, {
        components: pmComponents,
        flags: buildComponentsV2Flags(isEphemeral),
      });
    } catch {
      const container = buildTextContainer("Could not update the sort form right now.");
      safeIgnore(safeUpdate(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(isEphemeral),
      }));
    }
  }

  @ButtonComponent({ id: /^nowplaying-sort-save:\d+:[a-z0-9_]+$/ })
  async handleNowPlayingSortSave(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 2);
    if (!segs) return;
    const [ownerId, stateToken] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This sort prompt isn't for you.")) return;
    await safeDeferUpdate(interaction);
    const isEphemeral = interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false;
    const responseFlags = buildComponentsV2Flags(isEphemeral);

    const entries = getDisplayNowPlayingEntries(await Member.getNowPlaying(ownerId)).slice(0, 10);
    const parsed = parseNowPlayingSortStateToken(stateToken, entries.length);
    if (!parsed) {
      const container = buildTextContainer("This sort form has expired. Open Sort again.");
      const pmComponents = await withPmNowPlayingList(
        ownerId, interaction.guildId, [container],
      );
      await safeReply(interaction, { components: pmComponents, flags: responseFlags });
      return;
    }
    if (parsed.some((value) => value < 0)) {
      const components = this.buildNowPlayingSortComponents(
        entries,
        ownerId,
        stateToken,
        "Assign a title to every visible position before saving.",
      );
      const pmComponents = await withPmNowPlayingList(
        ownerId, interaction.guildId, components,
      );
      await safeReply(interaction, { components: pmComponents, flags: responseFlags });
      return;
    }
    if (new Set(parsed).size !== parsed.length) {
      const components = this.buildNowPlayingSortComponents(
        entries,
        ownerId,
        stateToken,
        "Each title can only be used once. Remove duplicate assignments and try again.",
      );
      const pmComponents = await withPmNowPlayingList(
        ownerId, interaction.guildId, components,
      );
      await safeReply(interaction, { components: pmComponents, flags: responseFlags });
      return;
    }

    const loadingContainer = buildTextContainer("## Now Loading\nSaving sort order and generating cover layout...");
    await safeUpdate(interaction, { components: [loadingContainer], flags: responseFlags });

    const orderedIds = parsed.map((index) => entries[index].gameId);
    const updated = await Member.updateNowPlayingSort(ownerId, orderedIds);
    if (!updated) {
      const container = buildTextContainer("Could not update the sort order.");
      const pmComponents = await withPmNowPlayingList(
        ownerId, interaction.guildId, [container],
      );
      await safeReply(interaction, { components: pmComponents, flags: responseFlags });
      return;
    }

    safeIgnore(refreshNowPlayingListFromContext(interaction, ownerId));
    await returnToNowPlayingEditMenu(interaction, ownerId);
  }

  @ButtonComponent({ id: /^nowplaying-sort-reset:\d+$/ })
  async handleNowPlayingSortReset(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This sort prompt isn't for you.")) return;
    await safeDeferUpdate(interaction);
    const isEphemeral = interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false;
    const responseFlags = buildComponentsV2Flags(isEphemeral);
    const entries = getDisplayNowPlayingEntries(await Member.getNowPlaying(ownerId)).slice(0, 10);
    const stateToken = buildNowPlayingSortStateToken(entries.length);
    const components = this.buildNowPlayingSortComponents(entries, ownerId, stateToken);
    const pmComponents = await withPmNowPlayingList(ownerId, interaction.guildId, components);
    await safeReply(interaction, { components: pmComponents, flags: responseFlags });
  }

  @ModalComponent({ id: /^nowplaying-note-modal:\d+(?::\d+)?$/ })
  async handleEditNoteModal(interaction: ModalSubmitInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const segs = parseCustomIdSegmentsMin(interaction.customId, 1);
    if (!segs) return;
    const [ownerId, legacyGameIdRaw = null] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This note prompt isn't for you.")) return;

    let updated = false;
    if (legacyGameIdRaw) {
      const gameId = Number(legacyGameIdRaw);
      if (!isPositiveInt(gameId)) {
        await safeReply(interaction, buildTextReply("Invalid selection.", true));
        return;
      }

      const noteInput = getModalField(interaction, NOW_PLAYING_NOTE_INPUT_ID);
      const note = noteInput.trim();
      const nextNote = note ? note : null;
      if (note && note.length > MAX_NOW_PLAYING_NOTE_LEN) {
        await safeReply(interaction, buildTextReply(`Note must be ${MAX_NOW_PLAYING_NOTE_LEN} characters or fewer.`, true));
        return;
      }

      updated = await Member.updateNowPlayingNote(ownerId, gameId, nextNote);
    } else {
      const currentEntries = await Member.getNowPlayingEntries(ownerId);
      const updateCandidates = currentEntries.slice(0, NOW_PLAYING_NOTE_MODAL_MAX_FIELDS);

      for (const entry of updateCandidates) {
        if (!entry.gameId || entry.journalEnabled) {
          continue;
        }
        const fieldId = `${NOW_PLAYING_NOTE_INPUT_ID}:${entry.gameId}`;
        let noteInput = "";
        try {
          noteInput = getModalField(interaction, fieldId);
        } catch {
          noteInput = "";
        }
        const note = noteInput.trim();
        if (note.length > MAX_NOW_PLAYING_NOTE_LEN) {
          await safeReply(interaction, buildTextReply(`Note must be ${MAX_NOW_PLAYING_NOTE_LEN} characters or fewer.`, true));
          return;
        }
        const nextNote = note ? note : null;
        const changed = await Member.updateNowPlayingNote(ownerId, entry.gameId, nextNote);
        updated = changed || updated;
      }
    }
    if (updated) {
      const refreshed = await refreshNowPlayingListFromContext(interaction, ownerId);
      if (!interaction.guildId && interaction.message) {
        try {
          const dmComponents = await buildNowPlayingEditInitialComponents(ownerId);
          await interaction.message.edit({
            components: dmComponents,
            flags: buildComponentsV2Flags(false),
          });
          safeIgnore(interaction.deleteReply());
          return;
        } catch {
          // Fall through to existing fallback response if DM message edit fails.
        }
      }
      if (refreshed) {
        safeIgnore(interaction.deleteReply());
        return;
      }
      const list = await Member.getNowPlaying(ownerId);
      const payload = await buildNowPlayingListPayload(
        interaction.user,
        list,
        interaction.guildId,
      );
      const components = withNowPlayingActions(
        true,
        ownerId,
        payload.components,
        false,
        hasDisplayableNowPlayingNotes(list),
      );
      await safeReply(interaction, {
        components,
        files: payload.files,
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    await safeReply(interaction, buildTextReply("Could not update that entry.", true));
  }

  @SelectMenuComponent({ id: /^nowplaying-delete-note-select:\d+$/ })
  async handleDeleteNoteSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This note prompt isn't for you.")) return;

    const gameId = Number(interaction.values?.[0]);
    if (!isPositiveInt(gameId)) {
      await safeReply(interaction, buildTextReply("Invalid selection.", true));
      return;
    }

    const currentEntries = await Member.getNowPlayingEntries(ownerId);
    const currentEntry = currentEntries.find((entry) => entry.gameId === gameId);
    const currentNote = currentEntry?.note ? currentEntry.note : "No note set.";
    if (!currentEntry) {
      await safeReply(interaction, buildTextReply("Entry not found.", true));
      return;
    }

    const noteBody = currentEntry.note ? `> ${currentNote}` : "No note set.";
    const container = buildTitledContainer(`Delete Note: ${currentEntry.title}`, noteBody);

    const row = buildButtonRow(
      buildActionButton("delete", `nowplaying-delete-note-confirm:${ownerId}:${gameId}:yes`, "Delete Note"),
      buildActionButton("cancel", `nowplaying-delete-note-confirm:${ownerId}:${gameId}:no`),
    );

    await safeUpdate(interaction, {
      components: [container, row],
      flags: buildComponentsV2EditFlags(),
    });
  }

  @ButtonComponent({ id: /^nowplaying-delete-note-confirm:\d+:\d+:(yes|no)$/ })
  async handleDeleteNoteConfirm(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 3);
    if (!segs) return;
    const [ownerId, gameIdRaw, choice] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This note prompt isn't for you.")) return;

    if (choice === "no") {
      safeIgnore(safeUpdate(interaction, {
        content: "Cancelled.",
        components: [],
      }));
      return;
    }

    const gameId = Number(gameIdRaw);
    if (!isPositiveInt(gameId)) {
      await safeReply(interaction, buildTextReply("Invalid selection.", true));
      return;
    }

    const updated = await Member.updateNowPlayingNote(ownerId, gameId, null);
    safeIgnore(safeUpdate(interaction, {
      content: updated ? "Note deleted." : "Could not update that entry.",
      components: [],
    }));
  }

  @ButtonComponent({ id: /^np-remove:[^:]+:\d+$/ })
  async handleRemoveNowPlayingButton(interaction: ButtonInteraction): Promise<void> {
    const isEphemeral = interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false;
    const segs = assertCustomIdSegments(interaction, 2);
    if (!segs) return;
    const [ownerId, gameIdRaw] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This remove prompt isn't for you.")) return;

    const gameId = Number(gameIdRaw);
    if (!isPositiveInt(gameId)) {
      const container = buildTextContainer("Invalid selection.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    try {
      const removed = await Member.removeNowPlaying(ownerId, gameId);
      if (!removed) {
        const container = buildTextContainer("Failed to remove that game (it may have been removed already).");
        await safeReply(interaction, {
          components: [container],
          flags: buildComponentsV2Flags(true),
        });
        return;
      }
      safeIgnore(refreshNowPlayingListFromContext(interaction, ownerId));

      const entries = getDisplayNowPlayingEntries(await Member.getNowPlaying(ownerId));
      if (!entries.length) {
        const container = buildTextContainer("Your Now Playing list is empty.");
        await safeUpdate(interaction, {
          components: [container],
          flags: buildComponentsV2Flags(isEphemeral),
        });
        return;
      }
      const includeImages = interaction.guildId != null;
      const { files, thumbnailsByGameId } = await buildNowPlayingAttachments(
        entries,
        NOW_PLAYING_GALLERY_MAX,
        includeImages,
      );
      const components = this.buildNowPlayingRemoveComponents(
        entries,
        ownerId,
        thumbnailsByGameId,
      );
      const pmComponents = await withPmNowPlayingList(
        ownerId,
        interaction.guildId,
        components,
      );
      await safeUpdate(interaction, {
        ...buildComponentPayload(pmComponents as any, files),
        flags: buildComponentsV2Flags(isEphemeral),
      });
    } catch (err: any) {
      const msg = extractErrorMessage(err);
      const container = buildTextContainer(`Could not remove from Now Playing: ${msg}`);
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
    }
  }

  @ButtonComponent({ id: /^nowplaying-list-notes:\d+:(show|hide)$/ })
  async handleNowPlayingListNotesToggle(interaction: ButtonInteraction): Promise<void> {
    await safeDeferUpdate(interaction);

    const segs = assertCustomIdSegments(interaction, 2);
    if (!segs) return;
    const [ownerId, action] = segs;
    const showNotes = action === "show";
    const isEphemeral = interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false;
    const contextKey = buildNowPlayingContextKey(
      interaction.message.channelId, interaction.message.id,
    );
    const trackedView = nowPlayingListContexts.get(contextKey)?.view ?? null;
    const singleUserMode = trackedView === "single" || trackedView === "everyone-selected";
    const ownerUser =
      interaction.user.id === ownerId
        ? interaction.user
        : await safeUserFetch(interaction.client, ownerId);
    const target = ownerUser ?? interaction.user;
    const title = ownerId === interaction.user.id && isEphemeral
      ? "Your Now Playing List"
      : `${target.displayName ?? target.username ?? "User"}'s Now Playing List`;
    const entries = getDisplayNowPlayingEntries(await Member.getNowPlaying(ownerId));

    if (!entries.length) {
      const emptyMessage = ownerId === interaction.user.id
        ? "Your Now Playing list is empty."
        : `No Now Playing entries found for ${userMention(ownerId)}.`;
      const container = buildNowPlayingMessageContainer(
        title,
        emptyMessage,
      );
      const actionRow = buildNowPlayingActionRow(
        ownerId,
        showNotes,
        hasDisplayableNowPlayingNotes(entries),
        !singleUserMode,
      );
      await safeReply(interaction, {
        components: actionRow ? [container, actionRow] : [container],
        flags: buildComponentsV2Flags(isEphemeral),
      });
      return;
    }

    const payload = await buildNowPlayingListPayload(
      target,
      entries,
      interaction.guildId,
      showNotes,
      false,
      singleUserMode,
    );
    const components = withNowPlayingActions(
      !singleUserMode,
      ownerId,
      payload.components,
      showNotes,
      hasDisplayableNowPlayingNotes(entries),
      !singleUserMode,
    );
    await safeReply(interaction, {
      components,
      files: payload.files,
      flags: buildComponentsV2Flags(isEphemeral),
    });
  }

  private async buildManageJournalButtonRow(
    ownerId: string,
    gameId: number,
    page: number,
  ): Promise<ActionRowBuilder<ButtonBuilder>> {
    const entries = await Member.getGameJournalEntries(ownerId, gameId, { limit: 1, offset: 0 });
    const hasEntries = entries.length > 0;
    return buildButtonRow(
      buildActionButton("add", `${NOW_PLAYING_JOURNAL_ADD_PREFIX}:${ownerId}:${gameId}:${page}`, "Add Entry"),
      buildActionButton("edit", `${NOW_PLAYING_JOURNAL_EDIT_PREFIX}:${ownerId}:${gameId}:${page}`, "Edit Entry")
        .setDisabled(!hasEntries),
      buildActionButton("delete", `${NOW_PLAYING_JOURNAL_DELETE_PREFIX}:${ownerId}:${gameId}:${page}`, "Delete Entry")
        .setDisabled(!hasEntries),
    );
  }

  @ButtonComponent({ id: /^nowplaying-journal-header:\d+:\d+:\d+$/ })
  async handleNowPlayingJournalHeader(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 3);
    if (!segs) return;
    const [ownerId, gameIdRaw, pageRaw] = segs;
    if (interaction.user.id !== ownerId) {
      await safeDeferUpdate(interaction);
      return;
    }
    const gameId = Number(gameIdRaw);
    const page = Number(pageRaw);
    const row = await this.buildManageJournalButtonRow(ownerId, gameId, page);
    await journalOwnerMenu.show(interaction, ownerId, [row]);
  }

  @ButtonComponent({ id: /^nowplaying-journal-open:\d+:\d+:\d+$/ })
  async handleNowPlayingJournalOpen(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 3);
    if (!segs) return;
    const [ownerId, gameIdRaw, pageRaw] = segs;
    const gameId = Number(gameIdRaw);
    const nowPlayingEntries = getDisplayNowPlayingEntries(await Member.getNowPlaying(ownerId));
    const selected = nowPlayingEntries.find((entry) => entry.gameId === Number(gameIdRaw));
    if (!selected?.journalEnabled) {
      await safeReply(interaction, buildTextReply("Journal is not enabled for this game.", true));
      return;
    }
    if (interaction.guildId && !selected.hasJournalEntry) {
      await safeReply(interaction, buildTextReply("This game's journal has no public entries to show in channel.", true));
      return;
    }
    const payload = await this.buildJournalComponents(
      ownerId,
      interaction.guildId ? "__public__" : interaction.user.id,
      gameId,
      Number(pageRaw),
      interaction.guildId,
      interaction.user.id === ownerId,
    );
    if (interaction.guildId) {
      await this.deleteLatestJournalMessageInChannel(interaction, ownerId, gameId);
    }
    const reply = await safeReply(interaction, {
      components: payload.components,
      files: payload.files,
      flags: buildComponentsV2Flags(
        interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false,
      ),
      allowedMentions: payload.allowedMentions,
      withResponse: true,
    } as any);
    await this.trackJournalReply(reply?.resource?.message ?? null, ownerId, gameId);
  }

  @SelectMenuComponent({ id: /^nowplaying-journal-view-select:\d+$/ })
  async handleNowPlayingJournalViewSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    const gameId = Number(interaction.values?.[0]);
    if (!gameId) return;
    const nowPlayingEntries = getDisplayNowPlayingEntries(await Member.getNowPlaying(ownerId));
    const selected = nowPlayingEntries.find((e) => e.gameId === gameId);
    if (!selected?.journalEnabled || !selected.hasJournalEntry) {
      await safeReply(interaction, buildTextReply("This game has no public journal entries.", true));
      return;
    }
    const payload = await this.buildJournalComponents(
      ownerId,
      interaction.guildId ? "__public__" : interaction.user.id,
      gameId,
      1,
      interaction.guildId,
      interaction.user.id === ownerId,
    );
    if (interaction.guildId) {
      await this.deleteLatestJournalMessageInChannel(interaction, ownerId, gameId);
    }
    const reply = await safeReply(interaction, {
      components: payload.components,
      files: payload.files,
      flags: buildComponentsV2Flags(
        interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false,
      ),
      allowedMentions: payload.allowedMentions,
      withResponse: true,
    } as any);
    await this.trackJournalReply(reply?.resource?.message ?? null, ownerId, gameId);
  }

  @ButtonComponent({ id: /^nowplaying-journal-page:\d+:\d+:(prev|next):\d+$/ })
  async handleNowPlayingJournalPage(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 4);
    if (!segs) return;
    const [ownerId, gameIdRaw, , pageRaw] = segs;
    const gameId = Number(gameIdRaw);
    const nowPlayingEntries = getDisplayNowPlayingEntries(await Member.getNowPlaying(ownerId));
    const selected = nowPlayingEntries.find((entry) => entry.gameId === Number(gameIdRaw));
    if (!selected?.journalEnabled) {
      await safeReply(interaction, buildTextReply("Journal is not enabled for this game.", true));
      return;
    }
    if (interaction.guildId && !selected.hasJournalEntry) {
      await safeReply(interaction, buildTextReply("This game's journal has no public entries to show in channel.", true));
      return;
    }
    const payload = await this.buildJournalComponents(
      ownerId,
      interaction.guildId ? "__public__" : interaction.user.id,
      gameId,
      Number(pageRaw),
      interaction.guildId,
      interaction.user.id === ownerId,
    );
    if (interaction.guildId) {
      await this.deleteLatestJournalMessageInChannel(interaction, ownerId, gameId);
    }
    const reply = await safeReply(interaction, {
      components: payload.components,
      files: payload.files,
      flags: buildComponentsV2Flags(
        interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false,
      ),
      allowedMentions: payload.allowedMentions,
      withResponse: true,
    } as any);
    await this.trackJournalReply(reply?.resource?.message ?? null, ownerId, gameId);
  }

  @ButtonComponent({ id: /^nowplaying-journal-add:\d+:\d+:\d+$/ })
  async handleNowPlayingJournalAdd(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 3);
    if (!segs) return;
    const [ownerId, gameIdRaw, pageRaw] = segs;
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("Only the owner can add journal entries.", false));
      return;
    }
    const modal = new ComponentsModalBuilder()
      .setCustomId(`${NOW_PLAYING_JOURNAL_MODAL_ID}:${ownerId}:${gameIdRaw}:${pageRaw}`)
      .setTitle("Add Journal Entry");
    modal.addActionRowComponents(
      new ComponentsActionRowBuilder<ComponentsTextInputBuilder>().addComponents(
        new ComponentsTextInputBuilder()
          .setCustomId(NOW_PLAYING_JOURNAL_TITLE_INPUT_ID)
          .setLabel("Title (optional)")
          .setStyle(ApiTextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(120),
      ),
      new ComponentsActionRowBuilder<ComponentsTextInputBuilder>().addComponents(
        new ComponentsTextInputBuilder()
          .setCustomId(NOW_PLAYING_JOURNAL_BODY_INPUT_ID)
          .setLabel("Entry")
          .setStyle(ApiTextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(2000),
      ),
    );
    await interaction.showModal(modal);
    await journalOwnerMenu.dismiss(ownerId);
  }

  @ButtonComponent({ id: /^nowplaying-journal-edit:\d+:\d+:\d+$/ })
  async handleNowPlayingJournalEdit(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 3);
    if (!segs) return;
    const [ownerId, gameIdRaw, pageRaw] = segs;
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("Only the owner can edit journal entries.", false));
      return;
    }
    const gameId = Number(gameIdRaw);
    const page = Number(pageRaw);
    const offset = Math.max(0, page - 1);
    const entries = await Member.getGameJournalEntries(ownerId, gameId, { limit: 1, offset });
    if (!entries.length) {
      await safeReply(interaction, buildTextReply("No journal entries available to edit.", false));
      return;
    }
    const entry = entries[0];
    const modal = new ComponentsModalBuilder()
      .setCustomId(`${NOW_PLAYING_JOURNAL_EDIT_MODAL_ID}:${ownerId}:${gameIdRaw}:${pageRaw}:${entry.entryId}`)
      .setTitle("Edit Journal Entry");
    modal.addActionRowComponents(
      new ComponentsActionRowBuilder<ComponentsTextInputBuilder>().addComponents(
        new ComponentsTextInputBuilder()
          .setCustomId(NOW_PLAYING_JOURNAL_TITLE_INPUT_ID)
          .setLabel("Title (optional)")
          .setStyle(ApiTextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(120)
          .setValue((entry.title ?? "").slice(0, 120)),
      ),
      new ComponentsActionRowBuilder<ComponentsTextInputBuilder>().addComponents(
        new ComponentsTextInputBuilder()
          .setCustomId(NOW_PLAYING_JOURNAL_BODY_INPUT_ID)
          .setLabel("Entry")
          .setStyle(ApiTextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(2000)
          .setValue(entry.body.slice(0, 2000)),
      ),
    );
    await interaction.showModal(modal);
  }

  @ButtonComponent({ id: /^nowplaying-journal-delete:\d+:\d+:\d+$/ })
  async handleNowPlayingJournalDelete(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 3);
    if (!segs) return;
    const [ownerId, gameIdRaw, pageRaw] = segs;
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("Only the owner can delete journal entries.", false));
      return;
    }
    const gameId = Number(gameIdRaw);
    const page = Number(pageRaw);
    const offset = (Math.max(1, page) - 1) * 5;
    const entries = await Member.getGameJournalEntries(ownerId, gameId, { limit: 5, offset });
    if (!entries.length) {
      await safeReply(interaction, buildTextReply("No journal entries available to delete.", false));
      return;
    }
    const options = entries.map((entry) => ({
      label: (entry.title ?? `Entry #${entry.entryNumber}`).slice(0, DISCORD_SELECT_LABEL_MAX),
      value: String(entry.entryId),
      description: formatTableDate(entry.createdAt),
    }));
    const select = new StringSelectMenuBuilder()
      .setCustomId(`${NOW_PLAYING_JOURNAL_DELETE_SELECT_PREFIX}:${ownerId}:${gameId}:${page}`)
      .setPlaceholder("Choose an entry to delete")
      .addOptions(options);
    const row = buildSelectRow(select);
    const container = buildTextContainer("## Delete Journal Entry\nSelect an entry to delete.");
    const helpRow = buildButtonRow(
      buildActionButton({ customId: `${NOW_PLAYING_HELP_PREFIX}:journal-delete:${ownerId}`, label: "?", style: ButtonStyle.Secondary }),
    );
    await safeUpdate(interaction, {
      components: [container, row, helpRow],
      flags: buildComponentsV2Flags(
        interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false,
      ),
    });
  }

  @SelectMenuComponent({ id: /^nowplaying-journal-delete-select:\d+:\d+:\d+$/ })
  async handleNowPlayingJournalDeleteSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 3);
    if (!segs) return;
    const [ownerId, gameIdRaw, pageRaw] = segs;
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("Only the owner can delete journal entries.", false));
      return;
    }
    const entryId = Number(interaction.values[0]);
    const entry = await Member.getGameJournalEntryForUser(ownerId, entryId);
    if (!entry || entry.gameId !== Number(gameIdRaw)) {
      await safeReply(interaction, buildTextReply("That journal entry was not found.", false));
      return;
    }
    const entryTitle = entry.title?.trim() ? entry.title.trim() : `Entry #${entry.entryNumber}`;
    const container = buildTextContainer(`## Confirm Delete\nDelete **${entryTitle}** from ${formatTableDate(entry.createdAt)}?`);
    const row = buildButtonRow(
      buildActionButton(
        "delete",
        `${NOW_PLAYING_JOURNAL_DELETE_CONFIRM_PREFIX}:yes:${ownerId}:${gameIdRaw}:${pageRaw}:${entryId}`,
      ),
      buildActionButton(
        "cancel",
        `${NOW_PLAYING_JOURNAL_DELETE_CONFIRM_PREFIX}:no:${ownerId}:${gameIdRaw}:${pageRaw}:${entryId}`,
      ),
      buildActionButton({ customId: `${NOW_PLAYING_HELP_PREFIX}:journal-delete-confirm:${ownerId}`, label: "?", style: ButtonStyle.Secondary }),
    );
    await safeUpdate(interaction, {
      components: [container, row],
      flags: buildComponentsV2Flags(
        interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false,
      ),
    });
  }

  @ButtonComponent({ id: /^nowplaying-journal-delete-confirm:(yes|no):\d+:\d+:\d+:\d+$/ })
  async handleNowPlayingJournalDeleteConfirm(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 5);
    if (!segs) return;
    const [action, ownerId, gameIdRaw, pageRaw, entryIdRaw] = segs;
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("Only the owner can delete journal entries.", false));
      return;
    }
    if (action === "yes") {
      const removed = await Member.deleteGameJournalEntry(ownerId, Number(entryIdRaw));
      if (!removed) {
        await safeReply(interaction, buildTextReply("That journal entry was not found.", false));
        return;
      }
    }
    const row = await this.buildManageJournalButtonRow(ownerId, Number(gameIdRaw), Number(pageRaw));
    await safeUpdate(interaction, {
      components: [row],
      flags: buildComponentsV2Flags(
        interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false,
      ),
    });
    if (action === "yes") {
      await refreshJournalMessages(
        interaction.client, ownerId, Number(gameIdRaw), interaction.message.id,
      );
    }
  }

  @ModalComponent({ id: /^nowplaying-journal-modal:\d+:\d+:\d+$/ })
  async handleNowPlayingJournalModal(interaction: ModalSubmitInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 3);
    if (!segs) return;
    const [ownerId, gameIdRaw, pageRaw] = segs;
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("Only the owner can submit journal entries.", false));
      return;
    }
    const title = sanitizeUserInput(
      interaction.fields.getTextInputValue(NOW_PLAYING_JOURNAL_TITLE_INPUT_ID) ?? "",
      { preserveNewlines: true, maxLength: 120 },
    );
    const body = sanitizeUserInput(
      interaction.fields.getTextInputValue(NOW_PLAYING_JOURNAL_BODY_INPUT_ID),
      { preserveNewlines: true, maxLength: 2000 },
    );
    const gameId = Number(gameIdRaw);
    const hasExistingTracked = Array.from(nowPlayingJournalContexts.values())
      .some((ctx) => ctx.ownerUserId === ownerId && ctx.gameId === gameId);
    await Member.addGameJournalEntry({
      userId: ownerId,
      gameId,
      title: title || null,
      body,
    });
    await Member.upsertGameJournalPreference(ownerId, gameId, true);
    const page = Number(pageRaw);
    const row = await this.buildManageJournalButtonRow(ownerId, gameId, page);
    if (!hasExistingTracked && interaction.guildId) {
      // First entry: post the journal message first so it appears before the manage buttons.
      // Skip journalOwnerMenu here to avoid its deletor pointing at the journal post.
      await this.deleteLatestJournalMessageInChannel(interaction, ownerId, gameId);
      const payload = await this.buildJournalComponents(
        ownerId,
        "__public__",
        gameId,
        page,
        interaction.guildId,
        true,
      );
      const reply = await safeReply(interaction, {
        components: payload.components as any[],
        files: payload.files,
        flags: buildComponentsV2Flags(false),
        allowedMentions: payload.allowedMentions,
        withResponse: true,
      } as any);
      await this.trackJournalReply(reply?.resource?.message ?? null, ownerId, gameId);
      await safeReply(interaction, {
        components: [row],
        flags: buildComponentsV2Flags(true),
        __forceFollowUp: true,
      });
    } else {
      await journalOwnerMenu.show(interaction, ownerId, [row]);
      await refreshJournalMessages(interaction.client, ownerId, gameId);
    }
  }

  @ModalComponent({ id: /^nowplaying-journal-edit-modal:\d+:\d+:\d+:\d+$/ })
  async handleNowPlayingJournalEditModal(interaction: ModalSubmitInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 4);
    if (!segs) return;
    const [ownerId, gameIdRaw, pageRaw, entryIdRaw] = segs;
    const gameId = Number(gameIdRaw);
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("Only the owner can edit journal entries.", false));
      return;
    }

    const entryId = Number(entryIdRaw);
    const existing = await Member.getGameJournalEntryForUser(ownerId, entryId);
    if (!existing || existing.gameId !== gameId) {
      await safeReply(interaction, buildTextReply("That journal entry was not found.", false));
      return;
    }

    const title = sanitizeUserInput(
      interaction.fields.getTextInputValue(NOW_PLAYING_JOURNAL_TITLE_INPUT_ID) ?? "",
      { preserveNewlines: true, maxLength: 120 },
    );
    const body = sanitizeUserInput(
      interaction.fields.getTextInputValue(NOW_PLAYING_JOURNAL_BODY_INPUT_ID),
      { preserveNewlines: true, maxLength: 2000 },
    );
    await Member.updateGameJournalEntry({ userId: ownerId, entryId, title: title || null, body });
    const page = Number(pageRaw);
    const row = await this.buildManageJournalButtonRow(ownerId, gameId, page);
    await safeReply(interaction, {
      components: [row],
      flags: buildComponentsV2Flags(true),
    });
    await refreshJournalMessages(interaction.client, ownerId, gameId);
  }

  @ButtonComponent({ id: /^nowplaying-list-edit:\d+$/ })
  async handleNowPlayingListEdit(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "Only the owner of this Now Playing list can use Edit.")) return;

    setNowPlayingListContext(ownerId, interaction.message);
    await nowPlayingOwnerMenu.show(
      interaction,
      ownerId,
      [await buildNowPlayingManageRow(ownerId)],
    );
  }

  @ButtonComponent({ id: /^nowplaying-help:[a-z-]+:\d+$/ })
  async handleNowPlayingHelp(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 2);
    if (!segs) return;
    const [screenType, ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This help button isn't for you.")) return;
    const helpText = NOW_PLAYING_HELP_TEXTS[screenType]
      ?? "No help available for this screen.";
    const container = buildTextContainer(helpText);
    await safeReply(interaction, {
      components: [container],
      flags: buildComponentsV2Flags(true),
    });
  }

  @ButtonComponent({ id: /^nowplaying-edit-menu-sort:\d+$/ })
  async handleNowPlayingEditMenuSort(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This edit menu isn't for you.")) return;
    await this.promptSortNowPlayingButtons(interaction, ownerId);
  }

  @ButtonComponent({ id: /^nowplaying-edit-menu-platform:\d+$/ })
  async handleNowPlayingEditMenuPlatform(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This edit menu isn't for you.")) return;
    await this.promptEditNowPlayingPlatform(interaction, "update");
  }

  @ButtonComponent({ id: /^nowplaying-edit-menu-complete:\d+$/ })
  async handleNowPlayingEditMenuComplete(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This edit menu isn't for you.")) return;
    const sessionId = createNowPlayingCompletionWizardSession(ownerId, true);
    await this.promptNowPlayingCompletionPick(interaction, ownerId, sessionId);
  }

  @ButtonComponent({ id: /^nowplaying-edit-menu-remove:\d+$/ })
  async handleNowPlayingEditMenuRemove(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This edit menu isn't for you.")) return;
    await this.promptRemoveNowPlaying(interaction, "update");
  }

  @ButtonComponent({ id: /^nowplaying-edit-menu-start-journal:\d+$/ })
  async handleNowPlayingEditMenuStartJournal(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This edit menu isn't for you.")) return;
    const entries = await Member.getNowPlaying(ownerId).then(getDisplayNowPlayingEntries);
    const gamesWithoutJournal = entries.filter((e) => !e.hasJournalEntry);
    if (!gamesWithoutJournal.length) {
      await safeUpdate(interaction, {
        components: [await buildNowPlayingManageRow(ownerId)],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    const options = gamesWithoutJournal.map((e) => ({
      label: e.title.slice(0, DISCORD_SELECT_LABEL_MAX),
      value: String(e.gameId),
    }));
    const select = new StringSelectMenuBuilder()
      .setCustomId(`${NOW_PLAYING_EDIT_MENU_START_JOURNAL_SELECT_PREFIX}:${ownerId}`)
      .setPlaceholder("Select a game to start a journal")
      .addOptions(options);
    const selectRow = buildSelectRow(select);
    const container = buildTextContainer("## Start a Game Journal\nSelect a game to write your first entry.");
    await safeUpdate(interaction, {
      components: [container, selectRow],
      flags: buildComponentsV2Flags(true),
    });
  }

  @SelectMenuComponent({ id: /^nowplaying-edit-menu-start-journal-select:\d+$/ })
  async handleNowPlayingEditMenuStartJournalSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This edit menu isn't for you.")) return;
    const gameId = Number(interaction.values[0]);
    if (!gameId) return;
    const entries = await Member.getNowPlaying(ownerId).then(getDisplayNowPlayingEntries);
    const selected = entries.find((e) => e.gameId === gameId);
    if (!selected || selected.hasJournalEntry) {
      await safeUpdate(interaction, {
        components: [await buildNowPlayingManageRow(ownerId)],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    const modal = new ComponentsModalBuilder()
      .setCustomId(`${NOW_PLAYING_JOURNAL_MODAL_ID}:${ownerId}:${gameId}:1`)
      .setTitle("Add Journal Entry");
    modal.addActionRowComponents(
      new ComponentsActionRowBuilder<ComponentsTextInputBuilder>().addComponents(
        new ComponentsTextInputBuilder()
          .setCustomId(NOW_PLAYING_JOURNAL_TITLE_INPUT_ID)
          .setLabel("Title (optional)")
          .setStyle(ApiTextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(120),
      ),
      new ComponentsActionRowBuilder<ComponentsTextInputBuilder>().addComponents(
        new ComponentsTextInputBuilder()
          .setCustomId(NOW_PLAYING_JOURNAL_BODY_INPUT_ID)
          .setLabel("Entry")
          .setStyle(ApiTextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(2000),
      ),
    );
    await interaction.showModal(modal);
    await nowPlayingOwnerMenu.dismiss(ownerId);
  }

  @ButtonComponent({ id: /^nowplaying-list-add:\d+$/ })
  async handleNowPlayingListAdd(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This add prompt isn't for you.")) return;
    setNowPlayingListContext(ownerId, interaction.message);
    safeIgnore(interaction.showModal(this.buildNowPlayingAddModal()));
  }

  @ButtonComponent({ id: /^nowplaying-list-edit-platform:\d+$/ })
  async handleNowPlayingListEditPlatform(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This platform prompt isn't for you.")) return;
    setNowPlayingListContext(ownerId, interaction.message);
    await this.promptEditNowPlayingPlatform(interaction, "update");
  }

  @ButtonComponent({ id: /^np-edit-platform:\d+:\d+$/ })
  async handleNowPlayingEditPlatformPick(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 2);
    if (!segs) return;
    const [ownerId, gameIdRaw] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This platform prompt isn't for you.")) return;
    const gameId = Number(gameIdRaw);
    if (!isPositiveInt(gameId)) {
      await safeReply(interaction, buildTextReply("Invalid selection.", true));
      return;
    }
    await this.promptNowPlayingEditPlatformSelection(interaction, ownerId, gameId, "update");
  }

  @ButtonComponent({ id: /^nowplaying-edit-platform-save:\d+:[a-z0-9_]+$/ })
  async handleNowPlayingEditPlatformSave(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 2);
    if (!segs) return;
    const [ownerId, stateToken] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This platform prompt isn't for you.")) return;

    await safeDeferUpdate(interaction);
    const isEphemeral = interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false;
    const responseFlags = buildComponentsV2Flags(isEphemeral);
    const entries = getDisplayNowPlayingEntries(await Member.getNowPlaying(ownerId)).slice(0, 10);
    const platformOptions = await this.getNowPlayingEditPlatformOptions(entries);
    const parsed = parseNowPlayingPlatformStateToken(stateToken, entries.length);
    if (!parsed) {
      await safeReply(
        interaction,
        buildTextReply("This platform form has expired. Open Edit Platform again.", isEphemeral),
      );
      return;
    }
    if (parsed.some((value) => value < 0)) {
      const components = this.buildNowPlayingEditPlatformComponents(
        entries,
        ownerId,
        platformOptions,
        stateToken,
        "Assign a platform for every visible game before saving.",
      );
      const pmComponents = await withPmNowPlayingList(
        ownerId, interaction.guildId, components,
      );
      await safeReply(interaction, { components: pmComponents, flags: responseFlags });
      return;
    }

    for (let slotIndex = 0; slotIndex < entries.length; slotIndex += 1) {
      const selectedOptionIndex = parsed[slotIndex];
      const option = platformOptions[slotIndex]?.[selectedOptionIndex];
      const gameId = entries[slotIndex]?.gameId;
      if (!option || !gameId) {
        await safeReply(
          interaction,
          buildTextReply(
            "One or more selected platforms are invalid. Please review and try again.",
            isEphemeral,
          ),
        );
        return;
      }
      const updated = await Member.updateNowPlayingPlatform(ownerId, gameId, option.platformId);
      if (!updated) {
        await safeReply(
          interaction,
          buildTextReply(
            `Could not update platform for ${entries[slotIndex].title}.`,
            isEphemeral,
          ),
        );
        return;
      }
    }
    safeIgnore(refreshNowPlayingListFromContext(interaction, ownerId));
    await returnToNowPlayingEditMenu(interaction, ownerId);
  }

  @ButtonComponent({ id: /^nowplaying-edit-platform-reset:\d+$/ })
  async handleNowPlayingEditPlatformReset(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This platform prompt isn't for you.")) return;
    await safeDeferUpdate(interaction);
    const isEphemeral = interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false;
    const responseFlags = buildComponentsV2Flags(isEphemeral);
    const entries = getDisplayNowPlayingEntries(await Member.getNowPlaying(ownerId)).slice(0, 10);
    const platformOptions = await this.getNowPlayingEditPlatformOptions(entries);
    const stateTokenReset = buildNowPlayingPlatformStateFromCurrent(entries, platformOptions);
    const components = this.buildNowPlayingEditPlatformComponents(
      entries,
      ownerId,
      platformOptions,
      stateTokenReset,
    );
    const pmComponents = await withPmNowPlayingList(ownerId, interaction.guildId, components);
    await safeReply(interaction, { components: pmComponents, flags: responseFlags });
  }

  @ButtonComponent({ id: /^nowplaying-list-sort:\d+$/ })
  async handleNowPlayingListSort(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This sort prompt isn't for you.")) return;
    setNowPlayingListContext(ownerId, interaction.message);
    await this.promptSortNowPlayingButtons(interaction, ownerId);
  }

  @ButtonComponent({ id: /^nowplaying-list-complete:\d+$/ })
  async handleNowPlayingListComplete(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This completion prompt isn't for you.")) return;
    setNowPlayingListContext(ownerId, interaction.message);
    const sessionId = createNowPlayingCompletionWizardSession(ownerId, true);
    await this.promptNowPlayingCompletionPick(interaction, ownerId, sessionId);
  }

  @ButtonComponent({ id: /^nowplaying-complete-done:\d+$/ })
  async handleNowPlayingCompleteDone(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This completion prompt isn't for you.")) return;
    await returnToNowPlayingEditMenu(interaction, ownerId);
  }

  @ButtonComponent({ id: /^nowplaying-list-remove:\d+$/ })
  async handleNowPlayingListRemove(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This remove prompt isn't for you.")) return;
    setNowPlayingListContext(ownerId, interaction.message);
    await this.promptRemoveNowPlaying(interaction, "update");
  }

  @ButtonComponent({ id: /^nowplaying-remove-done:\d+$/ })
  async handleNowPlayingRemoveDone(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This remove prompt isn't for you.")) return;
    await returnToNowPlayingEditMenu(interaction, ownerId);
  }

  @ButtonComponent({ id: /^nowplaying-list-cancel:\d+$/ })
  async handleNowPlayingListCancel(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This prompt isn't for you.")) return;
    await returnToNowPlayingEditMenu(interaction, ownerId);
  }

  async showSingle(
    interaction: AnyRepliable,
    target: User,
    ephemeral: boolean,
  ): Promise<void> {
    const isOwnList = target.id === interaction.user.id;
    const entries = await Member.getNowPlaying(target.id);
    if (!entries.length) {
      if (isOwnList) {
        const ownerName = target.displayName ?? target.username ?? target.id;
        const header = buildUserHeaderContainer(
          target.id,
          ownerName,
          "Now Playing",
          `${NOW_PLAYING_LIST_EDIT_PREFIX}:${target.id}`,
        );
        const container = buildNowPlayingMessageContainer(
          "Your Now Playing List",
          [
            "Welcome. Your list is empty, so nothing shows yet.",
            "Use the user button in the header to manage sort order, platform, completions, and removals.",
          ].join("\n"),
        );
      const reply = await safeReply(interaction, {
        components: [header, container],
        flags: buildComponentsV2Flags(ephemeral),
        withResponse: !ephemeral,
      } as any);
      if (!ephemeral) {
        const message = reply?.resource?.message ?? null;
        if (message) {
          trackNowPlayingListContext(message as Message<boolean>, {
            view: "single",
              ownerUserId: target.id,
            });
          }
        }
        return;
      }

      const container = buildNowPlayingMessageContainer(
        "Now Playing",
        `No Now Playing entries found for ${userMention(target.id)}.`,
      );
      const reply = await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(ephemeral),
        withResponse: !ephemeral,
      } as any);
      if (!ephemeral) {
        const message = reply?.resource?.message ?? null;
        if (message) {
          trackNowPlayingListContext(message as Message<boolean>, {
            view: "single",
            ownerUserId: target.id,
          });
        }
      }
      return;
    }

    const sortedEntries = getDisplayNowPlayingEntries(entries);
    const payload = await buildNowPlayingListPayload(
      target,
      sortedEntries,
      interaction.guildId,
      false,
      isOwnList,
      true,
    );
    const components = withNowPlayingActions(
      false,
      target.id,
      payload.components,
      false,
      hasDisplayableNowPlayingNotes(sortedEntries),
      false,
    );
    const reply = await safeReply(interaction, {
      components,
      files: payload.files,
      flags: buildComponentsV2Flags(ephemeral),
      withResponse: !ephemeral,
    } as any);
    if (!ephemeral) {
      const message = reply?.resource?.message ?? null;
      if (message) {
        trackNowPlayingListContext(message as Message<boolean>, {
          view: "single",
          ownerUserId: target.id,
        });
      }
    }
  }

  @SelectMenuComponent({ id: /^nowplaying-all-select(?::v1)?$/ })
  async handleNowPlayingAllSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const selectedUserId = interaction.values?.[0];
    if (!selectedUserId) return;
    const isEphemeral = interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false;

    const loadingContainer = buildTextContainer("## Now Loading\nGenerating cover layout and loading the selected member list...");
    await safeUpdate(interaction, {
      components: [loadingContainer],
      flags: buildComponentsV2Flags(isEphemeral),
    });

    const entries = await Member.getNowPlaying(selectedUserId);
    const target =
      (await safeUserFetch(interaction.client, selectedUserId)) ??
      interaction.user;

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
        `No Now Playing entries found for ${userMention(selectedUserId)}.`,
      );
      const components = withNowPlayingActions(
        true,
        selectedUserId,
        [header, container],
        false,
        false,
      );
      const updated = await safeReply(interaction, {
        components,
      });
      trackNowPlayingListContext(updated as Message<boolean>, {
        view: "everyone-selected",
        selectedUserId,
      });
      return;
    }

    const sortedEntries = getDisplayNowPlayingEntries(entries);
    const payload = await buildNowPlayingListPayload(
      target,
      sortedEntries,
      interaction.guildId,
      false,
      false,
      true,
    );
    const components = withNowPlayingActions(
      false,
      selectedUserId,
      payload.components,
      false,
      hasDisplayableNowPlayingNotes(sortedEntries),
    );
    const updated = await safeReply(interaction, {
      components,
      files: payload.files,
    });
    trackNowPlayingListContext(updated as Message<boolean>, {
      view: "everyone-selected",
      selectedUserId,
    });
  }

  private async showEveryone(
    interaction: CommandInteraction,
    ephemeral: boolean,
  ): Promise<void> {
    const lists = await Member.getAllNowPlaying();
    if (!lists.length) {
      const container = buildNowPlayingMessageContainer(
        "Now Playing - Everyone",
        "No Now Playing data found for anyone yet.",
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(ephemeral),
      });
      return;
    }

    const sortedLists = [...lists].sort((a, b) => {
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

    const reply = await safeReply(interaction, {
      components: [container, selectRow],
      flags: buildComponentsV2Flags(ephemeral),
      withResponse: !ephemeral,
    } as any);
    if (!ephemeral) {
      const message = reply?.resource?.message ?? null;
      if (message) {
        trackNowPlayingListContext(message as Message<boolean>, {
          view: "everyone",
        });
      }
    }
  }

  private buildNowPlayingCompletionComponents(
    entries: IMemberNowPlayingEntry[],
    ownerId: string,
    sessionId: string,
    thumbnailsByGameId: Map<number, string>,
  ): Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>> {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## Add Completion\nClick Add Completion to log a game.",
      ),
    );

    const galleryItems: MediaGalleryItemBuilder[] = [];
    for (const entry of entries) {
      if (galleryItems.length >= NOW_PLAYING_GALLERY_MAX) {
        break;
      }
      if (!entry.gameId) {
        continue;
      }
      const imageUrl = thumbnailsByGameId.get(entry.gameId);
      if (!imageUrl) {
        continue;
      }
      const item = new MediaGalleryItemBuilder()
        .setURL(imageUrl)
        .setDescription(formatEntryTitleWithPlatform(entry));
      galleryItems.push(item);
    }

    if (galleryItems.length) {
      container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(galleryItems));
      container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false),
      );
    }

    entries.forEach((entry, index) => {
      if (index === 0) {
        container.addSeparatorComponents(
          new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false),
        );
      }
      const lines = [`### ${formatEntryTitleWithPlatform(entry)}`, entry.note ?? ""];
      if (entry.addedAt) {
        const addedLabel = `Added ${formatTableDate(entry.addedAt)}`;
        if (entry.noteUpdatedAt) {
          const updatedLabel = `last updated ${formatTableDate(entry.noteUpdatedAt)}`;
          if (formatTableDate(entry.addedAt) === formatTableDate(entry.noteUpdatedAt)) {
            lines.push(`-# *${addedLabel}.*`);
          } else {
            lines.push(`-# *${addedLabel}, ${updatedLabel}.*`);
          }
        } else {
          lines.push(`-# *${addedLabel}.*`);
        }
      }
      const section = new SectionBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          safeV2TextContent(trimTextDisplayContent(lines.join("\n")), 3500),
        ),
      );
      section.setButtonAccessory(
        new V2ButtonBuilder()
          .setCustomId(`${NOW_PLAYING_COMPLETE_PICK_PREFIX}:${sessionId}:${entry.gameId}`)
          .setLabel("Add Completion")
          .setStyle(ButtonStyle.Primary),
      );
      container.addSectionComponents(section);
    });

    const doneRow = buildButtonRow(
      buildActionButton("confirm", `nowplaying-complete-done:${ownerId}`, "Done"),
      buildActionButton({ customId: `${NOW_PLAYING_HELP_PREFIX}:completion-pick:${ownerId}`, label: "?", style: ButtonStyle.Secondary }),
    );
    return [container, doneRow];
  }

  private buildNowPlayingRemoveComponents(
    entries: IMemberNowPlayingEntry[],
    ownerId: string,
    _thumbnailsByGameId: Map<number, string>,
  ): Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>> {
    void _thumbnailsByGameId;
    const container = new ContainerBuilder();
    const textLines = [
      "## Now Playing Remove",
      "Select a game below to remove it from your list.",
      "",
      ...buildNowPlayingListLines(entries, null),
    ];
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        safeV2TextContent(trimTextDisplayContent(textLines.join("\n")), 3500),
      ),
    );

    const selectOptions = entries
      .filter((entry) => isPositiveInt(entry.gameId))
      .slice(0, DISCORD_SELECT_OPTIONS_MAX)
      .map((entry) => ({
        label: formatEntryTitleWithPlatform(entry).slice(0, DISCORD_SELECT_LABEL_MAX),
        value: String(entry.gameId),
      }));
    const removeSelect = new StringSelectMenuBuilder()
      .setCustomId(`${NOW_PLAYING_REMOVE_SELECT_PREFIX}:${ownerId}`)
      .setPlaceholder("Select a game to remove")
      .addOptions(selectOptions);
    const selectRow = buildSelectRow(removeSelect);

    const doneRow = buildButtonRow(
      buildActionButton("confirm", `nowplaying-remove-done:${ownerId}`, "Done"),
      buildActionButton({ customId: `${NOW_PLAYING_HELP_PREFIX}:remove:${ownerId}`, label: "?", style: ButtonStyle.Secondary }),
    );
    return [container, selectRow, doneRow];
  }

  @SelectMenuComponent({ id: /^nowplaying-remove-select:\d+$/ })
  async handleNowPlayingRemoveSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const isEphemeral = interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false;
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This remove prompt isn't for you.")) return;
    const gameId = Number(interaction.values?.[0]);
    if (!isPositiveInt(gameId)) {
      const container = buildTextContainer("Invalid game selection.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    const loadingContainer = buildTextContainer("Updating your Now Playing remove list...");
    await safeUpdate(interaction, {
      components: [loadingContainer],
      flags: buildComponentsV2Flags(isEphemeral),
    });

    try {
      const removed = await Member.removeNowPlaying(ownerId, gameId);
      if (!removed) {
        const container = buildTextContainer("Failed to remove that game (it may have been removed already).");
        safeIgnore(safeReply(interaction, {
          components: [container],
          flags: buildComponentsV2Flags(isEphemeral),
        }));
        return;
      }
      safeIgnore(refreshNowPlayingListFromContext(interaction, ownerId));
      const entries = getDisplayNowPlayingEntries(await Member.getNowPlaying(ownerId));
      if (!entries.length) {
        const container = buildTextContainer("Your Now Playing list is empty.");
        const pmComponents = await withPmNowPlayingList(
          ownerId,
          interaction.guildId,
          [container],
        );
        safeIgnore(safeReply(interaction, {
          components: pmComponents,
          flags: buildComponentsV2Flags(isEphemeral),
        }));
        return;
      }
      const includeImages = interaction.guildId != null;
      const { files, thumbnailsByGameId } = await buildNowPlayingAttachments(
        entries,
        NOW_PLAYING_GALLERY_MAX,
        includeImages,
      );
      const components = this.buildNowPlayingRemoveComponents(
        entries,
        ownerId,
        thumbnailsByGameId,
      );
      const pmComponents = await withPmNowPlayingList(
        ownerId,
        interaction.guildId,
        components,
      );
      safeIgnore(safeReply(interaction, {
        ...buildComponentPayload(pmComponents as any, files),
        flags: buildComponentsV2Flags(isEphemeral),
      }));
    } catch (err: any) {
      const msg = extractErrorMessage(err);
      const container = buildTextContainer(`Could not remove from Now Playing: ${msg}`);
      safeIgnore(safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(isEphemeral),
      }));
    }
  }

  private buildNowPlayingEditPlatformComponents(
    entries: IMemberNowPlayingEntry[],
    ownerId: string,
    platformOptions: Array<Array<{ label: string; value: string; platformId: number }>>,
    stateToken: string,
    validationMessage: string | null = null,
  ): Array<ContainerBuilder | ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>> {
    const parsedState = parseNowPlayingPlatformStateToken(stateToken, entries.length) ??
      Array.from({ length: entries.length }, () => -1);
    const container = new ContainerBuilder();
    const introLines = [
      "## Now Playing Edit Platform",
      "Pick one platform per game, then press Save.",
    ];
    if (validationMessage) {
      introLines.push(`-# ${validationMessage}`);
    }
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        safeV2TextContent(introLines.join("\n"), 1000),
      ),
    );

    const rows: Array<ActionRowBuilder<StringSelectMenuBuilder>> = [];
    for (let slotIndex = 0; slotIndex < entries.length; slotIndex += 1) {
      const entry = entries[slotIndex];
      const options = platformOptions[slotIndex] ?? [];
      if (!options.length) {
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            safeV2TextContent(`-# ${entry.title.slice(0, 80)}: No platform choices available.`, 1000),
          ),
        );
        continue;
      }
      const selectedIndex = parsedState[slotIndex];
      const currentPlatformName =
        selectedIndex >= 0 ? (options[selectedIndex]?.label ?? null) : null;
      const placeholder = currentPlatformName
        ? `${entry.title.slice(0, 50)} - ${currentPlatformName}`.slice(0, DISCORD_SELECT_LABEL_MAX)
        : entry.title.slice(0, DISCORD_SELECT_LABEL_MAX);
      const select = new StringSelectMenuBuilder()
        .setCustomId(`${NOW_PLAYING_EDIT_PLATFORM_SLOT_PREFIX}:${ownerId}:${slotIndex}:${stateToken}`)
        .setPlaceholder(placeholder)
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options.map((option, optionIndex) => ({
          label: optionIndex === selectedIndex
            ? `${entry.title.slice(0, 50)} - ${option.label}`.slice(0, DISCORD_SELECT_LABEL_MAX)
            : option.label,
          value: option.value,
          default: selectedIndex === optionIndex,
        })));
      rows.push(buildSelectRow(select));
    }
    const components: Array<
      ContainerBuilder | ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>
    > = [
      container,
      ...rows,
    ];

    const actionRow = buildButtonRow(
      buildActionButton(
        "confirm",
        `${NOW_PLAYING_EDIT_PLATFORM_SAVE_PREFIX}:${ownerId}:${stateToken}`,
        "Save",
      ),
      buildActionButton({ customId: `${NOW_PLAYING_EDIT_PLATFORM_RESET_PREFIX}:${ownerId}`, label: "Reset to current platforms", style: ButtonStyle.Secondary }),
      buildActionButton("cancel", `nowplaying-list-cancel:${ownerId}`),
      buildActionButton({ customId: `${NOW_PLAYING_HELP_PREFIX}:platform:${ownerId}`, label: "?", style: ButtonStyle.Secondary }),
    );
    components.push(actionRow);
    return components;
  }

  private buildNowPlayingSortComponents(
    entries: IMemberNowPlayingEntry[],
    ownerId: string,
    stateToken: string,
    validationMessage: string | null = null,
  ): Array<ContainerBuilder | ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>> {
    const parsedState = parseNowPlayingSortStateToken(stateToken, entries.length) ??
      Array.from({ length: entries.length }, () => -1);
    const container = new ContainerBuilder();
    const introLines = [
      "## Sort Your Now Playing List",
      "Pick one title for each position, then press Save.",
    ];
    if (validationMessage) {
      introLines.push(`-# ${validationMessage}`);
    }
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        safeV2TextContent(introLines.join("\n"), 1000),
      ),
    );

    const rows: Array<ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>> = [];
    for (let slotIndex = 0; slotIndex < entries.length; slotIndex += 1) {
      const selectedIndex = parsedState[slotIndex] ?? -1;
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`${NOW_PLAYING_SORT_SLOT_PREFIX}:${ownerId}:${slotIndex}:${stateToken}`)
        .setPlaceholder(`Position ${slotIndex + 1}`)
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(entries.map((entry, entryIndex) => ({
          label: formatEntryTitleWithPlatform(entry).slice(0, DISCORD_SELECT_LABEL_MAX),
          value: String(entryIndex),
          default: selectedIndex === entryIndex,
        })));
      rows.push(buildSelectRow(menu));
    }

    const actionRow = buildButtonRow(
      buildActionButton(
        "confirm",
        `${NOW_PLAYING_SORT_SAVE_PREFIX}:${ownerId}:${stateToken}`,
        "Save",
      ),
      buildActionButton({ customId: `${NOW_PLAYING_SORT_RESET_PREFIX}:${ownerId}`, label: "Reset to current order", style: ButtonStyle.Secondary }),
      buildActionButton("cancel", `nowplaying-list-cancel:${ownerId}`),
      buildActionButton({ customId: `${NOW_PLAYING_HELP_PREFIX}:sort:${ownerId}`, label: "?", style: ButtonStyle.Secondary }),
    );
    rows.push(actionRow);
    return [container, ...rows];
  }

  private async replaceNowPlayingMessageInCurrentChannel(
    interaction: CommandInteraction,
    userId: string,
  ): Promise<boolean> {
    const channelId = interaction.channelId;
    if (!channelId) {
      return false;
    }

    const now = Date.now();
    for (const [key, context] of nowPlayingListContexts.entries()) {
      if (now - context.createdAt > NOW_PLAYING_CONTEXT_TTL_MS) {
        nowPlayingListContexts.delete(key);
        continue;
      }
      if (context.channelId !== channelId) {
        continue;
      }
      if (context.view !== "single" || context.ownerUserId !== userId) {
        continue;
      }

      const channel = await interaction.client.channels.fetch(context.channelId).catch(() => null);
      if (!channel?.isTextBased()) {
        nowPlayingListContexts.delete(key);
        continue;
      }
      const message = await channel.messages.fetch(context.messageId).catch(() => null);
      if (!message) {
        nowPlayingListContexts.delete(key);
        continue;
      }

      await message.delete().catch(() => null);
      nowPlayingListContexts.delete(key);
      await this.showSingle(interaction, interaction.user, false);
      return true;
    }

    return false;
  }

  private async deleteLatestJournalMessageInChannel(
    interaction: ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction,
    ownerUserId: string,
    gameId: number,
  ): Promise<void> {
    const channelId = interaction.channelId;
    if (!channelId) {
      return;
    }

    const now = Date.now();

    // Expire stale entries and find the single most recent context for this channel.
    let latestKey: string | null = null;
    let latestContext: NowPlayingJournalContext | null = null;
    for (const [key, context] of nowPlayingJournalContexts.entries()) {
      if (now - context.createdAt > NOW_PLAYING_JOURNAL_CONTEXT_TTL_MS) {
        nowPlayingJournalContexts.delete(key);
        await Member.deleteJournalMessageContext(context.channelId, context.messageId)
          .catch((err) => logError("Journal.delete_expired_context_from_db_failed", err));
        continue;
      }
      if (context.channelId !== channelId) continue;
      if (context.ownerUserId !== ownerUserId || context.gameId !== gameId) continue;
      if (!latestContext || context.createdAt > latestContext.createdAt) {
        latestKey = key;
        latestContext = context;
      }
    }

    if (!latestKey || !latestContext) return;

    const channel = await interaction.client.channels
      .fetch(latestContext.channelId)
      .catch(() => null);
    if (!channel?.isTextBased()) {
      nowPlayingJournalContexts.delete(latestKey);
      await Member.deleteJournalMessageContext(latestContext.channelId, latestContext.messageId)
        .catch((err) => logError("Journal.delete_unreachable_context_from_db_failed", err));
      return;
    }

    const message = await channel.messages.fetch(latestContext.messageId).catch(() => null);
    if (!message) {
      nowPlayingJournalContexts.delete(latestKey);
      await Member.deleteJournalMessageContext(latestContext.channelId, latestContext.messageId)
        .catch((err) => logError("Journal.delete_missing_context_from_db_failed", err));
      return;
    }

    await message.delete().catch(() => null);
    nowPlayingJournalContexts.delete(latestKey);
    await Member.deleteJournalMessageContext(latestContext.channelId, latestContext.messageId)
      .catch((err) => logError("Journal.delete_context_from_db_after_message_delete_failed", err));
  }

  private async trackJournalReply(
    reply: Message | null,
    ownerUserId: string,
    gameId: number,
  ): Promise<void> {
    if (!reply) {
      return;
    }
    await trackNowPlayingJournalContext(reply as Message<boolean>, ownerUserId, gameId);
  }

  private async deleteEligibleNowPlayingMessageInCurrentChannel(
    interaction: CommandInteraction,
    predicate: (context: NowPlayingListContext) => boolean,
  ): Promise<boolean> {
    const channelId = interaction.channelId;
    if (!channelId) {
      return false;
    }

    const now = Date.now();
    for (const [key, context] of nowPlayingListContexts.entries()) {
      if (now - context.createdAt > NOW_PLAYING_CONTEXT_TTL_MS) {
        nowPlayingListContexts.delete(key);
        continue;
      }
      if (context.channelId !== channelId || !predicate(context)) {
        continue;
      }

      const channel = await interaction.client.channels.fetch(context.channelId).catch(() => null);
      if (!channel?.isTextBased()) {
        nowPlayingListContexts.delete(key);
        continue;
      }
      const message = await channel.messages.fetch(context.messageId).catch(() => null);
      if (!message) {
        nowPlayingListContexts.delete(key);
        continue;
      }

      await message.delete().catch(() => null);
      nowPlayingListContexts.delete(key);
      return true;
    }

    return false;
  }

  private buildJournalComponents(
    ownerId: string,
    viewerId: string,
    gameId: number,
    page: number,
    guildId?: string | null,
    showOwnerHeader?: boolean,
  ) {
    const isOwnerView = viewerId === ownerId;
    return buildJournalView({
      ownerId,
      viewerId,
      gameId,
      page,
      guildId,
      prevPageCustomId: (p) =>
        `${NOW_PLAYING_JOURNAL_PAGE_PREFIX}:${ownerId}:${gameId}:prev:${p}`,
      nextPageCustomId: (p) =>
        `${NOW_PLAYING_JOURNAL_PAGE_PREFIX}:${ownerId}:${gameId}:next:${p}`,
      headerButtonCustomId: showOwnerHeader
        ? `${NOW_PLAYING_JOURNAL_HEADER_PREFIX}:${ownerId}:${gameId}:${page}`
        : undefined,
      buildOwnerButtons: isOwnerView
        ? (safePage, hasEntries) => [
            buildActionButton(
              "add", `${NOW_PLAYING_JOURNAL_ADD_PREFIX}:${ownerId}:${gameId}:${safePage}`, "Add Entry",
            ),
            buildActionButton(
              "edit", `${NOW_PLAYING_JOURNAL_EDIT_PREFIX}:${ownerId}:${gameId}:${safePage}`, "Edit Entry",
            ).setDisabled(!hasEntries),
            buildActionButton(
              "delete", `${NOW_PLAYING_JOURNAL_DELETE_PREFIX}:${ownerId}:${gameId}:${safePage}`, "Delete Entry",
            ).setDisabled(!hasEntries),
          ]
        : undefined,
      navRowTrailingButtons: !guildId
        ? [
            buildActionButton({ customId: `${NOW_PLAYING_HELP_PREFIX}:journal-view:${ownerId}`, label: "?", style: ButtonStyle.Secondary }),
          ]
        : undefined,
      includeNowPlayingMeta: true,
      includeCompletions: true,
    });
  }

  private async startNowPlayingIgdbImport(
    interaction: StringSelectMenuInteraction,
    session: { userId: string; query: string; note: string | null },
  ): Promise<void> {
    await this.startNowPlayingIgdbImportFromInteraction(interaction, session, "update");
  }

  private async startNowPlayingIgdbImportFromInteraction(
    interaction: AnyRepliable,
    session: { userId: string; query: string; note: string | null },
    mode: "reply" | "update",
  ): Promise<void> {
    if (mode === "update" && "deferUpdate" in interaction) {
      await safeDeferUpdate(interaction);
    }

    try {
      const searchRes = await igdbService.searchGames(session.query);
      if (!searchRes.results.length) {
        const container = buildTextContainer(`No IGDB results found for "${session.query}".`);
        if (mode === "update" && "update" in interaction) {
          await safeUpdate(interaction, { components: [container] });
        } else {
          await safeReply(interaction, {
            components: [container],
            flags: buildComponentsV2Flags(true),
          });
        }
        return;
      }

      const opts: IgdbSelectOption[] = searchRes.results.map((game) => {
        const year = game.first_release_date
          ? new Date(game.first_release_date * 1000).getFullYear()
          : "TBD";
        return {
          id: game.id,
          label: `${game.name} (${year})`,
          description: (game.summary || "No summary").slice(0, DISCORD_AUTOCOMPLETE_DESC_MAX),
        };
      });

      const { components } = createIgdbSession(session.userId, opts, async (sel, igdbId) => {
        try {
          await safeDeferUpdate(sel);
          const imported = await this.importGameFromIgdb(igdbId);
          const sourceSessionId = `np-igdb-add-${session.userId}`;
          await this.promptNowPlayingAddPlatformSelection(
            sel,
            sourceSessionId,
            session.userId,
            imported.gameId,
            session.note,
            "reply",
          );
        } catch (err: any) {
          const msg = err?.message ?? "Failed to import from IGDB.";
          const container = buildTextContainer(msg);
          safeIgnore(safeReply(sel, {
            components: [container],
            flags: buildComponentsV2Flags(true),
          }));
        }
      });

      const container = buildTextContainer("Select an IGDB result to import and add to Now Playing:")
        .addActionRowComponents(components.map((row) => row.toJSON()));
      if (mode === "update" && "update" in interaction) {
        await safeUpdate(interaction, { components: [container] });
      } else {
        await safeReply(interaction, {
          components: [container],
          flags: buildComponentsV2Flags(true),
        });
      }
    } catch (err: any) {
      const msg = err?.message ?? "Failed to search IGDB.";
      const container = buildTextContainer(msg);
      if (mode === "update" && "update" in interaction) {
        await safeUpdate(interaction, { components: [container] });
      } else {
        await safeReply(interaction, {
          components: [container],
          flags: buildComponentsV2Flags(true),
        });
      }
    }
  }

  private async importGameFromIgdb(igdbId: number): Promise<{ gameId: number; title: string }> {
    return Game.importGameFromIgdb(igdbId);
  }
}
