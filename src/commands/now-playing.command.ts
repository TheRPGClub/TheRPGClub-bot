import {
  ApplicationCommandOptionType,
  type CommandInteraction,
  type User,
  MessageFlags,
  ModalSubmitInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  ButtonInteraction,
  type ActionRow,
  type MessageActionRowComponent,
  type Message,
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
import Member, { type IMemberNowPlayingEntry } from "../classes/Member.js";
import {
  extractErrorMessage,
  getModalField,
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
import {
  buildActionButton,
  buildButtonRow,
  buildUserHeaderContainer,
  buildSelectRow,
} from "../functions/uiComponents.js";
import {
  buildComponentsV2Flags,
  buildComponentsV2EditFlags,
  buildTextContainer,
  buildTextReply,
  buildTitledContainer,
} from "../functions/ComponentsV2Utils.js";
import {
  autocompleteGameCompletionPlatform,
  autocompleteGameCompletionTitle,
  resolveGameCompletionPlatformId,
} from "./game-completion/completion-autocomplete.utils.js";
import { parseTitleWithYear } from "../functions/GameTitleAutocompleteUtils.js";
import { STANDARD_PLATFORM_IDS } from "../config/standardPlatforms.js";
import {
  NOW_PLAYING_HELP_TEXTS,
} from "./now-playing-help.js";

import { renderUsernameWithEmoji } from "../services/UserEmojiService.js";
import { isPositiveInt } from "../utilities/ValidationUtils.js";
import {
  DISCORD_SELECT_OPTIONS_MAX,
  truncateLabel,
} from "../config/textLimits.js";
import { assertCustomIdSegments, parseCustomIdSegmentsMin } from "../utilities/CustomIdUtils.js";
import { safeIgnore } from "../utilities/AsyncUtils.js";

import {
  MAX_NOW_PLAYING_NOTE_LEN,
  NOW_PLAYING_SEARCH_LIMIT,
  NOW_PLAYING_NOTE_INPUT_ID,
  NOW_PLAYING_NOTE_MODAL_MAX_FIELDS,
  NOW_PLAYING_ADD_MODAL_ID,
  NOW_PLAYING_ADD_TITLE_INPUT_ID,
  NOW_PLAYING_ADD_NOTE_INPUT_ID,
  NOW_PLAYING_GALLERY_MAX,
  NOW_PLAYING_LIST_EDIT_PREFIX,
} from "./now-playing/nowPlayingIds.js";
import {
  type NowPlayingAddSession,
} from "./now-playing/nowPlayingTypes.js";
import {
  nowPlayingAddSessions,
  nowPlayingAddPlatformSessions,
  nowPlayingListContexts,
  nowPlayingOwnerMenu,
  clearNowPlayingAddSession,
  trackNowPlayingListContext,
  setNowPlayingListContext,
  NOW_PLAYING_CONTEXT_TTL_MS,
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
  buildNowPlayingListContainer,
  buildNowPlayingMessageContainer,
  buildComponentPayload,
  buildNowPlayingAttachments,
  buildNowPlayingListPayload,
  buildNowPlayingManageRow,
  returnToNowPlayingEditMenu,
  buildNowPlayingEditInitialComponents,
  withPmNowPlayingList,
  refreshNowPlayingListFromContext,
  trimTextDisplayContent,
  buildNowPlayingMemberSelect,
  buildNowPlayingRemoveComponents,
  buildNowPlayingEditPlatformComponents,
  buildNowPlayingSortComponents,
} from "./now-playing/nowPlayingListRenderer.js";
import {
  buildEditNoteModal,
  buildEditNotesModal,
  buildNowPlayingAddModal,
} from "./now-playing/nowPlayingModals.js";
import {
  deleteEligibleNowPlayingMessageInCurrentChannel,
} from "./now-playing/nowPlayingMessageService.js";
import { promptNowPlayingAddPlatformSelection } from "./now-playing/nowPlayingAddService.js";
import {
  startNowPlayingIgdbImport,
  startNowPlayingIgdbImportFromInteraction,
} from "./now-playing/nowPlayingIgdbImport.service.js";

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
      await deleteEligibleNowPlayingMessageInCurrentChannel(
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

    const usersByGameId = new Map<number, { title: string; userIds: Set<string>;
      userMap: Map<string, string> }>();
    for (const row of nowPlayingRows) {
      const record = usersByGameId.get(row.gameId) ?? {
        title: row.title,
        userIds: new Set<string>(),
        userMap: new Map<string, string>(),
      };
      if (!record.userIds.has(row.userId)) {
        record.userIds.add(row.userId);
        const displayName = row.globalName ?? row.username ?? row.userId;
        record.userMap.set(row.userId, renderUsernameWithEmoji(row.userId, displayName));
      }
      usersByGameId.set(row.gameId, record);
    }

    const sortedGames = Array.from(usersByGameId.entries())
      .map(([gameId, record]) => ({
        gameId,
        title: record.title,
        users: Array.from(record.userMap.values()),
      }))
      .sort((a, b) => a.title.localeCompare(b.title));
    const totalGames = sortedGames.length;
    const limitedGames = sortedGames.slice(0, NOW_PLAYING_SEARCH_LIMIT);

    const lines: string[] = [];
    for (const game of limitedGames) {
      const displayedUsers = game.users.slice(0, 30);
      const remaining = game.users.length - displayedUsers.length;
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
        await startNowPlayingIgdbImportFromInteraction(
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
      await startNowPlayingIgdbImport(interaction, session);
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
      await promptNowPlayingAddPlatformSelection(
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
        await safeUpdate(interaction, {
          components: payload.components,
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
      const components = buildNowPlayingRemoveComponents(
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
    const components = buildNowPlayingSortComponents(entries, ownerId, stateToken);
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
    const components = buildNowPlayingEditPlatformComponents(
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
          label: truncateLabel(platform.name),
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
      label: truncateLabel(platform.name),
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
    const components = buildNowPlayingEditPlatformComponents(
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
      const components = buildNowPlayingSortComponents(
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
      const components = buildNowPlayingSortComponents(
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
      const components = buildNowPlayingSortComponents(
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
    const components = buildNowPlayingSortComponents(entries, ownerId, stateToken);
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
      await safeReply(interaction, {
        components: payload.components,
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
      const components = buildNowPlayingRemoveComponents(
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

  @ButtonComponent({ id: /^nowplaying-edit-menu-remove:\d+$/ })
  async handleNowPlayingEditMenuRemove(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This edit menu isn't for you.")) return;
    await this.promptRemoveNowPlaying(interaction, "update");
  }

  @ButtonComponent({ id: /^nowplaying-list-add:\d+$/ })
  async handleNowPlayingListAdd(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This add prompt isn't for you.")) return;
    setNowPlayingListContext(ownerId, interaction.message);
    safeIgnore(interaction.showModal(buildNowPlayingAddModal()));
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
      const components = buildNowPlayingEditPlatformComponents(
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
    const components = buildNowPlayingEditPlatformComponents(
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
        `No Now Playing entries found for ${renderUsernameWithEmoji(target.id, target.displayName ?? target.username ?? target.id)}.`,
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
      isOwnList,
      true,
    );
    const reply = await safeReply(interaction, {
      components: payload.components,
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
        `No Now Playing entries found for ${renderUsernameWithEmoji(selectedUserId, ownerName)}.`,
      );
      const updated = await safeReply(interaction, {
        components: [header, container],
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
      true,
    );
    const updated = await safeReply(interaction, {
      components: payload.components,
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
      const components = buildNowPlayingRemoveComponents(
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

}
