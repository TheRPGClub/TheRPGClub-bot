import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  AutocompleteInteraction,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  CommandInteraction,
  EmbedBuilder,
  Message,
  MessageFlags,
  ModalSubmitInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  User,
} from "discord.js";
import {
  ContainerBuilder,
  TextDisplayBuilder,
  ModalBuilder as ComponentsModalBuilder,
  ActionRowBuilder as ComponentsActionRowBuilder,
  TextInputBuilder as ComponentsTextInputBuilder,
} from "@discordjs/builders";
import { TextInputStyle as ApiTextInputStyle } from "discord-api-types/v10";
import {
  ButtonComponent,
  Discord,
  ModalComponent,
  SelectMenuComponent,
  Slash,
  SlashOption,
} from "discordx";
import Member, {
  type IGameJournalListEntry,
  type IJournalSearchResult,
  type IJournalUserSummary,
} from "../classes/Member.js";
import Game from "../classes/Game.js";
import { getThreadsByGameId } from "../classes/Thread.js";
import {
  safeDeferReply,
  safeDeferUpdate,
  sanitizeUserInput,
  safeReply,
  safeUpdate,
} from "../functions/InteractionUtils.js";
import { formatGameTitleWithYear } from "../functions/GameTitleAutocompleteUtils.js";
import { renderUsernameWithEmoji } from "../services/UserEmojiService.js";
import { buildJournalView } from "../functions/journalView.js";
import { COMPONENTS_V2_FLAG } from "../config/flags.js";
import { buildUserHeaderContainer } from "../functions/uiComponents.js";
import {
  GJ_CLOSE_PREFIX,
  GJ_SEARCH_PAGE_PREFIX,
  JOURNAL_TITLE_INPUT_ID,
  JOURNAL_BODY_INPUT_ID,
} from "../config/journalConstants.js";
import { formatTableDate } from "./profile.command.js";
import {
  trackNowPlayingJournalContext,
  refreshJournalMessages,
} from "./now-playing.command.js";
import { NOW_PLAYING_HELP_PREFIX } from "./now-playing-help.js";
import { EphemeralOwnerMenu } from "../functions/EphemeralOwnerMenu.js";

const gjHmenu = new EphemeralOwnerMenu();

const LIST_PAGE_SIZE = 15;
const ALL_PAGE_SIZE = 20;
const SEARCH_PAGE_SIZE = 1;
const SEARCH_QUERY_MAX_LENGTH = 35;

const GJ_LIST_SELECT_PREFIX = "game-journal-list-select";
const GJ_LIST_PAGE_PREFIX = "game-journal-list-page";
const GJ_VIEW_PAGE_PREFIX = "game-journal-view-page";
const GJ_ALL_SELECT_PREFIX = "game-journal-all-select";
const GJ_ALL_PAGE_PREFIX = "game-journal-all-page";
const GJ_HEADER_ADD_PREFIX = "game-journal-header-add";
const GJ_HMENU_ADD_PREFIX = "game-journal-hmenu-add";
const GJ_HMENU_EDIT_PREFIX = "game-journal-hmenu-edit";
const GJ_HMENU_DELETE_PREFIX = "game-journal-hmenu-delete";
const GJ_HMENU_DELETE_SELECT_PREFIX = "game-journal-hmenu-delete-select";
const GJ_HMENU_DELETE_CONFIRM_PREFIX = "game-journal-hmenu-delete-confirm";
const GJ_HMENU_ADD_MODAL_ID = "game-journal-hmenu-add-modal";
const GJ_HMENU_EDIT_MODAL_ID = "game-journal-hmenu-edit-modal";
export { GJ_CLOSE_PREFIX };

// customId: GJ_LIST_SELECT_PREFIX:{callerId}:{targetUserId}:{page}  value=gameId
// customId: GJ_LIST_PAGE_PREFIX:{callerId}:{targetUserId}:{page}
// customId: GJ_VIEW_PAGE_PREFIX:{callerId}:{targetUserId}:{gameId}:{page}
// customId: GJ_ALL_SELECT_PREFIX:{callerId}:{page}                  value=userId
// customId: GJ_ALL_PAGE_PREFIX:{callerId}:{page}
// customId: GJ_PUBLIC_CLOSE_PREFIX:{callerId}
// customId: GJ_HEADER_ADD_PREFIX:{ownerId}:{gameId}:{page}
// customId: GJ_HMENU_ADD_PREFIX:{ownerId}:{gameId}
// customId: GJ_HMENU_EDIT_PREFIX:{ownerId}:{gameId}:{page}
// customId: GJ_HMENU_DELETE_PREFIX:{ownerId}:{gameId}
// customId: GJ_HMENU_DELETE_SELECT_PREFIX:{ownerId}:{gameId}        value=entryId
// customId: GJ_HMENU_DELETE_CONFIRM_PREFIX:(yes|no):{ownerId}:{gameId}:{entryId}
// modal:    JOURNAL_ADD_MODAL_ID:{ownerId}:{gameId}:{page}
// modal:    GJ_HMENU_ADD_MODAL_ID:{ownerId}:{gameId}
// modal:    GJ_HMENU_EDIT_MODAL_ID:{ownerId}:{gameId}:{entryId}

function buildComponentsV2Flags(isEphemeral: boolean): number {
  return (isEphemeral ? MessageFlags.Ephemeral : 0) | COMPONENTS_V2_FLAG;
}

function buildHmenuActionRow(
  ownerId: string,
  gameId: number,
  page = 1,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${GJ_HMENU_ADD_PREFIX}:${ownerId}:${gameId}`)
      .setLabel("Add Entry")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${GJ_HMENU_EDIT_PREFIX}:${ownerId}:${gameId}:${page}`)
      .setLabel("Edit Entry")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${GJ_HMENU_DELETE_PREFIX}:${ownerId}:${gameId}`)
      .setLabel("Delete Entry")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`${NOW_PLAYING_HELP_PREFIX}:journal-add:${ownerId}`)
      .setLabel("?")
      .setStyle(ButtonStyle.Secondary),
  );
}

function buildHmenuModal(
  modalId: string,
  modalTitle: string,
  prefillTitle?: string,
  prefillBody?: string,
): ComponentsModalBuilder {
  const modal = new ComponentsModalBuilder()
    .setCustomId(modalId)
    .setTitle(modalTitle);
  modal.addActionRowComponents(
    new ComponentsActionRowBuilder<ComponentsTextInputBuilder>().addComponents(
      new ComponentsTextInputBuilder()
        .setCustomId(JOURNAL_TITLE_INPUT_ID)
        .setLabel("Title (optional)")
        .setStyle(ApiTextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(120)
        .setValue((prefillTitle ?? "").slice(0, 120)),
    ),
    new ComponentsActionRowBuilder<ComponentsTextInputBuilder>().addComponents(
      new ComponentsTextInputBuilder()
        .setCustomId(JOURNAL_BODY_INPUT_ID)
        .setLabel("Entry")
        .setStyle(ApiTextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(2000)
        .setValue((prefillBody ?? "").slice(0, 2000)),
    ),
  );
  return modal;
}

function gameLabel(n: number): string {
  return n === 1 ? "game" : "games";
}

function entryLabel(n: number): string {
  return n === 1 ? "entry" : "entries";
}

function buildListComponents(
  target: User,
  entries: IGameJournalListEntry[],
  page: number,
  totalPages: number,
): ContainerBuilder[] {
  const ownerName = target.displayName ?? target.username;
  const userHeader = buildUserHeaderContainer(target.id, ownerName, "Game Journals");

  const start = page * LIST_PAGE_SIZE;
  const pageEntries = entries.slice(start, start + LIST_PAGE_SIZE);
  // const lines = [`## Game Journals`];
  const lines = [];
  lines.push(
    ...pageEntries.map((e) => `**${e.title}** - ${e.totalEntries} ${entryLabel(e.totalEntries)}`),
  );
  const pageInfo = totalPages > 1 ? ` • Page ${page + 1}/${totalPages}` : "";
  lines.push(`-# ${entries.length} ${gameLabel(entries.length)}${pageInfo}`);

  const listContainer = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(lines.join("\n")),
  );

  return [userHeader, listContainer];
}

function buildListSelectRow(
  entries: IGameJournalListEntry[],
  callerId: string,
  targetUserId: string,
  page: number,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const start = page * LIST_PAGE_SIZE;
  const pageEntries = entries.slice(start, start + LIST_PAGE_SIZE);

  const options = pageEntries.map((e) => ({
    label: e.title.slice(0, 100),
    value: String(e.gameId),
    description: `${e.totalEntries} ${entryLabel(e.totalEntries)}`,
  }));

  const select = new StringSelectMenuBuilder()
    .setCustomId(`${GJ_LIST_SELECT_PREFIX}:${callerId}:${targetUserId}:${page}`)
    .setPlaceholder("Select a game to read its journal")
    .addOptions(options);

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

function buildListPageRow(
  callerId: string,
  targetUserId: string,
  page: number,
  totalPages: number,
): ActionRowBuilder<ButtonBuilder> | null {
  if (totalPages <= 1) return null;

  const row = new ActionRowBuilder<ButtonBuilder>();
  if (page > 0) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${GJ_LIST_PAGE_PREFIX}:${callerId}:${targetUserId}:${page - 1}`)
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary),
    );
  }
  if (page < totalPages - 1) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${GJ_LIST_PAGE_PREFIX}:${callerId}:${targetUserId}:${page + 1}`)
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary),
    );
  }
  return row.components.length > 0 ? row : null;
}

function buildJournalViewPayload(
  callerId: string,
  targetUserId: string,
  gameId: number,
  page: number,
  guildId?: string | null,
  isOwner?: boolean,
) {
  return buildJournalView({
    ownerId: targetUserId,
    viewerId: null,
    gameId,
    page,
    guildId,
    prevPageCustomId: (p) =>
      `${GJ_VIEW_PAGE_PREFIX}:${callerId}:${targetUserId}:${gameId}:${p}`,
    nextPageCustomId: (p) =>
      `${GJ_VIEW_PAGE_PREFIX}:${callerId}:${targetUserId}:${gameId}:${p}`,
    headerButtonCustomId: isOwner
      ? `${GJ_HEADER_ADD_PREFIX}:${targetUserId}:${gameId}:${page}`
      : undefined,
    includeNowPlayingMeta: true,
    includeCompletions: true,
  });
}

function buildAllEmbed(
  summaries: IJournalUserSummary[],
  page: number,
  totalPages: number,
): EmbedBuilder {
  const start = page * ALL_PAGE_SIZE;
  const pageSummaries = summaries.slice(start, start + ALL_PAGE_SIZE);
  const memberLabel = summaries.length === 1 ? "member" : "members";
  const lines = pageSummaries.map((s) => {
    return `${renderUsernameWithEmoji(s.userId, `<@${s.userId}>`)}`
      + ` - ${s.gameCount} ${gameLabel(s.gameCount)}`;
  });
  return new EmbedBuilder()
    .setTitle("Game Journal Users")
    .setDescription(lines.join("\n"))
    .setFooter({ text: `${summaries.length} ${memberLabel} • Page ${page + 1}/${totalPages}` });
}

function buildAllSelectRow(
  summaries: IJournalUserSummary[],
  callerId: string,
  page: number,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const start = page * ALL_PAGE_SIZE;
  const pageSummaries = summaries.slice(start, start + ALL_PAGE_SIZE);
  const options = pageSummaries.map((s) => ({
    label: (s.globalName ?? s.username ?? s.userId).slice(0, 100),
    value: s.userId,
    description: `${s.gameCount} ${gameLabel(s.gameCount)}`,
  }));
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${GJ_ALL_SELECT_PREFIX}:${callerId}:${page}`)
    .setPlaceholder("Select a member to view their journals")
    .addOptions(options);
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

function buildAllPageRow(
  callerId: string,
  page: number,
  totalPages: number,
): ActionRowBuilder<ButtonBuilder> | null {
  if (totalPages <= 1) return null;
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (page > 0) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${GJ_ALL_PAGE_PREFIX}:${callerId}:${page - 1}`)
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary),
    );
  }
  if (page < totalPages - 1) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${GJ_ALL_PAGE_PREFIX}:${callerId}:${page + 1}`)
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary),
    );
  }
  return row.components.length > 0 ? row : null;
}

async function autocompleteJournalSearchGame(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const rawQuery = focused?.value ? String(focused.value) : "";
  const query = sanitizeUserInput(rawQuery, { preserveNewlines: false }).trim();
  if (!query) {
    await interaction.respond([]);
    return;
  }
  const results = await Game.searchGamesAutocomplete(query);
  await interaction.respond(
    results.slice(0, 25).map((game) => ({
      name: formatGameTitleWithYear(game).slice(0, 100),
      value: String(game.id),
    })),
  );
}

function buildSearchCustomId(
  callerId: string,
  targetUserId: string,
  gameId: string,
  page: number,
  query: string,
): string {
  return `${GJ_SEARCH_PAGE_PREFIX}:${callerId}:${targetUserId}:${gameId}:${page}:${query}`;
}

function buildSearchResultComponents(
  targetUser: { id: string; displayName: string } | null,
  gameTitlePart: string | null,
  query: string,
  results: IJournalSearchResult[],
  total: number,
  page: number,
  totalPages: number,
): ContainerBuilder[] {
  const titleLine = gameTitlePart
    ? `${gameTitlePart} Game Journal Search`
    : "Game Journal Search";
  const headerTitle = `${titleLine}\nQuery: "${query}"`;

  const headerContainer = targetUser
    ? buildUserHeaderContainer(targetUser.id, targetUser.displayName, headerTitle)
    : new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## ${headerTitle}`),
    );

  const result = results[0];
  const resultLines: string[] = [];
  if (!result) {
    resultLines.push(`No journal entries matched **"${query}"**.`);
  } else {
    const entryLabel = result.entryTitle?.trim()
      ? `_${result.entryTitle.trim()}_`
      : "_(no title)_";
    const date = formatTableDate(result.createdAt);
    const displayName = result.globalName ?? result.username ?? result.userId;
    const userPart = targetUser
      ? ""
      : ` | ${renderUsernameWithEmoji(result.userId, displayName)}`;
    resultLines.push(
      `**${result.gameTitle}**${userPart}\n`
      + `-# ${entryLabel} • ${date}\n\n`
      + result.body,
    );
  }
  const resultCountLabel = total === 1 ? "result" : "results";
  const resultInfo = total > 0 ? `-# Result ${page + 1} of ${total}` : `-# 0 ${resultCountLabel}`;
  resultLines.push(resultInfo);

  const resultsContainer = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(resultLines.join("\n\n")),
  );

  return [headerContainer, resultsContainer];
}

function buildSearchPageRow(
  callerId: string,
  targetUserId: string,
  gameId: string,
  query: string,
  page: number,
  totalPages: number,
): ActionRowBuilder<ButtonBuilder> | null {
  if (totalPages <= 1) return null;
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (page > 0) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(buildSearchCustomId(callerId, targetUserId, gameId, page - 1, query))
        .setLabel("Previous Result")
        .setStyle(ButtonStyle.Secondary),
    );
  }
  if (page < totalPages - 1) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(buildSearchCustomId(callerId, targetUserId, gameId, page + 1, query))
        .setLabel("Next Result")
        .setStyle(ButtonStyle.Secondary),
    );
  }
  return row.components.length > 0 ? row : null;
}

@Discord()
export class GameJournalCommand {
  @Slash({
    description: "View Game Journal lists for yourself, a member, or everyone",
    name: "game-journal",
  })
  async gameJournal(
    @SlashOption({
      description: "Show all members who use Game Journals",
      name: "all",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    all: boolean | undefined,
    @SlashOption({
      description: "Member whose journal list to view; defaults to you",
      name: "member",
      required: false,
      type: ApplicationCommandOptionType.User,
    })
    member: User | undefined,
    @SlashOption({
      description: "Return the result as an ephemeral (private) message",
      name: "private",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    isPrivate: boolean | undefined,
    @SlashOption({
      description: "Search for a term across journal entries",
      name: "query",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    query: string | undefined,
    @SlashOption({
      autocomplete: autocompleteJournalSearchGame,
      description: "Filter search to a specific game (autocomplete from GameDB)",
      name: "game",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    gameRaw: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const ephemeral = isPrivate === true;
    const flags = ephemeral ? MessageFlags.Ephemeral : undefined;
    await safeDeferReply(interaction, { flags });

    if (query !== undefined) {
      const cleanQuery = sanitizeUserInput(query, { preserveNewlines: false })
        .trim()
        .slice(0, SEARCH_QUERY_MAX_LENGTH);
      if (!cleanQuery) {
        await safeReply(interaction, {
          content: "Please enter a search term.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const targetUserId = member?.id ?? "0";
      const gameIdParsed = gameRaw ? Number(gameRaw) : NaN;
      const gameId = Number.isInteger(gameIdParsed) && gameIdParsed > 0
        ? gameIdParsed
        : undefined;
      const gameIdStr = gameId ? String(gameId) : "0";
      const callerId = interaction.user.id;

      const [{ rows, total }, gameRecord, threadIds] = await Promise.all([
        Member.searchJournalEntries({
          query: cleanQuery,
          userId: targetUserId !== "0" ? targetUserId : undefined,
          gameId,
          limit: SEARCH_PAGE_SIZE,
          offset: 0,
        }),
        gameId ? Game.getGameById(gameId) : Promise.resolve(null),
        gameId ? getThreadsByGameId(gameId) : Promise.resolve([]),
      ]);

      const rawGameTitle = gameRecord?.title ?? null;
      const threadId = threadIds[0] ?? null;
      const gameTitlePart = rawGameTitle
        ? (interaction.guildId && threadId
          ? `[${rawGameTitle}](https://discord.com/channels/${interaction.guildId}/${threadId})`
          : rawGameTitle)
        : null;
      const targetUser = member
        ? { id: member.id, displayName: member.displayName ?? member.username }
        : null;
      const totalPages = Math.max(1, Math.ceil(total / SEARCH_PAGE_SIZE));
      const searchComponents = buildSearchResultComponents(
        targetUser, gameTitlePart, cleanQuery, rows, total, 0, totalPages,
      );
      const pageRow = buildSearchPageRow(
        callerId, targetUserId, gameIdStr, cleanQuery, 0, totalPages,
      );
      const cvFlags = (ephemeral ? MessageFlags.Ephemeral : 0) | COMPONENTS_V2_FLAG;
      const allComponents = pageRow
        ? [...searchComponents, pageRow]
        : searchComponents;
      await safeReply(interaction, { embeds: [], components: allComponents, flags: cvFlags });
      return;
    }

    if (all === true && member === undefined) {
      const summaries = await Member.getAllJournalUsers();
      if (!summaries.length) {
        await safeReply(interaction, {
          content: "No members are currently using Game Journals.",
          flags,
        });
        return;
      }
      const totalPages = Math.max(1, Math.ceil(summaries.length / ALL_PAGE_SIZE));
      const page = 0;
      const embed = buildAllEmbed(summaries, page, totalPages);
      const selectRow = buildAllSelectRow(summaries, interaction.user.id, page);
      const pageRow = buildAllPageRow(interaction.user.id, page, totalPages);
      const components = pageRow ? [selectRow, pageRow] : [selectRow];
      await safeReply(interaction, { embeds: [embed], components, flags });
      return;
    }

    const target = member ?? interaction.user;
    const entries = await Member.getGameJournalList(target.id);

    if (!entries.length) {
      const name = target.displayName ?? target.username;
      await safeReply(interaction, {
        content: `${name} has no game journals.`,
        flags,
      });
      return;
    }

    const totalPages = Math.max(1, Math.ceil(entries.length / LIST_PAGE_SIZE));
    const page = 0;
    const listComponents = buildListComponents(target, entries, page, totalPages);
    const selectRow = buildListSelectRow(entries, interaction.user.id, target.id, page);
    const pageRow = buildListPageRow(interaction.user.id, target.id, page, totalPages);
    const cvFlags = (ephemeral ? MessageFlags.Ephemeral : 0) | COMPONENTS_V2_FLAG;

    const components = pageRow
      ? [...listComponents, selectRow, pageRow]
      : [...listComponents, selectRow];

    await safeReply(interaction, { embeds: [], components, flags: cvFlags });
  }

  @SelectMenuComponent({ id: new RegExp(`^${GJ_LIST_SELECT_PREFIX}:\\d+:\\d+:\\d+$`) })
  async handleListSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, callerId, targetUserId] = interaction.customId.split(":");
    if (interaction.user.id !== callerId) {
      await safeReply(interaction, {
        content: "This journal list isn't yours to navigate.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const gameId = Number(interaction.values[0]);
    if (!gameId) return;

    await safeDeferUpdate(interaction);

    const isOwner = callerId === targetUserId;
    const payload = await buildJournalViewPayload(
      callerId, targetUserId, gameId, 1, interaction.guildId, isOwner,
    );
    await safeUpdate(interaction, {
      embeds: [],
      components: payload.components,
      files: payload.files,
      flags: payload.flags,
      allowedMentions: payload.allowedMentions,
    });
    if (interaction.guildId && interaction.message) {
      await trackNowPlayingJournalContext(
        interaction.message as Message<boolean>, targetUserId, gameId,
      );
    }
  }

  @ButtonComponent({ id: new RegExp(`^${GJ_LIST_PAGE_PREFIX}:\\d+:\\d+:\\d+$`) })
  async handleListPage(interaction: ButtonInteraction): Promise<void> {
    const [, callerId, targetUserId, pageRaw] = interaction.customId.split(":");
    if (interaction.user.id !== callerId) {
      await safeReply(interaction, {
        content: "This journal list isn't yours to navigate.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const page = Number(pageRaw);
    if (Number.isNaN(page)) return;

    await safeDeferUpdate(interaction);

    const target = await interaction.client.users.fetch(targetUserId).catch(() => null);
    if (!target) return;

    const entries = await Member.getGameJournalList(targetUserId);
    const totalPages = Math.max(1, Math.ceil(entries.length / LIST_PAGE_SIZE));
    const safePage = Math.min(Math.max(page, 0), totalPages - 1);

    const listComponents = buildListComponents(target, entries, safePage, totalPages);
    const selectRow = buildListSelectRow(entries, callerId, targetUserId, safePage);
    const pageRow = buildListPageRow(callerId, targetUserId, safePage, totalPages);

    const components = pageRow
      ? [...listComponents, selectRow, pageRow]
      : [...listComponents, selectRow];
    await safeUpdate(interaction, { embeds: [], components, flags: COMPONENTS_V2_FLAG });
  }

  @SelectMenuComponent({ id: new RegExp(`^${GJ_ALL_SELECT_PREFIX}:\\d+:\\d+$`) })
  async handleAllSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, callerId] = interaction.customId.split(":");
    if (interaction.user.id !== callerId) {
      await safeReply(interaction, {
        content: "This member list isn't yours to navigate.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const targetUserId = interaction.values[0];
    if (!targetUserId) return;

    await safeDeferUpdate(interaction);

    const target = await interaction.client.users.fetch(targetUserId).catch(() => null);
    if (!target) return;

    const entries = await Member.getGameJournalList(targetUserId);
    if (!entries.length) {
      await safeUpdate(interaction, {
        content: `${target.displayName ?? target.username} has no game journals.`,
        embeds: [],
        components: [],
      });
      return;
    }

    const totalPages = Math.max(1, Math.ceil(entries.length / LIST_PAGE_SIZE));
    const page = 0;
    const listComponents = buildListComponents(target, entries, page, totalPages);
    const selectRow = buildListSelectRow(entries, callerId, targetUserId, page);
    const pageRow = buildListPageRow(callerId, targetUserId, page, totalPages);
    const components = pageRow
      ? [...listComponents, selectRow, pageRow]
      : [...listComponents, selectRow];
    await safeUpdate(interaction, { embeds: [], components, flags: COMPONENTS_V2_FLAG });
  }

  @ButtonComponent({ id: new RegExp(`^${GJ_ALL_PAGE_PREFIX}:\\d+:\\d+$`) })
  async handleAllPage(interaction: ButtonInteraction): Promise<void> {
    const [, callerId, pageRaw] = interaction.customId.split(":");
    if (interaction.user.id !== callerId) {
      await safeReply(interaction, {
        content: "This member list isn't yours to navigate.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const page = Number(pageRaw);
    if (Number.isNaN(page)) return;

    await safeDeferUpdate(interaction);

    const summaries = await Member.getAllJournalUsers();
    const totalPages = Math.max(1, Math.ceil(summaries.length / ALL_PAGE_SIZE));
    const safePage = Math.min(Math.max(page, 0), totalPages - 1);
    const embed = buildAllEmbed(summaries, safePage, totalPages);
    const selectRow = buildAllSelectRow(summaries, callerId, safePage);
    const pageRow = buildAllPageRow(callerId, safePage, totalPages);
    const components = pageRow ? [selectRow, pageRow] : [selectRow];
    await safeUpdate(interaction, { embeds: [embed], components });
  }

  @ButtonComponent({ id: new RegExp(`^${GJ_SEARCH_PAGE_PREFIX}:\\d+:\\d+:\\d+:\\d+:.+$`) })
  async handleSearchPage(interaction: ButtonInteraction): Promise<void> {
    const parts = interaction.customId.split(":");
    const [, callerId, targetUserId, gameIdStr, pageRaw, ...queryParts] = parts;
    if (interaction.user.id !== callerId) {
      await safeReply(interaction, {
        content: "This search isn't yours to navigate.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const page = Number(pageRaw);
    if (Number.isNaN(page)) return;

    const query = queryParts.join(":");
    if (!query) return;

    await safeDeferUpdate(interaction);

    const gameId = gameIdStr !== "0" && Number(gameIdStr) > 0
      ? Number(gameIdStr)
      : undefined;
    const userId = targetUserId !== "0" ? targetUserId : undefined;

    const [{ rows, total }, gameRecord, threadIds] = await Promise.all([
      Member.searchJournalEntries({
        query,
        userId,
        gameId,
        limit: SEARCH_PAGE_SIZE,
        offset: page * SEARCH_PAGE_SIZE,
      }),
      gameId ? Game.getGameById(gameId) : Promise.resolve(null),
      gameId ? getThreadsByGameId(gameId) : Promise.resolve([]),
    ]);

    const rawGameTitle = gameRecord?.title ?? null;
    const threadId = threadIds[0] ?? null;
    const gameTitlePart = rawGameTitle
      ? (interaction.guildId && threadId
        ? `[${rawGameTitle}](https://discord.com/channels/${interaction.guildId}/${threadId})`
        : rawGameTitle)
      : null;
    const fetchedUser = targetUserId !== "0"
      ? await interaction.client.users.fetch(targetUserId).catch(() => null)
      : null;
    const targetUser = fetchedUser
      ? { id: fetchedUser.id, displayName: fetchedUser.displayName ?? fetchedUser.username }
      : null;
    const totalPages = Math.max(1, Math.ceil(total / SEARCH_PAGE_SIZE));
    const safePage = Math.min(Math.max(page, 0), totalPages - 1);

    const searchComponents = buildSearchResultComponents(
      targetUser, gameTitlePart, query, rows, total, safePage, totalPages,
    );
    const nextPageRow = buildSearchPageRow(
      callerId, targetUserId, gameIdStr, query, safePage, totalPages,
    );
    const allComponents = nextPageRow
      ? [...searchComponents, nextPageRow]
      : searchComponents;
    await safeUpdate(interaction, { embeds: [], components: allComponents, flags: COMPONENTS_V2_FLAG });
  }

  @ButtonComponent({ id: new RegExp(`^${GJ_VIEW_PAGE_PREFIX}:\\d+:\\d+:\\d+:\\d+$`) })
  async handleViewPage(interaction: ButtonInteraction): Promise<void> {
    const [, callerId, targetUserId, gameIdRaw, pageRaw] = interaction.customId.split(":");
    if (interaction.user.id !== callerId) {
      await safeReply(interaction, {
        content: "This journal isn't yours to navigate.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const gameId = Number(gameIdRaw);
    const page = Number(pageRaw);
    if (Number.isNaN(gameId) || Number.isNaN(page)) return;

    await safeDeferUpdate(interaction);
    const isOwner = callerId === targetUserId;
    const payload = await buildJournalViewPayload(
      callerId, targetUserId, gameId, page, interaction.guildId, isOwner,
    );
    await safeUpdate(interaction, {
      components: payload.components,
      files: payload.files,
      flags: payload.flags,
      allowedMentions: payload.allowedMentions,
    });
    if (interaction.guildId && interaction.message) {
      await trackNowPlayingJournalContext(
        interaction.message as Message<boolean>, targetUserId, gameId,
      );
    }
  }

  @ButtonComponent({ id: /^game-journal-header-add:\d+:\d+:\d+$/ })
  async handleHeaderAdd(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, gameIdRaw, pageRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeDeferUpdate(interaction);
      return;
    }
    const gameId = Number(gameIdRaw);
    const page = Number(pageRaw);
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent("## Manage Journal"),
    );
    const row = buildHmenuActionRow(ownerId, gameId, page);
    await gjHmenu.show(interaction, ownerId, [container, row]);
  }

  @ButtonComponent({ id: /^game-journal-hmenu-add:\d+:\d+$/ })
  async handleGjHmenuAdd(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, gameIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeDeferUpdate(interaction);
      return;
    }
    const modal = buildHmenuModal(
      `${GJ_HMENU_ADD_MODAL_ID}:${ownerId}:${gameIdRaw}`,
      "Add Journal Entry",
    );
    await interaction.showModal(modal);
  }

  @ButtonComponent({ id: /^game-journal-hmenu-edit:\d+:\d+:\d+$/ })
  async handleGjHmenuEdit(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, gameIdRaw, pageRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeDeferUpdate(interaction);
      return;
    }
    const gameId = Number(gameIdRaw);
    const page = Number(pageRaw);
    const offset = Math.max(0, page - 1);
    const entries = await Member.getGameJournalEntries(ownerId, gameId, { limit: 1, offset });
    if (!entries.length) {
      await safeUpdate(interaction, {
        components: [
          new ContainerBuilder().addTextDisplayComponents(
            new TextDisplayBuilder().setContent("No journal entries to edit."),
          ),
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`${GJ_HMENU_ADD_PREFIX}:${ownerId}:${gameId}`)
              .setLabel("Add Entry")
              .setStyle(ButtonStyle.Success),
          ),
        ],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    const entry = entries[0];
    const modal = buildHmenuModal(
      `${GJ_HMENU_EDIT_MODAL_ID}:${ownerId}:${gameIdRaw}:${entry.entryId}`,
      "Edit Journal Entry",
      entry.title ?? "",
      entry.body,
    );
    await interaction.showModal(modal);
    await gjHmenu.dismiss(ownerId);
  }

  @ButtonComponent({ id: /^game-journal-hmenu-delete:\d+:\d+$/ })
  async handleGjHmenuDelete(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, gameIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeDeferUpdate(interaction);
      return;
    }
    const gameId = Number(gameIdRaw);
    const entries = await Member.getGameJournalEntries(ownerId, gameId, {
      limit: 5,
      offset: 0,
    });
    if (!entries.length) {
      await safeUpdate(interaction, {
        components: [
          new ContainerBuilder().addTextDisplayComponents(
            new TextDisplayBuilder().setContent("No journal entries to delete."),
          ),
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`${GJ_HMENU_ADD_PREFIX}:${ownerId}:${gameId}`)
              .setLabel("Add Entry")
              .setStyle(ButtonStyle.Success),
          ),
        ],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    const options = entries.map((e) => ({
      label: (e.title ?? `Entry #${e.entryNumber}`).slice(0, 100),
      value: String(e.entryId),
      description: formatTableDate(e.createdAt),
    }));
    const select = new StringSelectMenuBuilder()
      .setCustomId(`${GJ_HMENU_DELETE_SELECT_PREFIX}:${ownerId}:${gameId}`)
      .setPlaceholder("Choose an entry to delete")
      .addOptions(options);
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## Delete Journal Entry\nSelect an entry to delete.",
      ),
    );
    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
    const helpRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${NOW_PLAYING_HELP_PREFIX}:journal-delete:${ownerId}`)
        .setLabel("?")
        .setStyle(ButtonStyle.Secondary),
    );
    await safeUpdate(interaction, {
      components: [container, row, helpRow],
      flags: buildComponentsV2Flags(true),
    });
  }

  @SelectMenuComponent({ id: /^game-journal-hmenu-delete-select:\d+:\d+$/ })
  async handleGjHmenuDeleteSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const [, ownerId, gameIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeDeferUpdate(interaction);
      return;
    }
    const entryId = Number(interaction.values[0]);
    const entry = await Member.getGameJournalEntryForUser(ownerId, entryId);
    if (!entry || entry.gameId !== Number(gameIdRaw)) {
      await safeReply(interaction, { content: "That journal entry was not found." });
      return;
    }
    const entryTitle = entry.title?.trim() ? entry.title.trim() : `Entry #${entry.entryNumber}`;
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Confirm Delete\nDelete **${entryTitle}** from ${formatTableDate(entry.createdAt)}?`,
      ),
    );
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(
          `${GJ_HMENU_DELETE_CONFIRM_PREFIX}:yes:${ownerId}:${gameIdRaw}:${entryId}`,
        )
        .setLabel("Delete")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(
          `${GJ_HMENU_DELETE_CONFIRM_PREFIX}:no:${ownerId}:${gameIdRaw}:${entryId}`,
        )
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${NOW_PLAYING_HELP_PREFIX}:journal-delete-confirm:${ownerId}`)
        .setLabel("?")
        .setStyle(ButtonStyle.Secondary),
    );
    await safeUpdate(interaction, {
      components: [container, row],
      flags: buildComponentsV2Flags(true),
    });
  }

  @ButtonComponent({ id: /^game-journal-hmenu-delete-confirm:(yes|no):\d+:\d+:\d+$/ })
  async handleGjHmenuDeleteConfirm(interaction: ButtonInteraction): Promise<void> {
    const [, action, ownerId, gameIdRaw, entryIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeDeferUpdate(interaction);
      return;
    }
    if (action === "yes") {
      const removed = await Member.deleteGameJournalEntry(ownerId, Number(entryIdRaw));
      if (!removed) {
        await safeReply(interaction, { content: "That journal entry was not found." });
        return;
      }
    }
    const gameId = Number(gameIdRaw);
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent("## Manage Journal"),
    );
    const row = buildHmenuActionRow(ownerId, gameId);
    await safeUpdate(interaction, {
      components: [container, row],
      flags: buildComponentsV2Flags(true),
    });
    if (action === "yes") {
      await refreshJournalMessages(interaction.client, ownerId, gameId);
    }
  }

  @ModalComponent({ id: /^game-journal-hmenu-add-modal:\d+:\d+$/ })
  async handleGjHmenuAddModal(interaction: ModalSubmitInteraction): Promise<void> {
    const [, ownerId, gameIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, { content: "Only the owner can submit journal entries." });
      return;
    }
    const title = sanitizeUserInput(
      interaction.fields.getTextInputValue(JOURNAL_TITLE_INPUT_ID) ?? "",
      { preserveNewlines: true, maxLength: 120 },
    );
    const body = sanitizeUserInput(
      interaction.fields.getTextInputValue(JOURNAL_BODY_INPUT_ID),
      { preserveNewlines: true, maxLength: 2000 },
    );
    const gameId = Number(gameIdRaw);
    await Member.addGameJournalEntry({ userId: ownerId, gameId, title: title || null, body });
    await Member.upsertGameJournalPreference(ownerId, gameId, true);
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent("## Manage Journal"),
    );
    const row = buildHmenuActionRow(ownerId, gameId);
    await safeUpdate(interaction, {
      components: [container, row],
      flags: buildComponentsV2Flags(true),
    });
    await refreshJournalMessages(interaction.client, ownerId, gameId);
  }

  @ModalComponent({ id: /^game-journal-hmenu-edit-modal:\d+:\d+:\d+$/ })
  async handleGjHmenuEditModal(interaction: ModalSubmitInteraction): Promise<void> {
    const [, ownerId, gameIdRaw, entryIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, { content: "Only the owner can edit journal entries." });
      return;
    }
    const gameId = Number(gameIdRaw);
    const entryId = Number(entryIdRaw);
    const existing = await Member.getGameJournalEntryForUser(ownerId, entryId);
    if (!existing || existing.gameId !== gameId) {
      await safeReply(interaction, { content: "That journal entry was not found." });
      return;
    }
    const title = sanitizeUserInput(
      interaction.fields.getTextInputValue(JOURNAL_TITLE_INPUT_ID) ?? "",
      { preserveNewlines: true, maxLength: 120 },
    );
    const body = sanitizeUserInput(
      interaction.fields.getTextInputValue(JOURNAL_BODY_INPUT_ID),
      { preserveNewlines: true, maxLength: 2000 },
    );
    await Member.updateGameJournalEntry({ userId: ownerId, entryId, title: title || null, body });
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent("## Manage Journal"),
    );
    const row = buildHmenuActionRow(ownerId, gameId);
    await safeUpdate(interaction, {
      components: [container, row],
      flags: buildComponentsV2Flags(true),
    });
    await refreshJournalMessages(interaction.client, ownerId, gameId);
  }

  @ButtonComponent({ id: new RegExp(`^${GJ_CLOSE_PREFIX}:\\d+$`) })
  async handlePublicClose(interaction: ButtonInteraction): Promise<void> {
    const [, callerId] = interaction.customId.split(":");
    if (interaction.user.id !== callerId) {
      await safeReply(interaction, {
        content: "Only the person who opened this journal can close it.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferUpdate();
    await interaction.message.delete();
  }
}
