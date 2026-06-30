import {
  ApplicationCommandOptionType,
  type CommandInteraction,
  type User,
  MessageFlags,
  type Message,
} from "discord.js";
import {
  Discord,
  Slash,
  SlashOption,
  SlashGroup,
} from "discordx";
import Member from "../classes/Member.js";
import {
  extractErrorMessage,
  safeDeferReply,
  safeReply,
  safeUpdate,
  sanitizeUserInput,
  type AnyRepliable,
} from "../functions/InteractionUtils.js";
import type { IGame } from "../types/GameTypes.js";
import {
  buildUserHeaderContainer,
} from "../functions/uiComponents.js";
import {
  buildComponentsV2Flags,
  buildTextContainer,
  buildTextReply,
} from "../functions/ComponentsV2Utils.js";
import {
  autocompleteGameCompletionPlatform,
  autocompleteGameCompletionTitle,
  resolveGameCompletionPlatformId,
} from "./game-completion/completion-autocomplete.utils.js";
import { parseTitleWithYear } from "../functions/GameTitleAutocompleteUtils.js";

import { renderUsernameWithEmoji } from "../services/UserEmojiService.js";
import { safeIgnore } from "../utilities/AsyncUtils.js";

import {
  NOW_PLAYING_SEARCH_LIMIT,
  NOW_PLAYING_NOTE_MODAL_MAX_FIELDS,
  NOW_PLAYING_LIST_EDIT_PREFIX,
} from "./now-playing/nowPlayingIds.js";
import {
  nowPlayingListContexts,
  trackNowPlayingListContext,
  NOW_PLAYING_CONTEXT_TTL_MS,
} from "./now-playing/nowPlayingContexts.js";
import {
  getDisplayNowPlayingEntries,
} from "../functions/NowPlayingUtils.js";
import {
  buildNowPlayingListContainer,
  buildNowPlayingMessageContainer,
  buildNowPlayingListPayload,
  withPmNowPlayingList,
  refreshNowPlayingListFromContext,
  trimTextDisplayContent,
  buildNowPlayingMemberSelect,
} from "./now-playing/nowPlayingListRenderer.js";
import {
  buildEditNotesModal,
} from "./now-playing/nowPlayingModals.js";
import {
  deleteEligibleNowPlayingMessageInCurrentChannel,
} from "./now-playing/nowPlayingMessageService.js";
import GamePlatformRegionService from "../classes/GamePlatformRegionService.js";
import GameSearchService from "../classes/GameSearchService.js";

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
    interaction: CommandInteraction,
  ): Promise<void> {
    const title = sanitizeUserInput(rawTitle, { preserveNewlines: false }).trim();
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(false) });

    if (!title) {
      const container = buildTextContainer("Please provide a game title from autocomplete.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(false),
      });
      return;
    }

    const game = await this.resolveNowPlayingGameByTitle(title);
    if (!game) {
      const container = buildTextContainer(`I could not find a unique GameDB match for "${title}". Please choose from autocomplete.`);
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(false),
      });
      return;
    }

    const platformId = await resolveGameCompletionPlatformId(rawPlatform);
    if (!platformId) {
      const container = buildTextContainer("Please choose a platform from autocomplete.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(false),
      });
      return;
    }

    const platform = await GamePlatformRegionService.getPlatformById(platformId);
    if (!platform) {
      const container = buildTextContainer("Selected platform was not found.");
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(false),
      });
      return;
    }

    try {
      await Member.addNowPlaying(interaction.user.id, game.id, platformId, null);
    } catch (err: any) {
      const msg = extractErrorMessage(err);
      const container = buildTextContainer(`Could not add to Now Playing: ${msg}`);
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(false),
      });
      return;
    }

    const replacedCurrentChannelMessage = interaction.channelId
      ? await this.replaceNowPlayingMessageInCurrentChannel(interaction, interaction.user.id)
      : false;
    safeIgnore(refreshNowPlayingListFromContext(interaction, interaction.user.id));
    if (replacedCurrentChannelMessage) {
      return;
    }
    await this.showSingle(interaction, interaction.user, false);
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

  private async resolveNowPlayingGameByTitle(searchTerm: string): Promise<IGame | null> {
    const parsed = parseTitleWithYear(searchTerm);
    const normalizedSearchTerm = parsed.title.trim();
    if (!normalizedSearchTerm) {
      return null;
    }

    const existing = await GameSearchService.searchGames(normalizedSearchTerm);
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
      });
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
      });
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
    });
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
    });
    if (!ephemeral) {
      const message = reply?.resource?.message ?? null;
      if (message) {
        trackNowPlayingListContext(message as Message<boolean>, {
          view: "everyone",
        });
      }
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
