import {
  ApplicationCommandOptionType,
  type CommandInteraction,
  EmbedBuilder,
  type User,
  AttachmentBuilder,
  MessageFlags,
  ComponentType,
  ModalBuilder,
  ModalSubmitInteraction,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
  type ActionRow,
  type MessageActionRowComponent,
  type Client,
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
import {
  ContainerBuilder,
  ModalBuilder as ComponentsModalBuilder,
  ActionRowBuilder as ComponentsActionRowBuilder,
  TextInputBuilder as ComponentsTextInputBuilder,
  LabelBuilder,
  RadioGroupBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ButtonBuilder as V2ButtonBuilder,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "@discordjs/builders";
import { SeparatorSpacingSize, TextInputStyle as ApiTextInputStyle } from "discord-api-types/v10";
import crypto from "node:crypto";
import Member, { type IMemberNowPlayingEntry } from "../classes/Member.js";
import {
  safeDeferReply,
  safeDeferUpdate,
  safeReply,
  safeUpdate,
  sanitizeUserInput,
  stripModalInput,
  type AnyRepliable,
} from "../functions/InteractionUtils.js";
import Game, { type IGame } from "../classes/Game.js";
import { igdbService } from "../services/IGDB/IgdbService.js";
import {
  createIgdbSession,
  type IgdbSelectOption,
} from "../services/IGDB/IgdbSelectService.js";
import {
  announceCompletion,
  notifyUnknownCompletionPlatform,
} from "../functions/CompletionHelpers.js";
import { formatPlatformDisplayName } from "../functions/PlatformDisplay.js";
import {
  autocompleteGameCompletionPlatform,
  autocompleteGameCompletionTitle,
  resolveGameCompletionPlatformId,
} from "./game-completion/completion-autocomplete.utils.js";
import {
  COMPLETION_TYPES,
  type CompletionType,
  formatDiscordTimestamp,
  formatPlaytimeHours,
  formatTableDate,
  parseCompletionDateInput,
} from "../commands/profile.command.js";
import { parseTitleWithYear } from "../functions/GameTitleAutocompleteUtils.js";
import { COMPONENTS_V2_FLAG } from "../config/flags.js";
import { REGULARS_ROLE_ID } from "../config/roles.js";
import { STANDARD_PLATFORM_IDS } from "../config/standardPlatforms.js";
import { composeVoteImage } from "../services/collageGenerator.js";
import {
  getOrReplaceBackblazeImage,
  hasBackblazeB2Config,
} from "../services/BackblazeB2Service.js";

const MAX_NOW_PLAYING_NOTE_LEN = 500;
const NOW_PLAYING_SEARCH_LIMIT = 10;
const NOW_PLAYING_SORT_SLOT_PREFIX = "nowplaying-sort-slot";
const NOW_PLAYING_SORT_SAVE_PREFIX = "nowplaying-sort-save";
const NOW_PLAYING_SORT_RESET_PREFIX = "nowplaying-sort-reset";
const NOW_PLAYING_NOTE_MODAL_ID = "nowplaying-note-modal";
const NOW_PLAYING_NOTE_INPUT_ID = "nowplaying-note-input";
const NOW_PLAYING_NOTE_MODAL_MAX_FIELDS = 5;
const NOW_PLAYING_ADD_MODAL_ID = "nowplaying-add-modal";
const NOW_PLAYING_ADD_TITLE_INPUT_ID = "nowplaying-add-title";
const NOW_PLAYING_ADD_NOTE_INPUT_ID = "nowplaying-add-note";
const NOW_PLAYING_ADD_PLATFORM_SELECT_PREFIX = "nowplaying-add-platform-select";
const NOW_PLAYING_EDIT_PLATFORM_SELECT_PREFIX = "nowplaying-edit-platform-select";
const NOW_PLAYING_EDIT_PLATFORM_SLOT_PREFIX = "nowplaying-edit-platform-slot";
const NOW_PLAYING_EDIT_PLATFORM_SAVE_PREFIX = "nowplaying-edit-platform-save";
const NOW_PLAYING_EDIT_PLATFORM_RESET_PREFIX = "nowplaying-edit-platform-reset";
const NOW_PLAYING_COMPLETE_MODAL_ID = "nowplaying-complete-modal";
const NOW_PLAYING_COMPLETE_DATE_INPUT_ID = "nowplaying-complete-date";
const NOW_PLAYING_COMPLETE_HOURS_INPUT_ID = "nowplaying-complete-hours";
const NOW_PLAYING_COMPLETE_NOTE_INPUT_ID = "nowplaying-complete-note";
const NOW_PLAYING_COMPLETE_PICK_PREFIX = "np-complete-pick";
const NOW_PLAYING_COMPLETE_TYPE_SELECT_PREFIX = "np-complete-type";
const NOW_PLAYING_COMPLETE_REMOVE_SELECT_PREFIX = "np-complete-remove";
const NOW_PLAYING_COMPLETE_ANNOUNCE_SELECT_PREFIX = "np-complete-announce";
const NOW_PLAYING_COMPLETE_NOTE_SELECT_PREFIX = "np-complete-note";
const NOW_PLAYING_COMPLETE_DETAILS_PREFIX = "np-complete-details";
const NOW_PLAYING_COMPLETE_PLATFORM_SELECT_PREFIX = "np-complete-platform";
const NOW_PLAYING_GALLERY_MAX = 5;
const NOW_PLAYING_COMPOSITE_MAX = 10;
const NOW_PLAYING_ALL_SELECT_ID = "nowplaying-all-select:v1";
const NOW_PLAYING_LIST_NOTES_PREFIX = "nowplaying-list-notes";
const NOW_PLAYING_LIST_EDIT_PREFIX = "nowplaying-list-edit";
const NOW_PLAYING_EDIT_MENU_NOTE_PREFIX = "nowplaying-edit-menu-note";
const NOW_PLAYING_EDIT_MENU_SORT_PREFIX = "nowplaying-edit-menu-sort";
const NOW_PLAYING_EDIT_MENU_PLATFORM_PREFIX = "nowplaying-edit-menu-platform";
const NOW_PLAYING_EDIT_MENU_COMPLETE_PREFIX = "nowplaying-edit-menu-complete";
const NOW_PLAYING_EDIT_MENU_REMOVE_PREFIX = "nowplaying-edit-menu-remove";
const NOW_PLAYING_EDIT_MENU_JOURNAL_PREFIX = "nowplaying-edit-menu-journal";
const NOW_PLAYING_JOURNAL_OPTIN_SELECT_PREFIX = "nowplaying-journal-optin-select";
const NOW_PLAYING_REMOVE_SELECT_PREFIX = "nowplaying-remove-select";
const NOW_PLAYING_JOURNAL_OPEN_PREFIX = "nowplaying-journal-open";
const NOW_PLAYING_JOURNAL_ADD_PREFIX = "nowplaying-journal-add";
const NOW_PLAYING_JOURNAL_EDIT_PREFIX = "nowplaying-journal-edit";
const NOW_PLAYING_JOURNAL_EDIT_SELECT_PREFIX = "nowplaying-journal-edit-select";
const NOW_PLAYING_JOURNAL_DELETE_PREFIX = "nowplaying-journal-delete";
const NOW_PLAYING_JOURNAL_DELETE_SELECT_PREFIX = "nowplaying-journal-delete-select";
const NOW_PLAYING_JOURNAL_DELETE_CONFIRM_PREFIX = "nowplaying-journal-delete-confirm";
const NOW_PLAYING_JOURNAL_PAGE_PREFIX = "nowplaying-journal-page";
const NOW_PLAYING_JOURNAL_MODAL_ID = "nowplaying-journal-modal";
const NOW_PLAYING_JOURNAL_EDIT_MODAL_ID = "nowplaying-journal-edit-modal";
const NOW_PLAYING_JOURNAL_TITLE_INPUT_ID = "nowplaying-journal-title";
const NOW_PLAYING_JOURNAL_BODY_INPUT_ID = "nowplaying-journal-body";
const NOW_PLAYING_JOURNAL_PRIVACY_INPUT_ID = "nowplaying-journal-privacy";
type NowPlayingAddSession = {
  userId: string;
  query: string;
  note: string | null;
  timeoutId?: ReturnType<typeof setTimeout>;
};
type NowPlayingAddPlatformSession = {
  userId: string;
  gameId: number;
  note: string | null;
  sourceSessionId: string;
};
const nowPlayingAddSessions = new Map<string, NowPlayingAddSession>();
const nowPlayingAddPlatformSessions = new Map<string, NowPlayingAddPlatformSession>();

type NowPlayingCompletionWizardSession = {
  userId: string;
  gameId: number | null;
  completionType: CompletionType;
  removeFromNowPlaying: boolean;
  announce: boolean;
  addCompletionNote: boolean;
  returnToList: boolean;
};
const nowPlayingCompletionWizardSessions = new Map<string, NowPlayingCompletionWizardSession>();
type NowPlayingCompletionPlatformSession = {
  sessionId: string;
  userId: string;
  gameId: number;
  completionType: CompletionType;
  completedAt: Date | null;
  finalPlaytimeHours: number | null;
  note: string | null;
  removeFromNowPlaying: boolean;
  announce: boolean;
  returnToList: boolean;
  platforms: Array<{ id: number; name: string }>;
};
const nowPlayingCompletionPlatformSessions = new Map<
  string,
  NowPlayingCompletionPlatformSession
>();
type NowPlayingTrackedView = "single" | "everyone" | "everyone-selected";
type NowPlayingListContext = {
  channelId: string;
  messageId: string;
  createdAt: number;
  view: NowPlayingTrackedView;
  ownerUserId: string | null;
  selectedUserId: string | null;
};
const nowPlayingListContexts = new Map<string, NowPlayingListContext>();
const NOW_PLAYING_CONTEXT_TTL_MS = 3 * 60 * 60 * 1000;
type NowPlayingJournalContext = {
  channelId: string;
  messageId: string;
  createdAt: number;
  ownerUserId: string;
  gameId: number;
};
const nowPlayingJournalContexts = new Map<string, NowPlayingJournalContext>();
const NOW_PLAYING_JOURNAL_CONTEXT_TTL_MS = 2 * 60 * 60 * 1000;
type NowPlayingMessageComponents = Array<
  ContainerBuilder | MediaGalleryBuilder | ActionRowBuilder<ButtonBuilder>
>;

function extractJournalPrivacyFromInteraction(interaction: ModalSubmitInteraction): boolean {
  const components = (interaction.components ?? []) as Array<{
    components?: Array<{ customId?: string; value?: unknown; values?: unknown }>;
    component?: { customId?: string; value?: unknown; values?: unknown };
  }>;
  const fields: Array<{ customId?: string; value?: unknown; values?: unknown }> = [];
  for (const topLevel of components) {
    if (Array.isArray(topLevel.components)) {
      fields.push(...topLevel.components);
    } else if (topLevel.component) {
      fields.push(topLevel.component);
    }
  }
  for (const field of fields) {
    if (field.customId !== NOW_PLAYING_JOURNAL_PRIVACY_INPUT_ID) {
      continue;
    }
    if (typeof field.value === "string") {
      return field.value.toLowerCase() === "public";
    }
    if (Array.isArray(field.values) && typeof field.values[0] === "string") {
      return field.values[0].toLowerCase() === "public";
    }
  }
  return false;
}
type NowPlayingListComponents = ContainerBuilder[];

function buildComponentsV2Flags(isEphemeral: boolean): number {
  return (isEphemeral ? MessageFlags.Ephemeral : 0) | COMPONENTS_V2_FLAG;
}

function buildNowPlayingSortStateToken(entryCount: number): string {
  return Array.from({ length: entryCount }, (_, index) => index.toString(36)).join("");
}

function parseNowPlayingSortStateToken(
  token: string,
  entryCount: number,
): number[] | null {
  if (token.length !== entryCount) {
    return null;
  }
  const parsed: number[] = [];
  for (const character of token) {
    if (character === "_") {
      parsed.push(-1);
      continue;
    }
    const value = Number.parseInt(character, 36);
    if (!Number.isInteger(value) || value < 0 || value >= entryCount) {
      return null;
    }
    parsed.push(value);
  }
  return parsed;
}

function encodeNowPlayingSortState(state: number[]): string {
  return state.map((value) => (value < 0 ? "_" : value.toString(36))).join("");
}

function parseNowPlayingPlatformStateToken(
  token: string,
  entryCount: number,
): number[] | null {
  if (token.length !== entryCount) {
    return null;
  }
  const parsed: number[] = [];
  for (const character of token) {
    if (character === "_") {
      parsed.push(-1);
      continue;
    }
    const value = Number.parseInt(character, 36);
    if (!Number.isInteger(value) || value < 0 || value > 24) {
      return null;
    }
    parsed.push(value);
  }
  return parsed;
}

function encodeNowPlayingPlatformState(state: number[]): string {
  return state.map((value) => (value < 0 ? "_" : value.toString(36))).join("");
}

function buildNowPlayingPlatformStateFromCurrent(
  entries: IMemberNowPlayingEntry[],
  platformOptions: Array<Array<{ label: string; value: string; platformId: number }>>,
): string {
  const state = entries.map((entry, slotIndex) => {
    const options = platformOptions[slotIndex] ?? [];
    const selectedIndex = options.findIndex((option) => option.platformId === entry.platformId);
    return selectedIndex >= 0 ? selectedIndex : -1;
  });
  return encodeNowPlayingPlatformState(state);
}

async function confirmDuplicateCompletion(
  interaction: CommandInteraction | ModalSubmitInteraction | ButtonInteraction,
  gameTitle: string,
  existing: Awaited<ReturnType<typeof Member.getRecentCompletionForGame>>,
): Promise<boolean> {
  if (!existing) return true;

  const promptId = `np-comp-dup:${interaction.user.id}:${Date.now()}`;
  const yesId = `${promptId}:yes`;
  const noId = `${promptId}:no`;
  const dateText = existing.completedAt
    ? formatDiscordTimestamp(existing.completedAt)
    : "No date";
  const playtimeText = formatPlaytimeHours(existing.finalPlaytimeHours);
  const detailParts = [existing.completionType, dateText, playtimeText].filter(Boolean);
  const noteLine = existing.note ? `\n> ${existing.note}` : "";

  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `We found a completion for **${gameTitle}** within the last week:\n` +
        `• ${detailParts.join(" — ")} (Completion #${existing.completionId})${noteLine}\n\n` +
        "Add another completion anyway?",
    ),
  );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(yesId)
      .setLabel("Add Another")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(noId)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary),
  );

  const payload = {
    components: [container, row],
    flags: buildComponentsV2Flags(true),
  };

  let message: Message | null = null;
  try {
    if (interaction.deferred || interaction.replied) {
      const reply = await interaction.followUp(payload as any);
      message = reply as Message;
    } else {
      const reply = await interaction.reply({ ...payload, withResponse: true } as any);
      message = reply.resource?.message ?? null;
    }
  } catch {
    try {
      const reply = await interaction.followUp(payload as any);
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
    const resultContainer = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        confirmed ? "Adding another completion." : "Cancelled.",
      ),
    );
    await selection.update({
      components: [resultContainer],
      flags: buildComponentsV2Flags(true),
    });
    return confirmed;
  } catch {
    return false;
  }
}

function createNowPlayingCompletionWizardSession(
  userId: string,
  returnToList: boolean = false,
): string {
  const sessionId = `np-comp-ui-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const defaultType = (COMPLETION_TYPES[0] ?? "Main Story") as CompletionType;
  nowPlayingCompletionWizardSessions.set(sessionId, {
    userId,
    gameId: null,
    completionType: defaultType,
    removeFromNowPlaying: true,
    announce: true,
    addCompletionNote: true,
    returnToList,
  });
  return sessionId;
}

function clearNowPlayingAddSession(sessionId: string): void {
  const session = nowPlayingAddSessions.get(sessionId);
  if (session?.timeoutId) {
    clearTimeout(session.timeoutId);
  }
  nowPlayingAddSessions.delete(sessionId);
}

function buildNowPlayingContextKey(channelId: string, messageId: string): string {
  return `${channelId}:${messageId}`;
}

function buildNowPlayingJournalContextKey(channelId: string, messageId: string): string {
  return `${channelId}:${messageId}`;
}

function trackNowPlayingListContext(message: Message<boolean>, context: {
  view: NowPlayingTrackedView;
  ownerUserId?: string | null;
  selectedUserId?: string | null;
}): void {
  if (message.flags.has(MessageFlags.Ephemeral)) {
    return;
  }
  const key = buildNowPlayingContextKey(message.channelId, message.id);
  const existing = nowPlayingListContexts.get(key);
  nowPlayingListContexts.set(key, {
    channelId: message.channelId,
    messageId: message.id,
    createdAt: existing?.createdAt ?? Date.now(),
    view: context.view,
    ownerUserId: context.ownerUserId ?? null,
    selectedUserId: context.selectedUserId ?? null,
  });
}

function setNowPlayingListContext(userId: string, message: Message<boolean>): void {
  trackNowPlayingListContext(message, {
    view: "single",
    ownerUserId: userId,
  });
}

function trackNowPlayingJournalContext(
  message: Message<boolean>,
  ownerUserId: string,
  gameId: number,
): void {
  if (message.flags.has(MessageFlags.Ephemeral)) {
    return;
  }
  const key = buildNowPlayingJournalContextKey(message.channelId, message.id);
  const existing = nowPlayingJournalContexts.get(key);
  nowPlayingJournalContexts.set(key, {
    channelId: message.channelId,
    messageId: message.id,
    createdAt: existing?.createdAt ?? Date.now(),
    ownerUserId,
    gameId,
  });
}

function resolvePlatformLabel(entry: IMemberNowPlayingEntry): string | null {
  const candidate =
    entry.platformAbbreviation ??
    formatPlatformDisplayName(entry.platformName) ??
    entry.platformName ??
    "Unknown Platform";
  if (candidate === "Unknown Platform") {
    return null;
  }
  return candidate;
}

function formatEntry(
  entry: IMemberNowPlayingEntry,
  guildId: string | null,
): string {
  const platformLabel = resolvePlatformLabel(entry);
  const baseTitle = platformLabel
    ? `${entry.title} (${platformLabel})`
    : entry.title;
  if (entry.threadId && guildId) {
    return `[${baseTitle}](https://discord.com/channels/${guildId}/${entry.threadId})`;
  }
  return baseTitle;
}

function formatEntryTitleWithPlatform(
  entry: { title: string; platformName: string | null },
): string {
  const platformLabel = resolvePlatformLabel(entry as IMemberNowPlayingEntry);
  return platformLabel
    ? `${entry.title} (${platformLabel})`
    : entry.title;
}

function sortNowPlayingEntries(
  entries: IMemberNowPlayingEntry[],
): IMemberNowPlayingEntry[] {
  return [...entries].sort((a, b) => {
    const titleA = a.title.toLowerCase();
    const titleB = b.title.toLowerCase();
    const titleCompare = titleA.localeCompare(titleB);
    if (titleCompare !== 0) return titleCompare;
    const gameIdA = a.gameId ?? 0;
    const gameIdB = b.gameId ?? 0;
    return gameIdA - gameIdB;
  });
}

function getDisplayNowPlayingEntries(
  entries: IMemberNowPlayingEntry[],
): IMemberNowPlayingEntry[] {
  const hasManualOrder = entries.some((entry) => entry.sortOrder != null);
  return hasManualOrder ? entries : sortNowPlayingEntries(entries);
}

function buildEditNoteModal(
  ownerId: string,
  gameId: number,
  title: string,
  currentNote: string | null,
): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId(NOW_PLAYING_NOTE_INPUT_ID)
    .setLabel(title.slice(0, 45))
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(MAX_NOW_PLAYING_NOTE_LEN)
    .setValue(currentNote ?? "");

  return new ModalBuilder()
    .setCustomId(`${NOW_PLAYING_NOTE_MODAL_ID}:${ownerId}:${gameId}`)
    .setTitle("Edit Now Playing Note")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
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
    const input = new TextInputBuilder()
      .setCustomId(`${NOW_PLAYING_NOTE_INPUT_ID}:${entry.gameId}`)
      .setLabel(formatEntryTitleWithPlatform(entry).slice(0, 45))
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(MAX_NOW_PLAYING_NOTE_LEN)
      .setValue(entry.note ?? "");
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
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
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Please provide a game title from autocomplete."),
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(ephemeral),
      });
      return;
    }

    const game = await this.resolveNowPlayingGameByTitle(title);
    if (!game) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `I could not find a unique GameDB match for "${title}". Please choose from autocomplete.`,
        ),
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(ephemeral),
      });
      return;
    }

    const platformId = await resolveGameCompletionPlatformId(rawPlatform);
    if (!platformId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Please choose a platform from autocomplete."),
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(ephemeral),
      });
      return;
    }

    const platform = await Game.getPlatformById(platformId);
    if (!platform) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Selected platform was not found."),
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(ephemeral),
      });
      return;
    }

    try {
      await Member.addNowPlaying(interaction.user.id, game.id, platformId, note);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`Could not add to Now Playing: ${msg}`),
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(ephemeral),
      });
      return;
    }

    const replacedCurrentChannelMessage = !ephemeral && interaction.channelId
      ? await this.replaceNowPlayingMessageInCurrentChannel(interaction, interaction.user.id)
      : false;
    await this.refreshNowPlayingListFromContext(interaction, interaction.user.id).catch(() => {});
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
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Please provide a title to search."),
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(ephemeral),
      });
      return;
    }

    const nowPlayingRows = await Member.getNowPlayingByTitleSearch(query);
    if (!nowPlayingRows.length) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `No one is currently playing GameDB titles matching "${query}".`,
        ),
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(ephemeral),
      });
      return;
    }

    const usersByGameId = new Map<number, { title: string; users: string[] }>();
    for (const row of nowPlayingRows) {
      const record = usersByGameId.get(row.gameId) ?? { title: row.title, users: [] };
      record.users.push(`<@${row.userId}>`);
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
    const content = this.trimTextDisplayContent(contentLines.join("\n"));
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(content),
    );

    await safeReply(interaction, {
      components: [container],
      flags: buildComponentsV2Flags(ephemeral),
    });
  }

  @ModalComponent({ id: NOW_PLAYING_ADD_MODAL_ID })
  async handleAddNowPlayingModal(interaction: ModalSubmitInteraction): Promise<void> {
    const query = stripModalInput(
      interaction.fields.getTextInputValue(NOW_PLAYING_ADD_TITLE_INPUT_ID),
    );
    const noteRaw = stripModalInput(
      interaction.fields.getTextInputValue(NOW_PLAYING_ADD_NOTE_INPUT_ID),
    );
    if (!query) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Please provide a title to search."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    if (noteRaw.length > MAX_NOW_PLAYING_NOTE_LEN) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `Note must be ${MAX_NOW_PLAYING_NOTE_LEN} characters or fewer.`,
        ),
      );
      await interaction.reply({
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
      const sessionId = `np-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
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
      const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
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
      const content = this.trimTextDisplayContent(contentLines.join("\n"));
      const container = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
        .addActionRowComponents(selectRow.toJSON());

      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });

      session.timeoutId = setTimeout(async () => {
        try {
          if (!nowPlayingAddSessions.has(sessionId)) {
            return;
          }
          const reply = await interaction.fetchReply();
          const hasMatchingSelect = reply.components.some((row) => {
            if (!("components" in row)) return false;
            const actionRow = row as ActionRow<MessageActionRowComponent>;
            return actionRow.components.some(
              (component) =>
                "customId" in component && component.customId === selectId,
            );
          });
          if (!hasMatchingSelect) return;

          const timeoutContainer = new ContainerBuilder().addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              "Timed out waiting for a selection. No changes made.",
            ),
          );
          await interaction.editReply({
            components: [timeoutContainer],
            flags: buildComponentsV2Flags(true),
          });
          clearNowPlayingAddSession(sessionId);
        } catch {
          // ignore
        }
      }, 60_000);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`Could not add to Now Playing: ${msg}`),
      );
      await interaction.reply({
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
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(NOW_PLAYING_ADD_TITLE_INPUT_ID)
            .setLabel("Game title")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(100),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(NOW_PLAYING_ADD_NOTE_INPUT_ID)
            .setLabel("Note (optional)")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(MAX_NOW_PLAYING_NOTE_LEN),
        ),
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
        this.trimTextDisplayContent(headerLines.join("\n")),
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
    const detailsButton = new ButtonBuilder()
      .setCustomId(`${NOW_PLAYING_COMPLETE_DETAILS_PREFIX}:${sessionId}`)
      .setLabel("Continue")
      .setStyle(ButtonStyle.Primary);
    const cancelButton = new ButtonBuilder()
      .setCustomId(`nowplaying-list-cancel:${session.userId}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary);

    const typeRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(typeSelect);
    const removeRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(removeSelect);
    const announceRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(announceSelect);
    const noteRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(noteSelect);
    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      detailsButton,
      cancelButton,
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
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("That game is no longer in your Now Playing list."),
      );
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
    const pmComponents = await this.withPmNowPlayingList(
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
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Your Now Playing list is empty."),
      );
      const pmComponents = await this.withPmNowPlayingList(ownerId, interaction.guildId, [container]);
      await safeUpdate(interaction, { components: pmComponents });
      return;
    }

    if (current.length === 1) {
      const session = nowPlayingCompletionWizardSessions.get(sessionId);
      const entry = current[0];
      if (!session || !entry?.gameId) {
        const container = new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent("Unable to start completion flow."),
        );
        await safeUpdate(interaction, { components: [container] });
        return;
      }
      session.gameId = entry.gameId;
      await this.renderNowPlayingCompletionConfig(interaction, sessionId, session);
      return;
    }

    const entries = getDisplayNowPlayingEntries(current);
    const includeImages = interaction.guildId != null;
    const { files, thumbnailsByGameId } = await this.buildNowPlayingAttachments(
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
    const pmComponents = await this.withPmNowPlayingList(ownerId, interaction.guildId, components);
    await safeUpdate(interaction, this.buildComponentPayload(pmComponents as any, files));
  }

  @ModalComponent({ id: /^nowplaying-complete-modal:[^:]+$/ })
  async handleNowPlayingCompletionModal(
    interaction: ModalSubmitInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(true) });
    const [, sessionId] = interaction.customId.split(":");
    const session = nowPlayingCompletionWizardSessions.get(sessionId);
    if (!session) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This completion prompt has expired."),
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (interaction.user.id !== session.userId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This completion prompt isn't for you."),
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (!session.gameId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Select a game first before submitting details."),
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const completionDateInput = stripModalInput(
      interaction.fields.getTextInputValue(NOW_PLAYING_COMPLETE_DATE_INPUT_ID),
    );
    const finalPlaytimeRaw = stripModalInput(
      interaction.fields.getTextInputValue(NOW_PLAYING_COMPLETE_HOURS_INPUT_ID),
    );
    const noteInput = session.addCompletionNote
      ? stripModalInput(
        interaction.fields.getTextInputValue(NOW_PLAYING_COMPLETE_NOTE_INPUT_ID),
      )
      : "";

    let completedAt: Date | null = null;
    try {
      completedAt = this.parseNowPlayingCompletionDate(completionDateInput);
    } catch (err: any) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(err?.message ?? "Invalid completion date."),
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const finalPlaytimeHours = finalPlaytimeRaw
      ? Number(finalPlaytimeRaw)
      : null;
    if (
      finalPlaytimeHours !== null &&
      (Number.isNaN(finalPlaytimeHours) || finalPlaytimeHours < 0)
    ) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          "Final playtime must be a non-negative number of hours.",
        ),
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const note = noteInput ? noteInput : null;

    const game = await Game.getGameById(session.gameId);
    if (!game) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("That game could not be found."),
      );
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
    const [, platformSessionId] = interaction.customId.split(":");
    const session = nowPlayingCompletionPlatformSessions.get(platformSessionId);
    if (!session) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This completion prompt has expired."),
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (interaction.user.id !== session.userId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This completion prompt isn't for you."),
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

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
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Invalid platform selection."),
      );
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
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("That game could not be found."),
      );
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
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("No platform data is available for this game."),
      );
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
    const platformSessionId = `np-comp-platform-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
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
      label: platform.name.slice(0, 100),
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
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(content),
    );
    await safeReply(interaction, {
      components: await this.withPmNowPlayingList(
        session.userId,
        interaction.guildId,
        [
          container,
          new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
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
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`Could not save completion: ${msg}`),
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (session.removeFromNowPlaying) {
      await Member.removeNowPlaying(session.userId, game.id).catch(() => {});
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
      await this.refreshNowPlayingListFromContext(interaction, session.userId).catch(() => {});
    }

    if (session.returnToList) {
      const entries = getDisplayNowPlayingEntries(
        await Member.getNowPlaying(session.userId),
      );
      if (!entries.length) {
        const container = new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent("Your Now Playing list is empty."),
        );
        await safeReply(interaction, {
          components: [container],
          flags: buildComponentsV2Flags(true),
        });
      } else {
        const includeImages = interaction.guildId != null;
        const { files, thumbnailsByGameId } = await this.buildNowPlayingAttachments(
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
          ...this.buildComponentPayload(components, files),
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
    const content = this.trimTextDisplayContent(detailLines.join("\n"));
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(content),
    );
    await safeReply(interaction, {
      components: [container],
      flags: buildComponentsV2Flags(true),
    });
    nowPlayingCompletionWizardSessions.delete(sessionId);
  }

  @ButtonComponent({ id: /^np-complete-pick:[^:]+:\d+$/ })
  async handleNowPlayingCompletionPick(interaction: ButtonInteraction): Promise<void> {
    const [, sessionId, gameIdRaw] = interaction.customId.split(":");
    const session = nowPlayingCompletionWizardSessions.get(sessionId);
    if (!session) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This completion prompt has expired."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (interaction.user.id !== session.userId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This completion prompt isn't for you."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const gameId = Number(gameIdRaw);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Invalid selection."),
      );
      await interaction.reply({
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
    const [, sessionId] = interaction.customId.split(":");
    const session = nowPlayingCompletionWizardSessions.get(sessionId);
    if (!session) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This completion prompt has expired."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (interaction.user.id !== session.userId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This completion prompt isn't for you."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const value = interaction.values?.[0];
    if (!value || !COMPLETION_TYPES.includes(value as CompletionType)) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Invalid completion type."),
      );
      await interaction.reply({
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
    const [, sessionId] = interaction.customId.split(":");
    const session = nowPlayingCompletionWizardSessions.get(sessionId);
    if (!session) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This completion prompt has expired."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (interaction.user.id !== session.userId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This completion prompt isn't for you."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const value = interaction.values?.[0];
    if (value !== "yes" && value !== "no") {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Invalid selection."),
      );
      await interaction.reply({
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
    const [, sessionId] = interaction.customId.split(":");
    const session = nowPlayingCompletionWizardSessions.get(sessionId);
    if (!session) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This completion prompt has expired."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (interaction.user.id !== session.userId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This completion prompt isn't for you."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const value = interaction.values?.[0];
    if (value !== "yes" && value !== "no") {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Invalid selection."),
      );
      await interaction.reply({
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
    const [, sessionId] = interaction.customId.split(":");
    const session = nowPlayingCompletionWizardSessions.get(sessionId);
    if (!session) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This completion prompt has expired."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (interaction.user.id !== session.userId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This completion prompt isn't for you."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const value = interaction.values?.[0];
    if (value !== "yes" && value !== "no") {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Invalid selection."),
      );
      await interaction.reply({
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
    const [, sessionId] = interaction.customId.split(":");
    const session = nowPlayingCompletionWizardSessions.get(sessionId);
    if (!session) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This completion prompt has expired."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (interaction.user.id !== session.userId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This completion prompt isn't for you."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (!session.gameId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Select a game first."),
      );
      await interaction.reply({
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
    const modalRows: ActionRowBuilder<TextInputBuilder>[] = [
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(NOW_PLAYING_COMPLETE_DATE_INPUT_ID)
          .setLabel("Completion date (blank unknown)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder("today or 03/10/2025"),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(NOW_PLAYING_COMPLETE_HOURS_INPUT_ID)
          .setLabel("Final playtime hours (optional)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false),
      ),
    ];
    if (session.addCompletionNote) {
      const noteInput = new TextInputBuilder()
        .setCustomId(NOW_PLAYING_COMPLETE_NOTE_INPUT_ID)
        .setLabel("Note (optional)")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(MAX_NOW_PLAYING_NOTE_LEN);
      if (noteValue) {
        noteInput.setValue(noteValue.slice(0, MAX_NOW_PLAYING_NOTE_LEN));
      }
      modalRows.push(new ActionRowBuilder<TextInputBuilder>().addComponents(noteInput));
    }
    modal.addComponents(...modalRows);
    await interaction.showModal(modal).catch(() => {});
  }

  @SelectMenuComponent({ id: /^nowplaying-add-select:.+$/ })
  async handleAddNowPlayingSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, sessionId] = interaction.customId.split(":");
    const session = nowPlayingAddSessions.get(sessionId);
    const ownerId = session?.userId;

    if (!session || interaction.user.id !== ownerId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This add prompt isn't for you."),
      );
      await interaction.reply({
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
    if (!Number.isInteger(gameId) || gameId <= 0) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Invalid selection. Please try again."),
      );
      await interaction.update({
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
      const msg = err?.message ?? String(err);
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`Could not add to Now Playing: ${msg}`),
      );
      await interaction.update({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      clearNowPlayingAddSession(sessionId);
    }
  }

  @SelectMenuComponent({ id: /^nowplaying-add-platform-select:[^:]+$/ })
  async handleAddNowPlayingPlatformSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, platformSessionId] = interaction.customId.split(":");
    const session = nowPlayingAddPlatformSessions.get(platformSessionId);
    if (!session) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This platform prompt has expired."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (interaction.user.id !== session.userId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This platform prompt isn't for you."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const platformId = Number(interaction.values?.[0]);
    if (!Number.isInteger(platformId) || platformId <= 0) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Invalid platform selection."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    await safeDeferUpdate(interaction);
    const loadingContainer = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## Now Loading\nGenerating cover layout and loading the selected member list...",
      ),
    );
    await safeUpdate(interaction, {
      components: [loadingContainer],
      flags: buildComponentsV2Flags(true),
    });

    try {
      await Member.addNowPlaying(session.userId, session.gameId, platformId, session.note);
      nowPlayingAddPlatformSessions.delete(platformSessionId);
      clearNowPlayingAddSession(session.sourceSessionId);
      const list = await Member.getNowPlaying(session.userId);
      const payload = await this.buildNowPlayingListPayload(
        interaction.user,
        list,
        interaction.guildId,
        "Your Now Playing List",
      );
      const refreshed = await this.refreshNowPlayingListFromContext(interaction, session.userId);
      if (refreshed) {
        return;
      } else {
        const components = this.withNowPlayingActions(
          true,
          session.userId,
          payload.components,
          false,
          this.hasDisplayableNowPlayingNotes(list),
        );
        await safeUpdate(interaction, {
          components,
          files: payload.files,
          flags: buildComponentsV2Flags(true),
        });
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`Could not add to Now Playing: ${msg}`),
      );
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
    const platformSessionId = `np-add-platform-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    nowPlayingAddPlatformSessions.set(platformSessionId, {
      userId,
      gameId,
      note,
      sourceSessionId,
    });
    const options = platforms.slice(0, 25).map((platform) => ({
      label: platform.name.slice(0, 100),
      value: String(platform.id),
    }));
    const select = new StringSelectMenuBuilder()
      .setCustomId(`${NOW_PLAYING_ADD_PLATFORM_SELECT_PREFIX}:${platformSessionId}`)
      .setPlaceholder("Select the platform")
      .addOptions(options);
    const titleWithCap = platforms.length > options.length
      ? `Select the platform for **${game.title}** (showing first ${options.length}).`
      : `Select the platform for **${game.title}**.`;
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(titleWithCap),
    );
    const payload = {
      components: [container, new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
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
    try {
      const entries = getDisplayNowPlayingEntries(await Member.getNowPlaying(userId));
      if (!entries.length) {
        const container = new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent("Your Now Playing list is empty."),
        );
        const pmComponents = await this.withPmNowPlayingList(
          userId,
          interaction.guildId,
          [container],
        );
        if (mode === "update" && !useDeferredEditPath) {
          await safeUpdate(interaction, { components: pmComponents });
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
      const { files, thumbnailsByGameId } = await this.buildNowPlayingAttachments(
        entries,
        NOW_PLAYING_GALLERY_MAX,
        includeImages,
      );
      const components = this.buildNowPlayingRemoveComponents(
        entries,
        userId,
        thumbnailsByGameId,
      );
      const pmComponents = await this.withPmNowPlayingList(
        userId,
        interaction.guildId,
        components,
      );
      if (mode === "update" && !useDeferredEditPath) {
        await safeUpdate(interaction, this.buildComponentPayload(pmComponents as any, files));
      } else if (mode === "update") {
        await safeReply(interaction, {
          ...this.buildComponentPayload(pmComponents as any, files),
          flags: buildComponentsV2Flags(true),
        });
      } else {
        await safeReply(interaction, {
          ...this.buildComponentPayload(pmComponents as any, files),
          flags: buildComponentsV2Flags(true),
        });
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`Could not remove from Now Playing: ${msg}`),
      );
      const pmComponents = await this.withPmNowPlayingList(
        userId,
        interaction.guildId,
        [container],
      );
      if (mode === "update" && !useDeferredEditPath) {
        await safeUpdate(interaction, { components: pmComponents });
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
    const entries = getDisplayNowPlayingEntries(
      await Member.getNowPlaying(ownerId),
    ).slice(0, 10);
    if (!entries.length) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Your Now Playing list is empty."),
      );
      const pmComponents = await this.withPmNowPlayingList(ownerId, interaction.guildId, [container]);
      await interaction.update({ components: pmComponents });
      return;
    }
    const stateToken = buildNowPlayingSortStateToken(entries.length);
    const components = this.buildNowPlayingSortComponents(entries, ownerId, stateToken);
    const pmComponents = await this.withPmNowPlayingList(
      ownerId,
      interaction.guildId,
      components,
    );
    await interaction.update({ components: pmComponents });
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
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Your Now Playing list is empty."),
      );
      const pmComponents = await this.withPmNowPlayingList(
        interaction.user.id,
        interaction.guildId,
        [container],
      );
      if (mode === "update" && "update" in interaction) {
        await interaction.update({ components: pmComponents });
      } else {
        await safeReply(interaction, {
          components: pmComponents,
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    if (!("showModal" in interaction)) {
      await safeReply(interaction, {
        content: "Unable to open the note form right now.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const limitedEntries = current.slice(0, NOW_PLAYING_NOTE_MODAL_MAX_FIELDS);
    await interaction.showModal(
      buildEditNotesModal(interaction.user.id, limitedEntries),
    ).catch(async () => {
      await safeReply(interaction, {
        content: "Unable to open the note form right now.",
        flags: MessageFlags.Ephemeral,
      });
    });

    if (current.length > NOW_PLAYING_NOTE_MODAL_MAX_FIELDS) {
      await safeReply(interaction, {
        content:
          `Discord modals support up to ${NOW_PLAYING_NOTE_MODAL_MAX_FIELDS} note fields at once. ` +
          "I opened the first set. Submit, then use Edit Notes again for the rest.",
        flags: MessageFlags.Ephemeral,
      });
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
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Your Now Playing list is empty."),
      );
      const pmComponents = await this.withPmNowPlayingList(
        interaction.user.id,
        interaction.guildId,
        [container],
      );
      if (mode === "update" && "update" in interaction) {
        await interaction.update({ components: pmComponents });
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
    const pmComponents = await this.withPmNowPlayingList(
      interaction.user.id,
      interaction.guildId,
      components,
    );

    if (mode === "update" && "update" in interaction) {
      await interaction.update({ components: pmComponents });
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
        const deduped = Array.from(uniqueById.values()).slice(0, 25);
        if (!deduped.length && entry.platformId) {
          deduped.push({
            id: entry.platformId,
            name: entry.platformName ?? "Current Platform",
          });
        }
        return deduped.map((platform, optionIndex) => ({
          label: platform.name.slice(0, 100),
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
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("That game could not be found."),
      );
      if (mode === "update" && "update" in interaction) {
        await interaction.update({ components: [container] });
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
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("No platform data is available for this game."),
      );
      if (mode === "update" && "update" in interaction) {
        await interaction.update({ components: [container] });
      } else {
        await safeReply(interaction, {
          components: [container],
          flags: buildComponentsV2Flags(true),
        });
      }
      return;
    }

    const options = platforms.slice(0, 25).map((platform) => ({
      label: platform.name.slice(0, 100),
      value: String(platform.id),
    }));
    const select = new StringSelectMenuBuilder()
      .setCustomId(`${NOW_PLAYING_EDIT_PLATFORM_SELECT_PREFIX}:${ownerId}:${gameId}`)
      .setPlaceholder("Select the platform")
      .addOptions(options);
    const content = platforms.length > options.length
      ? `Select the platform for **${game.title}** (showing first ${options.length}).`
      : `Select the platform for **${game.title}**.`;
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(content),
    );
    const payload = {
      components: [container, new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
      flags: buildComponentsV2Flags(true),
    };
    const pmComponents = await this.withPmNowPlayingList(
      ownerId,
      interaction.guildId,
      payload.components,
    );
    if (mode === "update" && "update" in interaction) {
      await interaction.update({ ...payload, components: pmComponents });
    } else {
      await safeReply(interaction, { ...payload, components: pmComponents });
    }
  }

  @SelectMenuComponent({ id: /^nowplaying-edit-platform-slot:\d+:\d+:[a-z0-9_]+$/ })
  async handleEditPlatformSlot(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, ownerId, slotRaw, stateToken] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This platform prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const slotIndex = Number(slotRaw);
    const selectedOptionIndex = Number(interaction.values?.[0]);
    if (
      !Number.isInteger(slotIndex) ||
      slotIndex < 0 ||
      !Number.isInteger(selectedOptionIndex) ||
      selectedOptionIndex < 0
    ) {
      await interaction.reply({
        content: "Invalid selection.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const entries = getDisplayNowPlayingEntries(await Member.getNowPlaying(ownerId)).slice(0, 10);
    const platformOptions = await this.getNowPlayingEditPlatformOptions(entries);
    const parsed = parseNowPlayingPlatformStateToken(stateToken, entries.length);
    if (!parsed || slotIndex >= entries.length || selectedOptionIndex > 24) {
      await safeReply(interaction, {
        content: "This platform form has expired. Open Edit Platform again.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (selectedOptionIndex >= (platformOptions[slotIndex]?.length ?? 0)) {
      await safeReply(interaction, {
        content: "Invalid platform selection for that game.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    parsed[slotIndex] = selectedOptionIndex;
    const components = this.buildNowPlayingEditPlatformComponents(
      entries,
      ownerId,
      platformOptions,
      encodeNowPlayingPlatformState(parsed),
    );
    const pmComponents = await this.withPmNowPlayingList(ownerId, interaction.guildId, components);
    await interaction.update({ components: pmComponents });
  }

  @SelectMenuComponent({ id: /^nowplaying-edit-note-select:\d+$/ })
  async handleEditNoteSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This note prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const gameId = Number(interaction.values?.[0]);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      await interaction.reply({
        content: "Invalid selection.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const currentEntries = await Member.getNowPlayingEntries(ownerId);
    const currentEntry = currentEntries.find((entry) => entry.gameId === gameId);
    if (!currentEntry) {
      await safeReply(interaction, {
        content: "Entry not found.",
        flags: MessageFlags.Ephemeral,
      });
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
      await safeReply(interaction, {
        content: "Unable to open the note form right now.",
        flags: MessageFlags.Ephemeral,
      });
    });
  }

  @ButtonComponent({ id: /^nowplaying-edit-note-direct:\d+:\d+$/ })
  async handleEditNoteDirect(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, gameIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This note prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const gameId = Number(gameIdRaw);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      await interaction.reply({
        content: "Invalid selection.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const currentEntries = await Member.getNowPlayingEntries(ownerId);
    const currentEntry = currentEntries.find((entry) => entry.gameId === gameId);
    if (!currentEntry) {
      await safeReply(interaction, {
        content: "Entry not found.",
        flags: MessageFlags.Ephemeral,
      });
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
      await safeReply(interaction, {
        content: "Unable to open the note form right now.",
        flags: MessageFlags.Ephemeral,
      });
    });
  }

  @SelectMenuComponent({ id: /^nowplaying-sort-slot:\d+:\d+:[a-z0-9_]+$/ })
  async handleNowPlayingSortSlot(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, ownerId, slotRaw, stateToken] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This sort prompt isn't for you."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const slotIndex = Number(slotRaw);
    if (!Number.isInteger(slotIndex) || slotIndex < 0) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Invalid selection."),
      );
      await interaction.reply({
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
        const container = new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent("This sort form has expired. Open Sort again."),
        );
        await interaction.update({ components: [container] });
        return;
      }

      parsed[slotIndex] = selectedIndex;
      const components = this.buildNowPlayingSortComponents(
        entries,
        ownerId,
        encodeNowPlayingSortState(parsed),
      );
      const pmComponents = await this.withPmNowPlayingList(ownerId, interaction.guildId, components);
      await interaction.update({ components: pmComponents });
    } catch {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Could not update the sort form right now."),
      );
      await interaction.update({ components: [container] }).catch(() => {});
    }
  }

  @ButtonComponent({ id: /^nowplaying-sort-save:\d+:[a-z0-9_]+$/ })
  async handleNowPlayingSortSave(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, stateToken] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This sort prompt isn't for you."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    await safeDeferUpdate(interaction);
    const isEphemeral = interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false;
    const responseFlags = buildComponentsV2Flags(isEphemeral);

    const entries = getDisplayNowPlayingEntries(await Member.getNowPlaying(ownerId)).slice(0, 10);
    const parsed = parseNowPlayingSortStateToken(stateToken, entries.length);
    if (!parsed) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This sort form has expired. Open Sort again."),
      );
      const pmComponents = await this.withPmNowPlayingList(ownerId, interaction.guildId, [container]);
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
      const pmComponents = await this.withPmNowPlayingList(ownerId, interaction.guildId, components);
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
      const pmComponents = await this.withPmNowPlayingList(ownerId, interaction.guildId, components);
      await safeReply(interaction, { components: pmComponents, flags: responseFlags });
      return;
    }

    const orderedIds = parsed.map((index) => entries[index].gameId);
    const updated = await Member.updateNowPlayingSort(ownerId, orderedIds);
    if (!updated) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Could not update the sort order."),
      );
      const pmComponents = await this.withPmNowPlayingList(ownerId, interaction.guildId, [container]);
      await safeReply(interaction, { components: pmComponents, flags: responseFlags });
      return;
    }

    await this.refreshNowPlayingListFromContext(interaction, ownerId).catch(() => {});
    await this.returnToNowPlayingEditMenu(interaction, ownerId);
  }

  @ButtonComponent({ id: /^nowplaying-sort-reset:\d+$/ })
  async handleNowPlayingSortReset(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This sort prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await safeDeferUpdate(interaction);
    const isEphemeral = interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false;
    const responseFlags = buildComponentsV2Flags(isEphemeral);
    const entries = getDisplayNowPlayingEntries(await Member.getNowPlaying(ownerId)).slice(0, 10);
    const stateToken = buildNowPlayingSortStateToken(entries.length);
    const components = this.buildNowPlayingSortComponents(entries, ownerId, stateToken);
    const pmComponents = await this.withPmNowPlayingList(ownerId, interaction.guildId, components);
    await safeReply(interaction, { components: pmComponents, flags: responseFlags });
  }

  @ModalComponent({ id: /^nowplaying-note-modal:\d+(?::\d+)?$/ })
  async handleEditNoteModal(interaction: ModalSubmitInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const parts = interaction.customId.split(":");
    const ownerId = parts[1];
    const legacyGameIdRaw = parts[2] ?? null;
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, {
        content: "This note prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let updated = false;
    if (legacyGameIdRaw) {
      const gameId = Number(legacyGameIdRaw);
      if (!Number.isInteger(gameId) || gameId <= 0) {
        await safeReply(interaction, {
          content: "Invalid selection.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const noteInput = stripModalInput(
        interaction.fields.getTextInputValue(NOW_PLAYING_NOTE_INPUT_ID),
      );
      const note = noteInput.trim();
      const nextNote = note ? note : null;
      if (note && note.length > MAX_NOW_PLAYING_NOTE_LEN) {
        await safeReply(interaction, {
          content: `Note must be ${MAX_NOW_PLAYING_NOTE_LEN} characters or fewer.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      updated = await Member.updateNowPlayingNote(ownerId, gameId, nextNote);
    } else {
      const currentEntries = await Member.getNowPlayingEntries(ownerId);
      const updateCandidates = currentEntries.slice(0, NOW_PLAYING_NOTE_MODAL_MAX_FIELDS);

      for (const entry of updateCandidates) {
        if (!entry.gameId) {
          continue;
        }
        const fieldId = `${NOW_PLAYING_NOTE_INPUT_ID}:${entry.gameId}`;
        let noteInput = "";
        try {
          noteInput = stripModalInput(interaction.fields.getTextInputValue(fieldId));
        } catch {
          noteInput = "";
        }
        const note = noteInput.trim();
        if (note.length > MAX_NOW_PLAYING_NOTE_LEN) {
          await safeReply(interaction, {
            content: `Note must be ${MAX_NOW_PLAYING_NOTE_LEN} characters or fewer.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const nextNote = note ? note : null;
        const changed = await Member.updateNowPlayingNote(ownerId, entry.gameId, nextNote);
        updated = changed || updated;
      }
    }
    if (updated) {
      const refreshed = await this.refreshNowPlayingListFromContext(interaction, ownerId);
      if (!interaction.guildId && interaction.message) {
        try {
          const dmComponents = await this.buildNowPlayingEditInitialComponents(ownerId, null);
          await interaction.message.edit({
            components: dmComponents,
            flags: buildComponentsV2Flags(false),
          });
          await interaction.deleteReply().catch(() => {});
          return;
        } catch {
          // Fall through to existing fallback response if DM message edit fails.
        }
      }
      if (refreshed) {
        await interaction.deleteReply().catch(() => {});
        return;
      }
      const list = await Member.getNowPlaying(ownerId);
      const payload = await this.buildNowPlayingListPayload(
        interaction.user,
        list,
        interaction.guildId,
        "Your Now Playing List",
      );
      const components = this.withNowPlayingActions(
        true,
        ownerId,
        payload.components,
        false,
        this.hasDisplayableNowPlayingNotes(list),
      );
      await safeReply(interaction, {
        components,
        files: payload.files,
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    await safeReply(interaction, {
      content: "Could not update that entry.",
      flags: MessageFlags.Ephemeral,
    });
  }

  @SelectMenuComponent({ id: /^nowplaying-delete-note-select:\d+$/ })
  async handleDeleteNoteSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This note prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const gameId = Number(interaction.values?.[0]);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      await interaction.reply({
        content: "Invalid selection.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const currentEntries = await Member.getNowPlayingEntries(ownerId);
    const currentEntry = currentEntries.find((entry) => entry.gameId === gameId);
    const currentNote = currentEntry?.note ? currentEntry.note : "No note set.";
    if (!currentEntry) {
      await safeReply(interaction, {
        content: "Entry not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`Delete Note: ${currentEntry.title}`)
      .setDescription(currentEntry.note ? `> ${currentNote}` : "No note set.");

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`nowplaying-delete-note-confirm:${ownerId}:${gameId}:yes`)
        .setLabel("Delete Note")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`nowplaying-delete-note-confirm:${ownerId}:${gameId}:no`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.update({
      content: "Confirm note deletion:",
      embeds: [embed],
      components: [row],
    });
  }

  @ButtonComponent({ id: /^nowplaying-delete-note-confirm:\d+:\d+:(yes|no)$/ })
  async handleDeleteNoteConfirm(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, gameIdRaw, choice] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This note prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (choice === "no") {
      await interaction.update({
        content: "Cancelled.",
        components: [],
      }).catch(() => {});
      return;
    }

    const gameId = Number(gameIdRaw);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      await interaction.reply({
        content: "Invalid selection.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const updated = await Member.updateNowPlayingNote(ownerId, gameId, null);
    await interaction.update({
      content: updated ? "Note deleted." : "Could not update that entry.",
      components: [],
    }).catch(() => {});
  }

  @ButtonComponent({ id: /^np-remove:[^:]+:\d+$/ })
  async handleRemoveNowPlayingButton(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, gameIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This remove prompt isn't for you."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const gameId = Number(gameIdRaw);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Invalid selection."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    try {
      const removed = await Member.removeNowPlaying(ownerId, gameId);
      if (!removed) {
        const container = new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            "Failed to remove that game (it may have been removed already).",
          ),
        );
        await interaction.reply({
          components: [container],
          flags: buildComponentsV2Flags(true),
        });
        return;
      }
      await this.refreshNowPlayingListFromContext(interaction, ownerId).catch(() => {});

      const entries = getDisplayNowPlayingEntries(await Member.getNowPlaying(ownerId));
      if (!entries.length) {
        const container = new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent("Your Now Playing list is empty."),
        );
        await interaction.update({ components: [container] });
        return;
      }
      const includeImages = interaction.guildId != null;
      const { files, thumbnailsByGameId } = await this.buildNowPlayingAttachments(
        entries,
        NOW_PLAYING_GALLERY_MAX,
        includeImages,
      );
      const components = this.buildNowPlayingRemoveComponents(
        entries,
        ownerId,
        thumbnailsByGameId,
      );
      const pmComponents = await this.withPmNowPlayingList(
        ownerId,
        interaction.guildId,
        components,
      );
      await interaction.update(this.buildComponentPayload(pmComponents as any, files));
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`Could not remove from Now Playing: ${msg}`),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
    }
  }

  @ButtonComponent({ id: /^nowplaying-list-notes:\d+:(show|hide)$/ })
  async handleNowPlayingListNotesToggle(interaction: ButtonInteraction): Promise<void> {
    await safeDeferUpdate(interaction);

    const [, ownerId, action] = interaction.customId.split(":");
    const showNotes = action === "show";
    const isEphemeral = interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false;
    const ownerUser =
      interaction.user.id === ownerId
        ? interaction.user
        : await interaction.client.users.fetch(ownerId).catch(() => null);
    const target = ownerUser ?? interaction.user;
    const title = ownerId === interaction.user.id && isEphemeral
      ? "Your Now Playing List"
      : `${target.displayName ?? target.username ?? "User"}'s Now Playing List`;
    const entries = getDisplayNowPlayingEntries(await Member.getNowPlaying(ownerId));

    if (!entries.length) {
      const emptyMessage = ownerId === interaction.user.id
        ? "Your Now Playing list is empty."
        : `No Now Playing entries found for <@${ownerId}>.`;
      const container = this.buildNowPlayingMessageContainer(
        title,
        emptyMessage,
      );
      await safeReply(interaction, {
        components: [
          container,
          this.buildNowPlayingActionRow(
            ownerId,
            showNotes,
            this.hasDisplayableNowPlayingNotes(entries),
          ),
        ],
        flags: buildComponentsV2Flags(isEphemeral),
      });
      return;
    }

    const payload = await this.buildNowPlayingListPayload(
      target,
      entries,
      interaction.guildId,
      title,
      showNotes,
    );
    const components = this.withNowPlayingActions(
      true,
      ownerId,
      payload.components,
      showNotes,
      this.hasDisplayableNowPlayingNotes(entries),
    );
    await safeReply(interaction, {
      components,
      files: payload.files,
      flags: buildComponentsV2Flags(isEphemeral),
    });
  }

  @ButtonComponent({ id: /^nowplaying-journal-open:\d+:\d+:\d+$/ })
  async handleNowPlayingJournalOpen(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, gameIdRaw, pageRaw] = interaction.customId.split(":");
    const gameId = Number(gameIdRaw);
    if (!(await this.canUseJournalFeature(ownerId)) || !(await this.canUseJournalFeature(interaction.user.id))) {
      await safeReply(interaction, {
        content: "Journal requires the Regulars role.",
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    const nowPlayingEntries = getDisplayNowPlayingEntries(await Member.getNowPlaying(ownerId));
    const selected = nowPlayingEntries.find((entry) => entry.gameId === Number(gameIdRaw));
    if (!selected?.journalEnabled) {
      await safeReply(interaction, {
        content: "Journal is not enabled for this game.",
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    if (interaction.guildId) {
      const publicCount = await Member.countGameJournalEntries(
        ownerId,
        gameId,
        "__public__",
      );
      if (publicCount <= 0) {
        await safeReply(interaction, {
          content: "This game's journal has no public entries to show in channel.",
          flags: buildComponentsV2Flags(true),
        });
        return;
      }
    }
    if (interaction.guildId && !selected.hasPublicJournalEntry) {
      await safeReply(interaction, {
        content: "This game's journal has no public entries to show in channel.",
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    const payload = await this.buildJournalComponents(
      ownerId,
      interaction.guildId ? "__public__" : interaction.user.id,
      gameId,
      Number(pageRaw),
    );
    if (interaction.guildId) {
      await this.deleteRecentJournalMessagesInChannel(interaction, ownerId, gameId);
    }
    await safeReply(interaction, {
      components: payload.components,
      files: payload.files,
      flags: buildComponentsV2Flags(interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false),
    });
    await this.trackJournalReply(interaction, ownerId, gameId);
  }

  @ButtonComponent({ id: /^nowplaying-journal-page:\d+:\d+:(prev|next):\d+$/ })
  async handleNowPlayingJournalPage(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, gameIdRaw, , pageRaw] = interaction.customId.split(":");
    const gameId = Number(gameIdRaw);
    if (!(await this.canUseJournalFeature(ownerId)) || !(await this.canUseJournalFeature(interaction.user.id))) {
      await safeReply(interaction, {
        content: "Journal requires the Regulars role.",
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    const nowPlayingEntries = getDisplayNowPlayingEntries(await Member.getNowPlaying(ownerId));
    const selected = nowPlayingEntries.find((entry) => entry.gameId === Number(gameIdRaw));
    if (!selected?.journalEnabled) {
      await safeReply(interaction, {
        content: "Journal is not enabled for this game.",
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    if (interaction.guildId) {
      const publicCount = await Member.countGameJournalEntries(
        ownerId,
        gameId,
        "__public__",
      );
      if (publicCount <= 0) {
        await safeReply(interaction, {
          content: "This game's journal has no public entries to show in channel.",
          flags: buildComponentsV2Flags(true),
        });
        return;
      }
    }
    if (interaction.guildId && !selected.hasPublicJournalEntry) {
      await safeReply(interaction, {
        content: "This game's journal has no public entries to show in channel.",
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    const payload = await this.buildJournalComponents(
      ownerId,
      interaction.guildId ? "__public__" : interaction.user.id,
      gameId,
      Number(pageRaw),
    );
    if (interaction.guildId) {
      await this.deleteRecentJournalMessagesInChannel(interaction, ownerId, gameId);
    }
    await safeReply(interaction, {
      components: payload.components,
      files: payload.files,
      flags: buildComponentsV2Flags(interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false),
    });
    await this.trackJournalReply(interaction, ownerId, gameId);
  }

  @ButtonComponent({ id: /^nowplaying-journal-add:\d+:\d+:\d+$/ })
  async handleNowPlayingJournalAdd(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, gameIdRaw, pageRaw] = interaction.customId.split(":");
    if (!(await this.canUseJournalFeature(ownerId)) || !(await this.canUseJournalFeature(interaction.user.id))) {
      await safeReply(interaction, {
        content: "Journal requires the Regulars role.",
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, { content: "Only the owner can add journal entries." });
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
    modal.addLabelComponents(
      new LabelBuilder()
        .setLabel("Privacy")
        .setDescription("Choose who can view this entry")
        .setRadioGroupComponent(
          new RadioGroupBuilder()
            .setCustomId(NOW_PLAYING_JOURNAL_PRIVACY_INPUT_ID)
            .setRequired(true)
            .setOptions(
              { label: "Private", value: "private", description: "Only you can view it" },
              { label: "Public", value: "public", description: "Visible to other members" },
            ),
        ),
    );
    await interaction.showModal(modal);
    if (interaction.guildId) {
      await interaction.message.delete().catch(() => null);
    }
  }

  @ButtonComponent({ id: /^nowplaying-journal-edit:\d+:\d+:\d+$/ })
  async handleNowPlayingJournalEdit(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, gameIdRaw, pageRaw] = interaction.customId.split(":");
    if (!(await this.canUseJournalFeature(ownerId)) || !(await this.canUseJournalFeature(interaction.user.id))) {
      await safeReply(interaction, {
        content: "Journal requires the Regulars role.",
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, { content: "Only the owner can edit journal entries." });
      return;
    }
    const gameId = Number(gameIdRaw);
    const page = Number(pageRaw);
    const offset = (Math.max(1, page) - 1) * 5;
    const entries = await Member.getGameJournalEntries(ownerId, gameId, {
      viewerUserId: ownerId,
      limit: 5,
      offset,
    });
    if (!entries.length) {
      await safeReply(interaction, { content: "No journal entries available to edit." });
      return;
    }
    const options = entries.map((entry) => ({
      label: (entry.title ?? "Untitled Entry").slice(0, 100),
      value: String(entry.entryId),
      description: `${formatTableDate(entry.createdAt)} | ${entry.isPublic ? "Public" : "Private"}`,
    }));
    const select = new StringSelectMenuBuilder()
      .setCustomId(`${NOW_PLAYING_JOURNAL_EDIT_SELECT_PREFIX}:${ownerId}:${gameId}:${page}`)
      .setPlaceholder("Choose an entry to edit")
      .addOptions(options);
    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent("## Edit Journal Entry\nSelect an entry to edit."),
    );
    await safeUpdate(interaction, {
      components: [container, row],
      flags: buildComponentsV2Flags(interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false),
    });
  }

  @SelectMenuComponent({ id: /^nowplaying-journal-edit-select:\d+:\d+:\d+$/ })
  async handleNowPlayingJournalEditSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, ownerId, gameIdRaw, pageRaw] = interaction.customId.split(":");
    if (!(await this.canUseJournalFeature(ownerId)) || !(await this.canUseJournalFeature(interaction.user.id))) {
      await safeReply(interaction, {
        content: "Journal requires the Regulars role.",
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, { content: "Only the owner can edit journal entries." });
      return;
    }
    const entryId = Number(interaction.values[0]);
    const entry = await Member.getGameJournalEntryForUser(ownerId, entryId);
    if (!entry || entry.gameId !== Number(gameIdRaw)) {
      await safeReply(interaction, { content: "That journal entry was not found." });
      return;
    }

    const modal = new ComponentsModalBuilder()
      .setCustomId(`${NOW_PLAYING_JOURNAL_EDIT_MODAL_ID}:${ownerId}:${gameIdRaw}:${pageRaw}:${entryId}`)
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
    modal.addLabelComponents(
      new LabelBuilder()
        .setLabel("Privacy")
        .setDescription("Choose who can view this entry")
        .setRadioGroupComponent(
          new RadioGroupBuilder()
            .setCustomId(NOW_PLAYING_JOURNAL_PRIVACY_INPUT_ID)
            .setRequired(true)
            .setOptions(
              {
                label: "Private",
                value: "private",
                description: "Only you can view it",
                default: !entry.isPublic,
              },
              {
                label: "Public",
                value: "public",
                description: "Visible to other members",
                default: entry.isPublic,
              },
            ),
        ),
    );
    await interaction.showModal(modal);
    if (interaction.guildId) {
      await interaction.message.delete().catch(() => null);
    }
  }

  @ButtonComponent({ id: /^nowplaying-journal-delete:\d+:\d+:\d+$/ })
  async handleNowPlayingJournalDelete(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, gameIdRaw, pageRaw] = interaction.customId.split(":");
    if (!(await this.canUseJournalFeature(ownerId)) || !(await this.canUseJournalFeature(interaction.user.id))) {
      await safeReply(interaction, {
        content: "Journal requires the Regulars role.",
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, { content: "Only the owner can delete journal entries." });
      return;
    }
    const gameId = Number(gameIdRaw);
    const page = Number(pageRaw);
    const offset = (Math.max(1, page) - 1) * 5;
    const entries = await Member.getGameJournalEntries(ownerId, gameId, {
      viewerUserId: ownerId,
      limit: 5,
      offset,
    });
    if (!entries.length) {
      await safeReply(interaction, { content: "No journal entries available to delete." });
      return;
    }
    const options = entries.map((entry) => ({
      label: (entry.title ?? "Untitled Entry").slice(0, 100),
      value: String(entry.entryId),
      description: `${formatTableDate(entry.createdAt)} | ${entry.isPublic ? "Public" : "Private"}`,
    }));
    const select = new StringSelectMenuBuilder()
      .setCustomId(`${NOW_PLAYING_JOURNAL_DELETE_SELECT_PREFIX}:${ownerId}:${gameId}:${page}`)
      .setPlaceholder("Choose an entry to delete")
      .addOptions(options);
    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent("## Delete Journal Entry\nSelect an entry to delete."),
    );
    await safeUpdate(interaction, {
      components: [container, row],
      flags: buildComponentsV2Flags(interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false),
    });
  }

  @SelectMenuComponent({ id: /^nowplaying-journal-delete-select:\d+:\d+:\d+$/ })
  async handleNowPlayingJournalDeleteSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, ownerId, gameIdRaw, pageRaw] = interaction.customId.split(":");
    if (!(await this.canUseJournalFeature(ownerId)) || !(await this.canUseJournalFeature(interaction.user.id))) {
      await safeReply(interaction, {
        content: "Journal requires the Regulars role.",
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, { content: "Only the owner can delete journal entries." });
      return;
    }
    const entryId = Number(interaction.values[0]);
    const entry = await Member.getGameJournalEntryForUser(ownerId, entryId);
    if (!entry || entry.gameId !== Number(gameIdRaw)) {
      await safeReply(interaction, { content: "That journal entry was not found." });
      return;
    }
    const entryTitle = entry.title?.trim() ? entry.title.trim() : "Untitled Entry";
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Confirm Delete\nDelete **${entryTitle}** from ${formatTableDate(entry.createdAt)}?`,
      ),
    );
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(
          `${NOW_PLAYING_JOURNAL_DELETE_CONFIRM_PREFIX}:yes:${ownerId}:${gameIdRaw}:${pageRaw}:${entryId}`,
        )
        .setLabel("Delete")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(
          `${NOW_PLAYING_JOURNAL_DELETE_CONFIRM_PREFIX}:no:${ownerId}:${gameIdRaw}:${pageRaw}:${entryId}`,
        )
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
    );
    await safeUpdate(interaction, {
      components: [container, row],
      flags: buildComponentsV2Flags(interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false),
    });
  }

  @ButtonComponent({ id: /^nowplaying-journal-delete-confirm:(yes|no):\d+:\d+:\d+:\d+$/ })
  async handleNowPlayingJournalDeleteConfirm(interaction: ButtonInteraction): Promise<void> {
    const [, action, ownerId, gameIdRaw, pageRaw, entryIdRaw] = interaction.customId.split(":");
    if (!(await this.canUseJournalFeature(ownerId)) || !(await this.canUseJournalFeature(interaction.user.id))) {
      await safeReply(interaction, {
        content: "Journal requires the Regulars role.",
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, { content: "Only the owner can delete journal entries." });
      return;
    }
    if (action === "yes") {
      const removed = await Member.deleteGameJournalEntry(ownerId, Number(entryIdRaw));
      if (!removed) {
        await safeReply(interaction, { content: "That journal entry was not found." });
        return;
      }
    }
    const journalViewerId = interaction.guildId ? "__public__" : interaction.user.id;
    const payload = await this.buildJournalComponents(
      ownerId,
      journalViewerId,
      Number(gameIdRaw),
      Number(pageRaw),
    );
    await safeUpdate(interaction, {
      components: payload.components,
      files: payload.files,
      flags: buildComponentsV2Flags(interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false),
    });
  }

  @ModalComponent({ id: /^nowplaying-journal-modal:\d+:\d+:\d+$/ })
  async handleNowPlayingJournalModal(interaction: ModalSubmitInteraction): Promise<void> {
    const [, ownerId, gameIdRaw, pageRaw] = interaction.customId.split(":");
    if (!(await this.canUseJournalFeature(ownerId)) || !(await this.canUseJournalFeature(interaction.user.id))) {
      await safeReply(interaction, {
        content: "Journal requires the Regulars role.",
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, { content: "Only the owner can submit journal entries." });
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
    const isPublic = extractJournalPrivacyFromInteraction(interaction);
    await Member.addGameJournalEntry({
      userId: ownerId,
      gameId: Number(gameIdRaw),
      title: title || null,
      body,
      isPublic,
    });
    await Member.upsertGameJournalPreference(ownerId, Number(gameIdRaw), true, isPublic);
    const journalViewerId = interaction.guildId ? "__public__" : interaction.user.id;
    const payload = await this.buildJournalComponents(
      ownerId,
      journalViewerId,
      Number(gameIdRaw),
      Number(pageRaw),
    );
    await safeUpdate(interaction, {
      components: payload.components,
      files: payload.files,
      flags: buildComponentsV2Flags(true),
    });
  }

  @ModalComponent({ id: /^nowplaying-journal-edit-modal:\d+:\d+:\d+:\d+$/ })
  async handleNowPlayingJournalEditModal(interaction: ModalSubmitInteraction): Promise<void> {
    const [, ownerId, gameIdRaw, pageRaw, entryIdRaw] = interaction.customId.split(":");
    const gameId = Number(gameIdRaw);
    if (!(await this.canUseJournalFeature(ownerId)) || !(await this.canUseJournalFeature(interaction.user.id))) {
      await safeReply(interaction, {
        content: "Journal requires the Regulars role.",
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, { content: "Only the owner can edit journal entries." });
      return;
    }

    const entryId = Number(entryIdRaw);
    const existing = await Member.getGameJournalEntryForUser(ownerId, entryId);
    if (!existing || existing.gameId !== gameId) {
      await safeReply(interaction, { content: "That journal entry was not found." });
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
    const isPublic = extractJournalPrivacyFromInteraction(interaction);
    await Member.updateGameJournalEntry({
      userId: ownerId,
      entryId,
      title: title || null,
      body,
      isPublic,
    });
    const journalViewerId = interaction.guildId ? "__public__" : interaction.user.id;
    const payload = await this.buildJournalComponents(
      ownerId,
      journalViewerId,
      gameId,
      Number(pageRaw),
    );
    if (interaction.guildId) {
      await interaction.message?.delete().catch(() => null);
      await this.deleteRecentJournalMessagesInChannel(interaction, ownerId, gameId);
    }
    await safeReply(interaction, {
      components: payload.components,
      files: payload.files,
      flags: buildComponentsV2Flags(true),
    });
    await this.trackJournalReply(interaction, ownerId, gameId);
  }

  @ButtonComponent({ id: /^nowplaying-list-edit:\d+$/ })
  async handleNowPlayingListEdit(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          "Only the owner of this Now Playing list can use Edit.",
        ),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    setNowPlayingListContext(ownerId, interaction.message);
    const dmChannel = await interaction.user.createDM().catch(() => null);
    if (!dmChannel) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          "I couldn't open a DM. Enable DMs and try Edit again.",
        ),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    try {
      await dmChannel.send({
        components: await this.buildNowPlayingEditInitialComponents(
          ownerId,
          interaction.guildId,
        ),
        flags: buildComponentsV2Flags(false),
      });
    } catch {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          "I couldn't send the DM edit menu. Enable DMs and try Edit again.",
        ),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent("Opened your Now Playing edit menu in DM."),
    );
    await interaction.reply({
      components: [container],
      flags: buildComponentsV2Flags(true),
    });
  }

  @ButtonComponent({ id: /^nowplaying-edit-menu-note:\d+$/ })
  async handleNowPlayingEditMenuNote(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This edit menu isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await this.promptEditNowPlayingNote(interaction, "update");
  }

  @ButtonComponent({ id: /^nowplaying-edit-menu-sort:\d+$/ })
  async handleNowPlayingEditMenuSort(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This edit menu isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await this.promptSortNowPlayingButtons(interaction, ownerId);
  }

  @ButtonComponent({ id: /^nowplaying-edit-menu-platform:\d+$/ })
  async handleNowPlayingEditMenuPlatform(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This edit menu isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await this.promptEditNowPlayingPlatform(interaction, "update");
  }

  @ButtonComponent({ id: /^nowplaying-edit-menu-complete:\d+$/ })
  async handleNowPlayingEditMenuComplete(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This edit menu isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const sessionId = createNowPlayingCompletionWizardSession(ownerId, true);
    await this.promptNowPlayingCompletionPick(interaction, ownerId, sessionId);
  }

  @ButtonComponent({ id: /^nowplaying-edit-menu-journal:\d+$/ })
  async handleNowPlayingEditMenuJournal(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This edit menu isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!(await this.canUseJournalFeature(ownerId))) {
      await safeReply(interaction, {
        content: "Journal requires the Regulars role.",
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    if (!(await this.hasRegularsRoleForInteraction(interaction))) {
      await safeReply(interaction, {
        content: "Journal opt-in requires the Regulars role.",
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const entries = getDisplayNowPlayingEntries(await Member.getNowPlaying(ownerId));
    if (!entries.length) {
      await safeReply(interaction, {
        content: "Your Now Playing list is empty.",
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const options = entries.slice(0, 25).map((entry) => ({
      label: formatEntryTitleWithPlatform(entry).slice(0, 100),
      value: String(entry.gameId),
      description: entry.journalEnabled ? "Journal enabled" : "Notes mode",
    }));
    const select = new StringSelectMenuBuilder()
      .setCustomId(`${NOW_PLAYING_JOURNAL_OPTIN_SELECT_PREFIX}:${ownerId}`)
      .setPlaceholder("Choose a game to enable Journal")
      .addOptions(options);
    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## Journal Opt-In\nChoose one game to enable journal mode. This replaces note display for that game.",
      ),
    );
    const pmComponents = await this.withPmNowPlayingList(ownerId, interaction.guildId, [container, row]);
    await safeReply(interaction, {
      components: pmComponents,
      flags: buildComponentsV2Flags(interaction.message.flags?.has(MessageFlags.Ephemeral) ?? true),
    });
  }

  @ButtonComponent({ id: /^nowplaying-edit-menu-remove:\d+$/ })
  async handleNowPlayingEditMenuRemove(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This edit menu isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await this.promptRemoveNowPlaying(interaction, "update");
  }

  @ButtonComponent({ id: /^nowplaying-list-add:\d+$/ })
  async handleNowPlayingListAdd(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This add prompt isn't for you."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    setNowPlayingListContext(ownerId, interaction.message);
    await interaction.showModal(this.buildNowPlayingAddModal()).catch(() => {});
  }

  @ButtonComponent({ id: /^nowplaying-list-edit-note:\d+$/ })
  async handleNowPlayingListEditNote(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This note prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    setNowPlayingListContext(ownerId, interaction.message);
    await this.promptEditNowPlayingNote(interaction, "update");
  }

  @ButtonComponent({ id: /^nowplaying-list-edit-platform:\d+$/ })
  async handleNowPlayingListEditPlatform(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This platform prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    setNowPlayingListContext(ownerId, interaction.message);
    await this.promptEditNowPlayingPlatform(interaction, "update");
  }

  @ButtonComponent({ id: /^np-edit-platform:\d+:\d+$/ })
  async handleNowPlayingEditPlatformPick(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, gameIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This platform prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const gameId = Number(gameIdRaw);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      await interaction.reply({
        content: "Invalid selection.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await this.promptNowPlayingEditPlatformSelection(interaction, ownerId, gameId, "update");
  }

  @ButtonComponent({ id: /^nowplaying-edit-platform-save:\d+:[a-z0-9_]+$/ })
  async handleNowPlayingEditPlatformSave(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, stateToken] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This platform prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await safeDeferUpdate(interaction);
    const isEphemeral = interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false;
    const responseFlags = buildComponentsV2Flags(isEphemeral);
    const entries = getDisplayNowPlayingEntries(await Member.getNowPlaying(ownerId)).slice(0, 10);
    const platformOptions = await this.getNowPlayingEditPlatformOptions(entries);
    const parsed = parseNowPlayingPlatformStateToken(stateToken, entries.length);
    if (!parsed) {
      await safeReply(interaction, {
        content: "This platform form has expired. Open Edit Platform again.",
        flags: responseFlags,
      });
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
      const pmComponents = await this.withPmNowPlayingList(ownerId, interaction.guildId, components);
      await safeReply(interaction, { components: pmComponents, flags: responseFlags });
      return;
    }

    for (let slotIndex = 0; slotIndex < entries.length; slotIndex += 1) {
      const selectedOptionIndex = parsed[slotIndex];
      const option = platformOptions[slotIndex]?.[selectedOptionIndex];
      const gameId = entries[slotIndex]?.gameId;
      if (!option || !gameId) {
        await safeReply(interaction, {
          content: "One or more selected platforms are invalid. Please review and try again.",
          flags: responseFlags,
        });
        return;
      }
      const updated = await Member.updateNowPlayingPlatform(ownerId, gameId, option.platformId);
      if (!updated) {
        await safeReply(interaction, {
          content: `Could not update platform for ${entries[slotIndex].title}.`,
          flags: responseFlags,
        });
        return;
      }
    }
    await this.refreshNowPlayingListFromContext(interaction, ownerId).catch(() => {});
    await this.returnToNowPlayingEditMenu(interaction, ownerId);
  }

  @ButtonComponent({ id: /^nowplaying-edit-platform-reset:\d+$/ })
  async handleNowPlayingEditPlatformReset(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This platform prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
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
    const pmComponents = await this.withPmNowPlayingList(ownerId, interaction.guildId, components);
    await safeReply(interaction, { components: pmComponents, flags: responseFlags });
  }

  @ButtonComponent({ id: /^nowplaying-list-sort:\d+$/ })
  async handleNowPlayingListSort(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This sort prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    setNowPlayingListContext(ownerId, interaction.message);
    await this.promptSortNowPlayingButtons(interaction, ownerId);
  }

  @ButtonComponent({ id: /^nowplaying-list-complete:\d+$/ })
  async handleNowPlayingListComplete(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This completion prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    setNowPlayingListContext(ownerId, interaction.message);
    const sessionId = createNowPlayingCompletionWizardSession(ownerId, true);
    await this.promptNowPlayingCompletionPick(interaction, ownerId, sessionId);
  }

  @ButtonComponent({ id: /^nowplaying-complete-done:\d+$/ })
  async handleNowPlayingCompleteDone(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This completion prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (interaction.guildId == null) {
      await this.returnToNowPlayingEditMenu(interaction, ownerId);
      return;
    }
    const list = await Member.getNowPlaying(ownerId);
    const payload = await this.buildNowPlayingListPayload(
      interaction.user,
      list,
      interaction.guildId,
      "Your Now Playing List",
    );
    const components = this.withNowPlayingActions(
      true,
      ownerId,
      payload.components,
      false,
      this.hasDisplayableNowPlayingNotes(list),
    );
    await interaction.update({
      components,
      files: payload.files,
      flags: buildComponentsV2Flags(true),
    });
  }


  @ButtonComponent({ id: /^nowplaying-list-remove:\d+$/ })
  async handleNowPlayingListRemove(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This remove prompt isn't for you."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    setNowPlayingListContext(ownerId, interaction.message);
    await this.promptRemoveNowPlaying(interaction, "update");
  }

  @ButtonComponent({ id: /^nowplaying-remove-done:\d+$/ })
  async handleNowPlayingRemoveDone(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This remove prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (interaction.guildId == null) {
      await this.returnToNowPlayingEditMenu(interaction, ownerId);
      return;
    }
    const list = await Member.getNowPlaying(ownerId);
    const payload = await this.buildNowPlayingListPayload(
      interaction.user,
      list,
      interaction.guildId,
      "Your Now Playing List",
    );
    const components = this.withNowPlayingActions(
      true,
      ownerId,
      payload.components,
      false,
      this.hasDisplayableNowPlayingNotes(list),
    );
    await interaction.update({
      components,
      files: payload.files,
      flags: buildComponentsV2Flags(true),
    });
  }

  @ButtonComponent({ id: /^nowplaying-list-cancel:\d+$/ })
  async handleNowPlayingListCancel(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const list = await Member.getNowPlaying(ownerId);
    const payload = await this.buildNowPlayingListPayload(
      interaction.user,
      list,
      interaction.guildId,
      "Your Now Playing List",
    );
    const components = this.withNowPlayingActions(
      true,
      ownerId,
      payload.components,
      false,
      this.hasDisplayableNowPlayingNotes(list),
    );
    await interaction.update({
      components,
      files: payload.files,
      flags: buildComponentsV2Flags(true),
    });
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
        const container = this.buildNowPlayingMessageContainer(
          "Your Now Playing List",
          [
            "Welcome. Your list is empty, so nothing shows yet.",
            "Use Edit to manage notes, sort order, platform, completions, and removals in DM.",
          ].join("\n"),
        );
        const actions = this.buildNowPlayingActionRow(target.id, false, false);
        await safeReply(interaction, {
          components: [container, actions],
          flags: buildComponentsV2Flags(ephemeral),
        });
        if (!ephemeral && "fetchReply" in interaction && typeof interaction.fetchReply === "function") {
          const message = await interaction.fetchReply().catch(() => null);
          if (message) {
            trackNowPlayingListContext(message as Message<boolean>, {
              view: "single",
              ownerUserId: target.id,
            });
          }
        }
        return;
      }

      const container = this.buildNowPlayingMessageContainer(
        "Now Playing",
        `No Now Playing entries found for <@${target.id}>.`,
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(ephemeral),
      });
      if (!ephemeral && "fetchReply" in interaction && typeof interaction.fetchReply === "function") {
        const message = await interaction.fetchReply().catch(() => null);
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
    const title = isOwnList && ephemeral
      ? "Your Now Playing List"
      : `${target.displayName ?? target.username ?? "User"}'s Now Playing List`;
    const payload = await this.buildNowPlayingListPayload(
      target,
      sortedEntries,
      interaction.guildId,
      title,
      false,
      isOwnList,
    );
    const components = this.withNowPlayingActions(
      true,
      target.id,
      payload.components,
      false,
      this.hasDisplayableNowPlayingNotes(sortedEntries),
    );
    await safeReply(interaction, {
      components,
      files: payload.files,
      flags: buildComponentsV2Flags(ephemeral),
    });
    if (!ephemeral && "fetchReply" in interaction && typeof interaction.fetchReply === "function") {
      const message = await interaction.fetchReply().catch(() => null);
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

    const loadingContainer = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## Now Loading\nGenerating cover layout and loading the selected member list...",
      ),
    );
    await safeUpdate(interaction, {
      components: [loadingContainer],
      flags: buildComponentsV2Flags(isEphemeral),
    });

    const entries = await Member.getNowPlaying(selectedUserId);
    const target =
      (await interaction.client.users.fetch(selectedUserId).catch(() => null)) ??
      interaction.user;

    if (!entries.length) {
      const container = this.buildNowPlayingMessageContainer(
        "Now Playing - Everyone",
        `No Now Playing entries found for <@${selectedUserId}>.`,
      );
      const components = this.withNowPlayingActions(
        true,
        selectedUserId,
        [container],
        false,
        false,
      );
      const updated = await interaction.editReply({
        components,
      });
      trackNowPlayingListContext(updated as Message<boolean>, {
        view: "everyone-selected",
        selectedUserId,
      });
      return;
    }

    const sortedEntries = getDisplayNowPlayingEntries(entries);
    const displayName = target.displayName ?? target.username ?? "User";
    const payload = await this.buildNowPlayingListPayload(
      target,
      sortedEntries,
      interaction.guildId,
      `${displayName}'s Now Playing List`,
    );
    const components = this.withNowPlayingActions(
      true,
      selectedUserId,
      payload.components,
      false,
      this.hasDisplayableNowPlayingNotes(sortedEntries),
    );
    const updated = await interaction.editReply({
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
      const container = this.buildNowPlayingMessageContainer(
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
      return `**${displayName}**: ${count} ${suffix}`;
    });

    const container = this.buildNowPlayingListContainer("Now Playing - Everyone", lines);

    const selectRow = this.buildNowPlayingMemberSelect(sortedLists);

    await safeReply(interaction, {
      components: [container, selectRow],
      flags: buildComponentsV2Flags(ephemeral),
    });
    if (!ephemeral) {
      const message = await interaction.fetchReply().catch(() => null);
      if (message) {
        trackNowPlayingListContext(message as Message<boolean>, {
          view: "everyone",
        });
      }
    }
  }

  private buildNowPlayingListLines(
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

  private buildNowPlayingListContainer(title: string, lines: string[]): ContainerBuilder {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${title}`));
    if (lines.length) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(lines.join("\n")),
      );
    }
    return container;
  }

  private buildNowPlayingMessageContainer(title: string, message: string): ContainerBuilder {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${title}`));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(message));
    return container;
  }

  private buildComponentPayload(
    components: Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>>,
    files?: AttachmentBuilder[],
  ): { components: Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>>; files?: AttachmentBuilder[] } {
    if (files && files.length) {
      return { components, files };
    }
    return { components };
  }

  private async buildNowPlayingAttachments(
    entries: IMemberNowPlayingEntry[],
    maxImages: number = Number.POSITIVE_INFINITY,
    includeImages: boolean = true,
  ): Promise<{
    files: AttachmentBuilder[];
    thumbnailsByGameId: Map<number, string>;
    covers: Array<{ gameId: number; title: string; imageData: Buffer }>;
  }> {
    if (!includeImages) {
      return {
        files: [],
        thumbnailsByGameId: new Map<number, string>(),
        covers: [],
      };
    }
    const files: AttachmentBuilder[] = [];
    const seen = new Set<number>();
    const thumbnailsByGameId = new Map<number, string>();
    const covers: Array<{ gameId: number; title: string; imageData: Buffer }> = [];
    let imageCount = 0;
    for (const entry of entries) {
      if (!entry.gameId || seen.has(entry.gameId)) continue;
      seen.add(entry.gameId);
      if (imageCount >= maxImages) {
        break;
      }
      const game = await Game.getGameById(entry.gameId);
      if (game?.imageData) {
        covers.push({
          gameId: entry.gameId,
          title: entry.title,
          imageData: game.imageData,
        });
        const filename = `now_playing_${entry.gameId}.png`;
        files.push(
          new AttachmentBuilder(game.imageData, { name: filename }),
        );
        thumbnailsByGameId.set(entry.gameId, `attachment://${filename}`);
        imageCount += 1;
      }
    }
    return { files, thumbnailsByGameId, covers };
  }

  private async buildNowPlayingListPayload(
    target: User,
    entries: IMemberNowPlayingEntry[],
    guildId: string | null,
    title: string,
    showNotes: boolean = false,
    showPrivateOnlyJournalButtons: boolean = false,
  ): Promise<{ components: NowPlayingListComponents; files: AttachmentBuilder[] }> {
    const [{ files, covers }, ownerCanUseJournal] = await Promise.all([
      this.buildNowPlayingAttachments(entries, NOW_PLAYING_COMPOSITE_MAX),
      this.canUseJournalFeature(target.id),
    ]);
    const components = this.buildNowPlayingEntryComponents(
      title,
      entries,
      target.id,
      guildId,
      await this.buildNowPlayingCompositeImageUrl(files, covers, target.id),
      showNotes,
      showPrivateOnlyJournalButtons,
      ownerCanUseJournal,
    );
    return { components, files };
  }

  private async buildNowPlayingCompositeImageUrl(
    files: AttachmentBuilder[],
    covers: Array<{ gameId: number; title: string; imageData: Buffer }>,
    ownerId: string,
  ): Promise<string | null> {
    if (!covers.length) {
      return null;
    }

    const sourceHash = this.buildNowPlayingCompositeSourceHash(ownerId, covers);
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
        console.error("Backblaze upload failed for now-playing composite image:", error);
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

  private buildNowPlayingCompositeSourceHash(
    ownerId: string,
    covers: Array<{ gameId: number; title: string; imageData: Buffer }>,
  ): string {
    const hash = crypto.createHash("sha256");
    hash.update(`owner:${ownerId}|count:${covers.length}|`);
    covers.forEach((cover) => {
      hash.update(`id:${cover.gameId}|title:${cover.title}|`);
      hash.update(cover.imageData);
    });
    return hash.digest("hex");
  }

  private buildNowPlayingActionRow(
    ownerId: string,
    showNotes: boolean,
    hasDisplayableNotes: boolean,
  ): ActionRowBuilder<ButtonBuilder> {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${NOW_PLAYING_LIST_EDIT_PREFIX}:${ownerId}`)
        .setLabel("Edit")
        .setStyle(ButtonStyle.Primary),
    );
    if (hasDisplayableNotes) {
      const notesAction = showNotes ? "hide" : "show";
      const notesLabel = showNotes ? "Hide Notes" : "Show Notes";
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`${NOW_PLAYING_LIST_NOTES_PREFIX}:${ownerId}:${notesAction}`)
          .setLabel(notesLabel)
          .setStyle(ButtonStyle.Secondary),
      );
    }
    return row;
  }

  private buildNowPlayingCancelRow(ownerId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`nowplaying-list-cancel:${ownerId}`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
    );
  }

  private buildNowPlayingEditMenuComponents(
    ownerId: string,
    entries: IMemberNowPlayingEntry[],
    guildId: string | null,
    ownerCanUseJournal: boolean,
  ): Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>> {
    const introContainer = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## Now Playing Edit\nChoose an edit action. All edits happen in this DM.",
      ),
    );
    const listContainer = entries.length
      ? this.buildNowPlayingEntryComponents(
        "Your Now Playing List",
        entries,
        ownerId,
        guildId,
        null,
        true,
        true,
        ownerCanUseJournal,
      )[0]
      : this.buildNowPlayingMessageContainer(
        "Your Now Playing List",
        "Your Now Playing list is empty.",
      );
    const firstRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${NOW_PLAYING_EDIT_MENU_NOTE_PREFIX}:${ownerId}`)
        .setLabel("Edit Notes")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${NOW_PLAYING_EDIT_MENU_SORT_PREFIX}:${ownerId}`)
        .setLabel("Sort")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${NOW_PLAYING_EDIT_MENU_PLATFORM_PREFIX}:${ownerId}`)
        .setLabel("Edit Platform")
        .setStyle(ButtonStyle.Secondary),
    );
    const secondRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${NOW_PLAYING_EDIT_MENU_COMPLETE_PREFIX}:${ownerId}`)
        .setLabel("Add Completion")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${NOW_PLAYING_EDIT_MENU_JOURNAL_PREFIX}:${ownerId}`)
        .setLabel("Journal Opt-In")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${NOW_PLAYING_EDIT_MENU_REMOVE_PREFIX}:${ownerId}`)
        .setLabel("Remove Game")
        .setStyle(ButtonStyle.Danger),
    );
    return [introContainer, listContainer, firstRow, secondRow];
  }

  private async returnToNowPlayingEditMenu(
    interaction: ButtonInteraction,
    ownerId: string,
  ): Promise<void> {
    const menuComponents = await this.buildNowPlayingEditInitialComponents(
      ownerId,
      interaction.guildId,
    );
    const isEphemeral = interaction.message.flags?.has(MessageFlags.Ephemeral) ?? true;
    await safeReply(interaction, {
      components: menuComponents,
      flags: buildComponentsV2Flags(isEphemeral),
    });
  }

  private async buildNowPlayingEditInitialComponents(
    ownerId: string,
    guildId: string | null,
  ): Promise<Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>>> {
    const [entries, ownerCanUseJournal] = await Promise.all([
      Member.getNowPlaying(ownerId).then(getDisplayNowPlayingEntries),
      this.canUseJournalFeature(ownerId),
    ]);
    return this.buildNowPlayingEditMenuComponents(ownerId, entries, guildId, ownerCanUseJournal);
  }

  private async withPmNowPlayingList(
    ownerId: string,
    guildId: string | null,
    components: Array<ContainerBuilder | ActionRowBuilder<any>>,
  ): Promise<Array<ContainerBuilder | ActionRowBuilder<any>>> {
    if (guildId) {
      return components;
    }
    const [entries, ownerCanUseJournal] = await Promise.all([
      Member.getNowPlaying(ownerId).then(getDisplayNowPlayingEntries),
      this.canUseJournalFeature(ownerId),
    ]);
    const listContainer = entries.length
      ? this.buildNowPlayingEntryComponents(
        "Your Now Playing List",
        entries,
        ownerId,
        null,
        null,
        true,
        true,
        ownerCanUseJournal,
      )[0]
      : this.buildNowPlayingMessageContainer(
        "Your Now Playing List",
        "Your Now Playing list is empty.",
      );
    return [listContainer, ...components];
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
          this.trimTextDisplayContent(lines.join("\n")),
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

    const doneRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`nowplaying-complete-done:${ownerId}`)
        .setLabel("Done")
        .setStyle(ButtonStyle.Success),
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
      ...this.buildNowPlayingListLines(entries, null),
    ];
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        this.trimTextDisplayContent(textLines.join("\n")),
      ),
    );

    const selectOptions = entries
      .filter((entry) => Number.isInteger(entry.gameId))
      .slice(0, 25)
      .map((entry) => ({
        label: formatEntryTitleWithPlatform(entry).slice(0, 100),
        value: String(entry.gameId),
      }));
    const removeSelect = new StringSelectMenuBuilder()
      .setCustomId(`${NOW_PLAYING_REMOVE_SELECT_PREFIX}:${ownerId}`)
      .setPlaceholder("Select a game to remove")
      .addOptions(selectOptions);
    const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(removeSelect);

    const doneRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`nowplaying-remove-done:${ownerId}`)
        .setLabel("Done")
        .setStyle(ButtonStyle.Success),
    );
    return [container, selectRow, doneRow];
  }

  @SelectMenuComponent({ id: /^nowplaying-remove-select:\d+$/ })
  async handleNowPlayingRemoveSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This remove prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const gameId = Number(interaction.values?.[0]);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Invalid game selection."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    const loadingContainer = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent("Updating your Now Playing remove list..."),
    );
    await safeUpdate(interaction, { components: [loadingContainer] });

    try {
      const removed = await Member.removeNowPlaying(ownerId, gameId);
      if (!removed) {
        const container = new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            "Failed to remove that game (it may have been removed already).",
          ),
        );
        await interaction.editReply({ components: [container] }).catch(() => {});
        return;
      }
      await this.refreshNowPlayingListFromContext(interaction, ownerId).catch(() => {});
      const entries = getDisplayNowPlayingEntries(await Member.getNowPlaying(ownerId));
      if (!entries.length) {
        const container = new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent("Your Now Playing list is empty."),
        );
        const pmComponents = await this.withPmNowPlayingList(
          ownerId,
          interaction.guildId,
          [container],
        );
        await interaction.editReply({ components: pmComponents }).catch(() => {});
        return;
      }
      const includeImages = interaction.guildId != null;
      const { files, thumbnailsByGameId } = await this.buildNowPlayingAttachments(
        entries,
        NOW_PLAYING_GALLERY_MAX,
        includeImages,
      );
      const components = this.buildNowPlayingRemoveComponents(
        entries,
        ownerId,
        thumbnailsByGameId,
      );
      const pmComponents = await this.withPmNowPlayingList(
        ownerId,
        interaction.guildId,
        components,
      );
      await interaction.editReply(this.buildComponentPayload(pmComponents as any, files)).catch(() => {});
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`Could not remove from Now Playing: ${msg}`),
      );
      await interaction.editReply({ components: [container] }).catch(() => {});
    }
  }

  @SelectMenuComponent({ id: /^nowplaying-journal-optin-select:\d+$/ })
  async handleNowPlayingJournalOptInSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (!(await this.canUseJournalFeature(ownerId)) || !(await this.canUseJournalFeature(interaction.user.id))) {
      await safeReply(interaction, {
        content: "Journal requires the Regulars role.",
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, {
        content: "This journal prompt is not for you.",
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    if (!(await this.hasRegularsRoleForInteraction(interaction))) {
      await safeReply(interaction, {
        content: "Journal opt-in requires the Regulars role.",
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const gameId = Number(interaction.values[0]);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      await safeReply(interaction, { content: "Invalid game selection.", flags: buildComponentsV2Flags(true) });
      return;
    }
    await Member.upsertGameJournalPreference(ownerId, gameId, true, false);
    const existingVisibleCount = await Member.countGameJournalEntries(ownerId, gameId, ownerId);
    if (existingVisibleCount === 0) {
      const nowPlayingEntries = await Member.getNowPlaying(ownerId);
      const selectedEntry = nowPlayingEntries.find((entry) => entry.gameId === gameId);
      const seedNote = selectedEntry?.note?.trim();
      if (seedNote) {
        await Member.addGameJournalEntry({
          userId: ownerId,
          gameId,
          title: "Imported from Now Playing Note",
          body: seedNote,
          isPublic: false,
        });
      }
    }
    const menuComponents = await this.buildNowPlayingEditInitialComponents(ownerId, interaction.guildId);
    const isEphemeral = interaction.message.flags?.has(MessageFlags.Ephemeral) ?? true;
    await safeReply(interaction, {
      components: menuComponents,
      flags: buildComponentsV2Flags(isEphemeral),
    });
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
        introLines.join("\n"),
      ),
    );

    const components: Array<ContainerBuilder | ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>> = [
      container,
    ];
    for (let slotIndex = 0; slotIndex < entries.length; slotIndex += 1) {
      const entry = entries[slotIndex];
      const options = platformOptions[slotIndex] ?? [];
      if (!options.length) {
        components.push(
          new ContainerBuilder().addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `### ${formatEntryTitleWithPlatform(entry)}\n-# No platform choices available for this game.`,
            ),
          ),
        );
        continue;
      }
      const selectedIndex = parsedState[slotIndex];
      components.push(new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `### ${formatEntryTitleWithPlatform(entry)}`,
        ),
      ));
      const select = new StringSelectMenuBuilder()
        .setCustomId(`${NOW_PLAYING_EDIT_PLATFORM_SLOT_PREFIX}:${ownerId}:${slotIndex}:${stateToken}`)
        .setPlaceholder(`Platform for ${entry.title.slice(0, 70)}`)
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options.map((option, optionIndex) => ({
          label: option.label,
          value: option.value,
          default: selectedIndex === optionIndex,
        })));
      components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
    }

    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${NOW_PLAYING_EDIT_PLATFORM_SAVE_PREFIX}:${ownerId}:${stateToken}`)
        .setLabel("Save")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`${NOW_PLAYING_EDIT_PLATFORM_RESET_PREFIX}:${ownerId}`)
        .setLabel("Reset to current platforms")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`nowplaying-list-cancel:${ownerId}`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
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
        introLines.join("\n"),
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
          label: formatEntryTitleWithPlatform(entry).slice(0, 100),
          value: String(entryIndex),
          default: selectedIndex === entryIndex,
        })));
      rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu));
    }

    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${NOW_PLAYING_SORT_SAVE_PREFIX}:${ownerId}:${stateToken}`)
        .setLabel("Save")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`${NOW_PLAYING_SORT_RESET_PREFIX}:${ownerId}`)
        .setLabel("Reset to current order")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`nowplaying-list-cancel:${ownerId}`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
    );
    rows.push(actionRow);
    return [container, ...rows];
  }

  private withNowPlayingActions(
    isOwnList: boolean,
    ownerId: string,
    components: NowPlayingListComponents,
    showNotes: boolean,
    hasDisplayableNotes: boolean = true,
  ): NowPlayingMessageComponents {
    if (!isOwnList) {
      return components;
    }
    return [...components, this.buildNowPlayingActionRow(ownerId, showNotes, hasDisplayableNotes)];
  }

  private hasDisplayableNowPlayingNotes(entries: IMemberNowPlayingEntry[]): boolean {
    return entries.some((entry) => !entry.journalEnabled && Boolean(entry.note?.trim()));
  }

  private async canUseJournalFeature(userId: string): Promise<boolean> {
    const member = await Member.getByUserId(userId);
    return member?.roleRegular === 1;
  }

  private async refreshNowPlayingListFromContext(
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
            : await interaction.client.users.fetch(ownerId).catch(() => null);
          if (!target) {
            continue;
          }
          const isEphemeral = message.flags?.has(MessageFlags.Ephemeral) ?? false;
          const title = ownerId === interaction.user.id && isEphemeral
            ? "Your Now Playing List"
            : `${target.displayName ?? target.username ?? "User"}'s Now Playing List`;
          const entries = getDisplayNowPlayingEntries(await Member.getNowPlaying(ownerId));
          const showNotes = this.getNowPlayingShowNotesState(message, ownerId);

          if (!entries.length) {
            const emptyMessage = ownerId === interaction.user.id
              ? "Your Now Playing list is empty."
              : `No Now Playing entries found for <@${ownerId}>.`;
            const container = this.buildNowPlayingMessageContainer(title, emptyMessage);
            const components = ownerId === interaction.user.id
              ? [
                container,
                this.buildNowPlayingActionRow(
                  ownerId,
                  showNotes,
                  this.hasDisplayableNowPlayingNotes(entries),
                ),
              ]
              : [container];
            await message.edit({
              components,
              flags: buildComponentsV2Flags(isEphemeral),
            });
            updatedAny = true;
            continue;
          }

          const payload = await this.buildNowPlayingListPayload(
            target,
            entries,
            message.guildId ?? interaction.guildId,
            title,
            showNotes,
            ownerId === interaction.user.id,
          );
          const components = this.withNowPlayingActions(
            ownerId === interaction.user.id,
            ownerId,
            payload.components,
            showNotes,
            this.hasDisplayableNowPlayingNotes(entries),
          );
          await message.edit({
            components,
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
            const container = this.buildNowPlayingMessageContainer(
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
            return `**${displayName}**: ${count} ${suffix}`;
          });
          const container = this.buildNowPlayingListContainer("Now Playing - Everyone", lines);
          const selectRow = this.buildNowPlayingMemberSelect(sortedLists);
          await message.edit({
            components: [container, selectRow],
          });
          updatedAny = true;
          continue;
        }

        if (context.view === "everyone-selected" && context.selectedUserId) {
          const selectedUserId = context.selectedUserId;
          const entries = getDisplayNowPlayingEntries(
            await Member.getNowPlaying(selectedUserId),
          );
          if (!entries.length) {
            const container = this.buildNowPlayingMessageContainer(
              "Now Playing - Everyone",
              `No Now Playing entries found for <@${selectedUserId}>.`,
            );
            const components = this.withNowPlayingActions(
              true,
              selectedUserId,
              [container],
              false,
              false,
            );
            await message.edit({
              components,
            });
            updatedAny = true;
            continue;
          }
          const target =
            (await interaction.client.users.fetch(selectedUserId).catch(() => null)) ??
            interaction.user;
          const title = `${target.displayName ?? target.username ?? "User"}'s Now Playing List`;
          const payload = await this.buildNowPlayingListPayload(
            target,
            entries,
            message.guildId ?? interaction.guildId,
            title,
          );
          const components = this.withNowPlayingActions(
            true,
            selectedUserId,
            payload.components,
            false,
            this.hasDisplayableNowPlayingNotes(entries),
          );
          await message.edit({
            components,
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

  private async deleteRecentJournalMessagesInChannel(
    interaction: ButtonInteraction | ModalSubmitInteraction,
    ownerUserId: string,
    gameId: number,
  ): Promise<void> {
    const channelId = interaction.channelId;
    if (!channelId) {
      return;
    }

    const now = Date.now();
    for (const [key, context] of nowPlayingJournalContexts.entries()) {
      if (now - context.createdAt > NOW_PLAYING_JOURNAL_CONTEXT_TTL_MS) {
        nowPlayingJournalContexts.delete(key);
        continue;
      }
      if (context.channelId !== channelId) {
        continue;
      }
      if (context.ownerUserId !== ownerUserId || context.gameId !== gameId) {
        continue;
      }

      const channel = await interaction.client.channels.fetch(context.channelId).catch(() => null);
      if (!channel?.isTextBased()) {
        nowPlayingJournalContexts.delete(key);
        continue;
      }

      const message = await channel.messages.fetch(context.messageId).catch(() => null);
      if (!message) {
        nowPlayingJournalContexts.delete(key);
        continue;
      }

      await message.delete().catch(() => null);
      nowPlayingJournalContexts.delete(key);
    }
  }

  private async trackJournalReply(
    interaction: ButtonInteraction | ModalSubmitInteraction,
    ownerUserId: string,
    gameId: number,
  ): Promise<void> {
    if (!interaction.guildId) {
      return;
    }
    if (typeof interaction.fetchReply !== "function") {
      return;
    }

    const reply = await interaction.fetchReply().catch(() => null);
    if (!reply) {
      return;
    }
    trackNowPlayingJournalContext(reply as Message<boolean>, ownerUserId, gameId);
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

  private getNowPlayingShowNotesState(message: Message, ownerId: string): boolean {
    const prefix = `${NOW_PLAYING_LIST_NOTES_PREFIX}:${ownerId}:`;
    for (const topLevel of message.components) {
      if (!("components" in topLevel) || !Array.isArray(topLevel.components)) {
        continue;
      }
      for (const component of topLevel.components) {
        const customId = (component as { customId?: string; custom_id?: string }).customId ??
          (component as { customId?: string; custom_id?: string }).custom_id;
        if (!customId || !customId.startsWith(prefix)) {
          continue;
        }
        return customId.endsWith(":hide");
      }
    }
    return false;
  }


  private buildNowPlayingEntryComponents(
    title: string,
    entries: IMemberNowPlayingEntry[],
    ownerId: string,
    guildId: string | null,
    imageUrl: string | null,
    showNotes: boolean,
    showPrivateOnlyJournalButtons: boolean = false,
    ownerCanUseJournal: boolean = false,
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
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`));

    entries.forEach((entry, index) => {
      if (index === 0) {
        container.addSeparatorComponents(
          new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false),
        );
      }
      const entryTitle = formatEntry(entry, guildId);
      const lines = [`**${entryTitle}**`];
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
      if (showNotes && entry.note && (!entry.journalEnabled || !ownerCanUseJournal)) {
        const quotedNote = entry.note
          .split("\n")
          .map((noteLine) => `> ${noteLine}`)
          .join("\n");
        lines.push(quotedNote);
      }
      const content = this.trimTextDisplayContent(lines.join("\n"));
      const shouldShowJournalButton = entry.journalEnabled &&
        ownerCanUseJournal &&
        (showPrivateOnlyJournalButtons || entry.hasPublicJournalEntry);
      if (shouldShowJournalButton) {
        const section = new SectionBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent(content),
        );
        section.setButtonAccessory(
          new V2ButtonBuilder()
            .setCustomId(`${NOW_PLAYING_JOURNAL_OPEN_PREFIX}:${ownerId}:${entry.gameId}:1`)
            .setLabel("Game Journal")
            .setStyle(ButtonStyle.Secondary),
        );
        container.addSectionComponents(section);
      } else {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
      }
    });
    return [container];
  }

  private trimTextDisplayContent(content: string): string {
    if (content.length <= 4000) {
      return content;
    }
    return `${content.slice(0, 3997)}...`;
  }

  private async hasRegularsRoleForInteraction(interaction: {
    member?: unknown;
    user: { id: string };
  }): Promise<boolean> {
    const roleData = (interaction.member as any)?.roles;
    if (Array.isArray(roleData)) {
      return roleData.includes(REGULARS_ROLE_ID);
    }
    const roleCache = roleData?.cache;
    if (roleCache?.has?.(REGULARS_ROLE_ID)) {
      return true;
    }
    const member = await Member.getByUserId(interaction.user.id);
    return member?.roleRegular === 1;
  }

  private async buildJournalComponents(
    ownerId: string,
    viewerId: string,
    gameId: number,
    page: number,
  ): Promise<{
    components: Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>>;
    files: AttachmentBuilder[];
  }> {
    const perPage = 5;
    const game = await Game.getGameById(gameId);
    const files: AttachmentBuilder[] = [];
    const ownerProfile = await Member.getByUserId(ownerId);
    const ownerLabel = ownerProfile?.globalName ?? ownerProfile?.username ?? ownerId;
    const nowPlayingMeta = await Member.getNowPlayingEntryMeta(ownerId, gameId);
    const completions = await Member.getCompletionsForGame(ownerId, gameId);
    const pref = await Member.getGameJournalPreference(ownerId, gameId);
    const isEnabled = pref?.isEnabled === true;
    const isOwnerView = ownerId === viewerId;
    const offset = (page - 1) * perPage;
    const total = await Member.countGameJournalEntries(ownerId, gameId, viewerId);
    const entries = await Member.getGameJournalEntries(ownerId, gameId, {
      viewerUserId: viewerId,
      limit: perPage,
      offset,
    });
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const safePage = Math.min(Math.max(page, 1), totalPages);

    const container = new ContainerBuilder();
    let coverUrl: string | null = null;
    if (game?.imageData) {
      const filename = `game_journal_${gameId}.png`;
      files.push(new AttachmentBuilder(game.imageData, { name: filename }));
      coverUrl = `attachment://${filename}`;
    }
    const introTextDisplays = [
      new TextDisplayBuilder().setContent(
        `## ${ownerLabel}'s Game Journal: ${game?.title ?? `Game #${gameId}`}`,
      ),
    ];
    if (nowPlayingMeta?.addedAt) {
      introTextDisplays.push(
        new TextDisplayBuilder().setContent(
          `Now Playing since ${formatTableDate(nowPlayingMeta.addedAt)}`,
        ),
      );
    }
    const totalEntriesLine = `${total} Entries`;
    introTextDisplays.push(
      new TextDisplayBuilder().setContent(totalEntriesLine),
    );
    const introSection = new SectionBuilder().addTextDisplayComponents(...introTextDisplays);
    if (coverUrl) {
      introSection.setThumbnailAccessory(new ThumbnailBuilder().setURL(coverUrl));
    }
    container.addSectionComponents(introSection);
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
    if (!isEnabled) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Journal mode is not enabled for this game."),
      );
    } else if (!entries.length) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent("No journal entries yet."),
      );
    } else {
      for (const entry of entries) {
        if (!isOwnerView && !entry.isPublic) {
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `### Private Entry\n-# ${formatTableDate(entry.createdAt)}\nThis entry is private.`,
            ),
          );
          continue;
        }
        const title = entry.title ? `### ${entry.title}` : "### Untitled Entry";
        const privacy = entry.isPublic ? "Public" : "Private";
        const body = this.trimTextDisplayContent(entry.body);
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `${title}\n-# ${formatTableDate(entry.createdAt)} | ${privacy}\n${body}`,
          ),
        );
      }
    }

    const row = new ActionRowBuilder<ButtonBuilder>();
    if (isEnabled) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`${NOW_PLAYING_JOURNAL_ADD_PREFIX}:${ownerId}:${gameId}:${safePage}`)
          .setLabel("Add Entry")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`${NOW_PLAYING_JOURNAL_EDIT_PREFIX}:${ownerId}:${gameId}:${safePage}`)
          .setLabel("Edit Entry")
          .setStyle(ButtonStyle.Primary)
          .setDisabled(entries.length === 0),
        new ButtonBuilder()
          .setCustomId(`${NOW_PLAYING_JOURNAL_DELETE_PREFIX}:${ownerId}:${gameId}:${safePage}`)
          .setLabel("Delete Entry")
          .setStyle(ButtonStyle.Danger)
          .setDisabled(entries.length === 0),
      );
    }
    if (safePage > 1) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(
            `${NOW_PLAYING_JOURNAL_PAGE_PREFIX}:${ownerId}:${gameId}:prev:${Math.max(1, safePage - 1)}`,
          )
          .setLabel("Prev")
          .setStyle(ButtonStyle.Secondary),
      );
    }
    if (safePage < totalPages) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(
            `${NOW_PLAYING_JOURNAL_PAGE_PREFIX}:${ownerId}:${gameId}:next:${Math.min(totalPages, safePage + 1)}`,
          )
          .setLabel("Next")
          .setStyle(ButtonStyle.Secondary),
      );
    }
    return { components: [container, row], files };
  }


  private buildNowPlayingMemberSelect(
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

    const options = sorted.slice(0, 25).map((record) => {
      const displayName = record.globalName ?? record.username ?? record.userId;
      return {
        label: displayName.slice(0, 100),
        value: record.userId,
        description: `${record.entries.length} ${record.entries.length === 1 ? "game" : "games"}`,
        default: record.userId === selectedUserId,
      };
    });

    const select = new StringSelectMenuBuilder()
      .setCustomId(NOW_PLAYING_ALL_SELECT_ID)
      .setPlaceholder("View a member's Now Playing list")
      .addOptions(options);

    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
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
        const container = new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `No IGDB results found for "${session.query}".`,
          ),
        );
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
          description: (game.summary || "No summary").slice(0, 95),
        };
      });

      const { components } = createIgdbSession(session.userId, opts, async (sel, igdbId) => {
        try {
          await safeDeferUpdate(sel);
          const imported = await this.importGameFromIgdb(igdbId);
          const sourceSessionId = `np-igdb-add-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
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
          const container = new ContainerBuilder().addTextDisplayComponents(
            new TextDisplayBuilder().setContent(msg),
          );
          await safeReply(sel, {
            components: [container],
            flags: buildComponentsV2Flags(true),
          }).catch(() => {});
        }
      });

      const container = new ContainerBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            "Select an IGDB result to import and add to Now Playing:",
          ),
        )
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
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(msg),
      );
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
