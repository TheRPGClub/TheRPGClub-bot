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
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ButtonBuilder as V2ButtonBuilder,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import { SeparatorSpacingSize, TextInputStyle as ApiTextInputStyle } from "discord-api-types/v10";
import crypto from "node:crypto";
import Member, { type IMemberNowPlayingEntry } from "../classes/Member.js";
import {
  extractErrorMessage,
  getModalField,
  isInteractionSettled,
  safeDeferReply,
  safeDeferUpdate,
  safeReply,
  safeUpdate,
  sanitizeUserInput,
  type AnyRepliable,
} from "../functions/InteractionUtils.js";
import Game, { type IGame } from "../classes/Game.js";
import { buildJournalView } from "../functions/journalView.js";
import { buildJournalSelectRow, buildUserHeaderContainer } from "../functions/uiComponents.js";
import { EphemeralOwnerMenu } from "../functions/EphemeralOwnerMenu.js";
import { igdbService } from "../services/IGDB/IgdbService.js";
import {
  createIgdbSession,
  type IgdbSelectOption,
} from "../services/IGDB/IgdbSelectService.js";
import {
  announceCompletion,
  notifyUnknownCompletionPlatform,
} from "../functions/CompletionHelpers.js";
import { buildTextReply, safeV2TextContent } from "../functions/ComponentsV2Utils.js";
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
import { STANDARD_PLATFORM_IDS } from "../config/standardPlatforms.js";
import { composeVoteImage } from "../services/collageGenerator.js";
import {
  getOrReplaceBackblazeImage,
  hasBackblazeB2Config,
} from "../services/BackblazeB2Service.js";
import {
  NOW_PLAYING_HELP_PREFIX,
  NOW_PLAYING_HELP_TEXTS,
} from "./now-playing-help.js";

import { renderUsernameWithEmoji } from "../services/UserEmojiService.js";
import { isPositiveInt } from "../utilities/ValidationUtils.js";
import { formatStructuredLog } from "../utilities/LogUtils.js";

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
const NOW_PLAYING_EDIT_MENU_SORT_PREFIX = "nowplaying-edit-menu-sort";
const NOW_PLAYING_EDIT_MENU_PLATFORM_PREFIX = "nowplaying-edit-menu-platform";
const NOW_PLAYING_EDIT_MENU_COMPLETE_PREFIX = "nowplaying-edit-menu-complete";
const NOW_PLAYING_EDIT_MENU_REMOVE_PREFIX = "nowplaying-edit-menu-remove";
const NOW_PLAYING_EDIT_MENU_START_JOURNAL_PREFIX = "nowplaying-edit-menu-start-journal";
const NOW_PLAYING_EDIT_MENU_START_JOURNAL_SELECT_PREFIX = "nowplaying-edit-menu-start-journal-select";
const NOW_PLAYING_REMOVE_SELECT_PREFIX = "nowplaying-remove-select";
const NOW_PLAYING_JOURNAL_OPEN_PREFIX = "nowplaying-journal-open";
const NOW_PLAYING_JOURNAL_VIEW_SELECT_PREFIX = "nowplaying-journal-view-select";
const NOW_PLAYING_JOURNAL_ADD_PREFIX = "nowplaying-journal-add";
const NOW_PLAYING_JOURNAL_EDIT_PREFIX = "nowplaying-journal-edit";
const NOW_PLAYING_JOURNAL_DELETE_PREFIX = "nowplaying-journal-delete";
const NOW_PLAYING_JOURNAL_DELETE_SELECT_PREFIX = "nowplaying-journal-delete-select";
const NOW_PLAYING_JOURNAL_DELETE_CONFIRM_PREFIX = "nowplaying-journal-delete-confirm";
const NOW_PLAYING_JOURNAL_PAGE_PREFIX = "nowplaying-journal-page";
const NOW_PLAYING_JOURNAL_HEADER_PREFIX = "nowplaying-journal-header";
const NOW_PLAYING_JOURNAL_MODAL_ID = "nowplaying-journal-modal";
const NOW_PLAYING_JOURNAL_EDIT_MODAL_ID = "nowplaying-journal-edit-modal";
const NOW_PLAYING_JOURNAL_TITLE_INPUT_ID = "nowplaying-journal-title";
const NOW_PLAYING_JOURNAL_BODY_INPUT_ID = "nowplaying-journal-body";
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
const journalOwnerMenu = new EphemeralOwnerMenu();
const nowPlayingOwnerMenu = new EphemeralOwnerMenu();

export async function restoreJournalMessageContextsFromDb(): Promise<void> {
  try {
    await Member.pruneExpiredJournalMessageContexts(NOW_PLAYING_JOURNAL_CONTEXT_TTL_MS);
    const rows = await Member.loadActiveJournalMessageContexts(NOW_PLAYING_JOURNAL_CONTEXT_TTL_MS);
    for (const row of rows) {
      const key = `${row.channelId}:${row.messageId}`;
      nowPlayingJournalContexts.set(key, row);
    }
    console.log(`[Journal] Restored ${rows.length} message context(s) from DB.`);
  } catch (err) {
    console.error(formatStructuredLog({
      context: "Journal",
      event: "restore_contexts_failed",
      error: err instanceof Error ? err.message : String(err),
    }));
  }
}

type NowPlayingMessageComponents = Array<
  | ContainerBuilder
  | MediaGalleryBuilder
  | ActionRowBuilder<ButtonBuilder>
  | ActionRowBuilder<StringSelectMenuBuilder>
>;

type NowPlayingListComponents = ContainerBuilder[];
type NowPlayingPayloadComponents = Array<
  ContainerBuilder | ActionRowBuilder<StringSelectMenuBuilder>
>;

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

  const promptId = `np-comp-dup:${interaction.user.id}`;
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
      safeV2TextContent(
        `We found a completion for **${gameTitle}** within the last week:\n` +
          `• ${detailParts.join(" - ")} (Completion #${existing.completionId})${noteLine}\n\n` +
          "Add another completion anyway?",
        3500,
      ),
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
    const resultContainer = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        safeV2TextContent(confirmed ? "Adding another completion." : "Cancelled.", 1000),
      ),
    );
    await safeUpdate(selection, {
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
  const sessionId = `np-comp-ui-${userId}`;
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

export async function trackNowPlayingJournalContext(
  message: Message<boolean>,
  ownerUserId: string,
  gameId: number,
): Promise<void> {
  if (message.flags.has(MessageFlags.Ephemeral)) {
    return;
  }
  const key = buildNowPlayingJournalContextKey(message.channelId, message.id);
  const existing = nowPlayingJournalContexts.get(key);
  const createdAt = existing?.createdAt ?? Date.now();
  nowPlayingJournalContexts.set(key, {
    channelId: message.channelId,
    messageId: message.id,
    createdAt,
    ownerUserId,
    gameId,
  });
  await Member.upsertJournalMessageContext(
    message.channelId,
    message.id,
    createdAt,
    ownerUserId,
    gameId,
  ).catch((err) => console.error(formatStructuredLog({
    context: "Journal",
    event: "persist_context_failed",
    error: err instanceof Error ? err.message : String(err),
  })));
}

export async function refreshJournalMessages(
  client: Client,
  ownerId: string,
  gameId: number,
  excludeMessageId?: string,
): Promise<void> {
  const now = Date.now();

  // First pass: expire stale contexts and collect the most recent context per channel.
  const latestByChannel = new Map<string, NowPlayingJournalContext>();
  for (const [key, ctx] of nowPlayingJournalContexts.entries()) {
    if (ctx.ownerUserId !== ownerId || ctx.gameId !== gameId) continue;
    if (ctx.messageId === excludeMessageId) continue;
    if (now - ctx.createdAt > NOW_PLAYING_JOURNAL_CONTEXT_TTL_MS) {
      nowPlayingJournalContexts.delete(key);
      await Member.deleteJournalMessageContext(ctx.channelId, ctx.messageId)
        .catch((err) => console.error(formatStructuredLog({
          context: "Journal",
          event: "delete_expired_context_failed",
          error: err instanceof Error ? err.message : String(err),
        })));
      continue;
    }
    const existing = latestByChannel.get(ctx.channelId);
    if (!existing || ctx.createdAt > existing.createdAt) {
      latestByChannel.set(ctx.channelId, ctx);
    }
  }

  // Second pass: update only the single most recent message per channel.
  for (const ctx of latestByChannel.values()) {
    const channel = await client.channels.fetch(ctx.channelId).catch(() => null);
    if (!channel?.isTextBased()) {
      const key = `${ctx.channelId}:${ctx.messageId}`;
      nowPlayingJournalContexts.delete(key);
      await Member.deleteJournalMessageContext(ctx.channelId, ctx.messageId)
        .catch((err) => console.error(formatStructuredLog({
          context: "Journal",
          event: "delete_unreachable_context_failed",
          error: err instanceof Error ? err.message : String(err),
        })));
      continue;
    }
    const message = await channel.messages.fetch(ctx.messageId).catch(() => null);
    if (!message) {
      const key = `${ctx.channelId}:${ctx.messageId}`;
      nowPlayingJournalContexts.delete(key);
      await Member.deleteJournalMessageContext(ctx.channelId, ctx.messageId)
        .catch((err) => console.error(formatStructuredLog({
          context: "Journal",
          event: "delete_missing_context_failed",
          error: err instanceof Error ? err.message : String(err),
        })));
      continue;
    }
    const guildId = channel.isDMBased() ? null : (channel as any).guildId as string;
    const payload = await buildJournalView({
      ownerId,
      viewerId: null,
      gameId,
      page: 1,
      guildId,
      prevPageCustomId: (p) =>
        `${NOW_PLAYING_JOURNAL_PAGE_PREFIX}:${ownerId}:${gameId}:prev:${p}`,
      nextPageCustomId: (p) =>
        `${NOW_PLAYING_JOURNAL_PAGE_PREFIX}:${ownerId}:${gameId}:next:${p}`,
      headerButtonCustomId: `${NOW_PLAYING_JOURNAL_HEADER_PREFIX}:${ownerId}:${gameId}:1`,
      includeNowPlayingMeta: true,
      includeCompletions: true,
    });
    await message.edit({
      components: payload.components as any[],
      files: payload.files,
    }).catch((err) => console.error(formatStructuredLog({
      context: "Journal",
      event: "refresh_public_message_failed",
      error: err instanceof Error ? err.message : String(err),
    })));
  }
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
          safeV2TextContent(
            `I could not find a unique GameDB match for "${title}". Please choose from autocomplete.`,
            1000,
          ),
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
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          safeV2TextContent(`Could not add to Now Playing: ${msg}`, 1000),
        ),
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
          safeV2TextContent(`No one is currently playing GameDB titles matching "${query}".`, 1000),
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
      new TextDisplayBuilder().setContent(safeV2TextContent(content, 3500)),
    );

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
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Please provide a title to search."),
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    if (noteRaw.length > MAX_NOW_PLAYING_NOTE_LEN) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          safeV2TextContent(`Note must be ${MAX_NOW_PLAYING_NOTE_LEN} characters or fewer.`, 1000),
        ),
      );
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
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(safeV2TextContent(content, 3500)),
        )
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

          const timeoutContainer = new ContainerBuilder().addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              safeV2TextContent("Timed out waiting for a selection. No changes made.", 1000),
            ),
          );
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
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          safeV2TextContent(`Could not add to Now Playing: ${msg}`, 1000),
        ),
      );
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
        safeV2TextContent(this.trimTextDisplayContent(headerLines.join("\n")), 3500),
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
    const announceRow = new ActionRowBuilder<StringSelectMenuBuilder>()
      .addComponents(announceSelect);
    const noteRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(noteSelect);
    const helpButton = new ButtonBuilder()
      .setCustomId(`${NOW_PLAYING_HELP_PREFIX}:completion-config:${session.userId}`)
      .setLabel("?")
      .setStyle(ButtonStyle.Secondary);
    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
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
      const pmComponents = await this.withPmNowPlayingList(
        ownerId, interaction.guildId, [container],
      );
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

    const completionDateInput = getModalField(interaction, NOW_PLAYING_COMPLETE_DATE_INPUT_ID);
    const finalPlaytimeRaw = getModalField(interaction, NOW_PLAYING_COMPLETE_HOURS_INPUT_ID);
    const noteInput = session.addCompletionNote
      ? getModalField(interaction, NOW_PLAYING_COMPLETE_NOTE_INPUT_ID)
      : "";

    let completedAt: Date | null = null;
    try {
      completedAt = this.parseNowPlayingCompletionDate(completionDateInput);
    } catch (err: any) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          safeV2TextContent(err?.message ?? "Invalid completion date.", 1000),
        ),
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
      new TextDisplayBuilder().setContent(safeV2TextContent(content, 1000)),
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
        new TextDisplayBuilder().setContent(
          safeV2TextContent(`Could not save completion: ${msg}`, 1000),
        ),
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
      new TextDisplayBuilder().setContent(safeV2TextContent(content, 1000)),
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

    const gameId = Number(gameIdRaw);
    if (!isPositiveInt(gameId)) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Invalid selection."),
      );
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

    const value = interaction.values?.[0];
    if (!value || !COMPLETION_TYPES.includes(value as CompletionType)) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Invalid completion type."),
      );
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

    const value = interaction.values?.[0];
    if (value !== "yes" && value !== "no") {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Invalid selection."),
      );
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

    const value = interaction.values?.[0];
    if (value !== "yes" && value !== "no") {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Invalid selection."),
      );
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

    const value = interaction.values?.[0];
    if (value !== "yes" && value !== "no") {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Invalid selection."),
      );
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
        new TextDisplayBuilder().setContent("Select a game first."),
      );
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
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Invalid selection. Please try again."),
      );
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
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          safeV2TextContent(`Could not add to Now Playing: ${msg}`, 1000),
        ),
      );
      await safeUpdate(interaction, {
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
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (interaction.user.id !== session.userId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This platform prompt isn't for you."),
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const platformId = Number(interaction.values?.[0]);
    if (!isPositiveInt(platformId)) {
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
      const payload = await this.buildNowPlayingListPayload(
        interaction.user,
        list,
        interaction.guildId,
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
      const msg = extractErrorMessage(err);
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          safeV2TextContent(`Could not add to Now Playing: ${msg}`, 1000),
        ),
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
    const platformSessionId = `np-add-platform-${userId}`;
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
      new TextDisplayBuilder().setContent(safeV2TextContent(titleWithCap, 1000)),
    );
    const payload = {
      components: [
        container,
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
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
        const container = new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent("Your Now Playing list is empty."),
        );
        const pmComponents = await this.withPmNowPlayingList(
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
        await safeUpdate(interaction, {
          ...this.buildComponentPayload(pmComponents as any, files),
          flags: buildComponentsV2Flags(isEphemeral),
        });
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
      const msg = extractErrorMessage(err);
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          safeV2TextContent(`Could not remove from Now Playing: ${msg}`, 1000),
        ),
      );
      const pmComponents = await this.withPmNowPlayingList(
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
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Your Now Playing list is empty."),
      );
      const pmComponents = await this.withPmNowPlayingList(
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
    const pmComponents = await this.withPmNowPlayingList(
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
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Your Now Playing list is empty."),
      );
      const pmComponents = await this.withPmNowPlayingList(
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
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          "All of your games use Game Journal for notes.",
        ),
      );
      const pmComponents = await this.withPmNowPlayingList(
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
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Your Now Playing list is empty."),
      );
      const pmComponents = await this.withPmNowPlayingList(
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
    const pmComponents = await this.withPmNowPlayingList(
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
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("No platform data is available for this game."),
      );
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

    const options = platforms.slice(0, 25).map((platform) => ({
      label: platform.name.slice(0, 100),
      value: String(platform.id),
    }));
    const select = new StringSelectMenuBuilder()
      .setCustomId(`nowplaying-edit-platform-select:${ownerId}:${gameId}`)
      .setPlaceholder("Select the platform")
      .addOptions(options);
    const content = platforms.length > options.length
      ? `Select the platform for **${game.title}** (showing first ${options.length}).`
      : `Select the platform for **${game.title}**.`;
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(safeV2TextContent(content, 1000)),
    );
    const payload = {
      components: [
        container,
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
      ],
      flags: buildComponentsV2Flags(true),
    };
    const pmComponents = await this.withPmNowPlayingList(
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
    const [, ownerId, gameIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("This platform prompt isn't for you.", true));
      return;
    }

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

    await this.refreshNowPlayingListFromContext(interaction, ownerId).catch(() => {});
    await this.returnToNowPlayingEditMenu(interaction, ownerId);
  }

  @SelectMenuComponent({ id: /^nowplaying-edit-platform-slot:\d+:\d+:[a-z0-9_]+$/ })
  async handleEditPlatformSlot(interaction: StringSelectMenuInteraction): Promise<void> {
    const isEphemeral = interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false;
    const [, ownerId, slotRaw, stateToken] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("This platform prompt isn't for you.", true));
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
    const pmComponents = await this.withPmNowPlayingList(ownerId, interaction.guildId, components);
    await safeUpdate(interaction, {
      components: pmComponents,
      flags: buildComponentsV2Flags(isEphemeral),
    });
  }

  @SelectMenuComponent({ id: /^nowplaying-edit-note-select:\d+$/ })
  async handleEditNoteSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("This note prompt isn't for you.", true));
      return;
    }

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
    const [, ownerId, gameIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("This note prompt isn't for you.", true));
      return;
    }
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
    const [, ownerId, slotRaw, stateToken] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This sort prompt isn't for you."),
      );
      await safeReply(interaction, {
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
        const container = new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent("This sort form has expired. Open Sort again."),
        );
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
      const pmComponents = await this.withPmNowPlayingList(
        ownerId, interaction.guildId, components,
      );
      await safeUpdate(interaction, {
        components: pmComponents,
        flags: buildComponentsV2Flags(isEphemeral),
      });
    } catch {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Could not update the sort form right now."),
      );
      await safeUpdate(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(isEphemeral),
      }).catch(() => {});
    }
  }

  @ButtonComponent({ id: /^nowplaying-sort-save:\d+:[a-z0-9_]+$/ })
  async handleNowPlayingSortSave(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, stateToken] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This sort prompt isn't for you."),
      );
      await safeReply(interaction, {
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
      const pmComponents = await this.withPmNowPlayingList(
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
      const pmComponents = await this.withPmNowPlayingList(
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
      const pmComponents = await this.withPmNowPlayingList(
        ownerId, interaction.guildId, components,
      );
      await safeReply(interaction, { components: pmComponents, flags: responseFlags });
      return;
    }

    const loadingContainer = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## Now Loading\nSaving sort order and generating cover layout...",
      ),
    );
    await safeUpdate(interaction, { components: [loadingContainer], flags: responseFlags });

    const orderedIds = parsed.map((index) => entries[index].gameId);
    const updated = await Member.updateNowPlayingSort(ownerId, orderedIds);
    if (!updated) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Could not update the sort order."),
      );
      const pmComponents = await this.withPmNowPlayingList(
        ownerId, interaction.guildId, [container],
      );
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
      await safeReply(interaction, buildTextReply("This sort prompt isn't for you.", true));
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
      await safeReply(interaction, buildTextReply("This note prompt isn't for you.", true));
      return;
    }

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
      const refreshed = await this.refreshNowPlayingListFromContext(interaction, ownerId);
      if (!interaction.guildId && interaction.message) {
        try {
          const dmComponents = await this.buildNowPlayingEditInitialComponents(ownerId);
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
    await safeReply(interaction, buildTextReply("Could not update that entry.", true));
  }

  @SelectMenuComponent({ id: /^nowplaying-delete-note-select:\d+$/ })
  async handleDeleteNoteSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("This note prompt isn't for you.", true));
      return;
    }

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

    await safeUpdate(interaction, {
      content: "Confirm note deletion:",
      embeds: [embed],
      components: [row],
    });
  }

  @ButtonComponent({ id: /^nowplaying-delete-note-confirm:\d+:\d+:(yes|no)$/ })
  async handleDeleteNoteConfirm(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, gameIdRaw, choice] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("This note prompt isn't for you.", true));
      return;
    }

    if (choice === "no") {
      await safeUpdate(interaction, {
        content: "Cancelled.",
        components: [],
      }).catch(() => {});
      return;
    }

    const gameId = Number(gameIdRaw);
    if (!isPositiveInt(gameId)) {
      await safeReply(interaction, buildTextReply("Invalid selection.", true));
      return;
    }

    const updated = await Member.updateNowPlayingNote(ownerId, gameId, null);
    await safeUpdate(interaction, {
      content: updated ? "Note deleted." : "Could not update that entry.",
      components: [],
    }).catch(() => {});
  }

  @ButtonComponent({ id: /^np-remove:[^:]+:\d+$/ })
  async handleRemoveNowPlayingButton(interaction: ButtonInteraction): Promise<void> {
    const isEphemeral = interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false;
    const [, ownerId, gameIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This remove prompt isn't for you."),
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const gameId = Number(gameIdRaw);
    if (!isPositiveInt(gameId)) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Invalid selection."),
      );
      await safeReply(interaction, {
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
        await safeReply(interaction, {
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
        await safeUpdate(interaction, {
          components: [container],
          flags: buildComponentsV2Flags(isEphemeral),
        });
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
      await safeUpdate(interaction, {
        ...this.buildComponentPayload(pmComponents as any, files),
        flags: buildComponentsV2Flags(isEphemeral),
      });
    } catch (err: any) {
      const msg = extractErrorMessage(err);
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          safeV2TextContent(`Could not remove from Now Playing: ${msg}`, 1000),
        ),
      );
      await safeReply(interaction, {
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
    const contextKey = buildNowPlayingContextKey(
      interaction.message.channelId, interaction.message.id,
    );
    const trackedView = nowPlayingListContexts.get(contextKey)?.view ?? null;
    const singleUserMode = trackedView === "single" || trackedView === "everyone-selected";
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
      const actionRow = this.buildNowPlayingActionRow(
        ownerId,
        showNotes,
        this.hasDisplayableNowPlayingNotes(entries),
        !singleUserMode,
      );
      await safeReply(interaction, {
        components: actionRow ? [container, actionRow] : [container],
        flags: buildComponentsV2Flags(isEphemeral),
      });
      return;
    }

    const payload = await this.buildNowPlayingListPayload(
      target,
      entries,
      interaction.guildId,
      showNotes,
      false,
      singleUserMode,
    );
    const components = this.withNowPlayingActions(
      !singleUserMode,
      ownerId,
      payload.components,
      showNotes,
      this.hasDisplayableNowPlayingNotes(entries),
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
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${NOW_PLAYING_JOURNAL_ADD_PREFIX}:${ownerId}:${gameId}:${page}`)
        .setLabel("Add Entry")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`${NOW_PLAYING_JOURNAL_EDIT_PREFIX}:${ownerId}:${gameId}:${page}`)
        .setLabel("Edit Entry")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!hasEntries),
      new ButtonBuilder()
        .setCustomId(`${NOW_PLAYING_JOURNAL_DELETE_PREFIX}:${ownerId}:${gameId}:${page}`)
        .setLabel("Delete Entry")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!hasEntries),
    );
  }

  @ButtonComponent({ id: /^nowplaying-journal-header:\d+:\d+:\d+$/ })
  async handleNowPlayingJournalHeader(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, gameIdRaw, pageRaw] = interaction.customId.split(":");
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
    const [, ownerId, gameIdRaw, pageRaw] = interaction.customId.split(":");
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
    const [, ownerId] = interaction.customId.split(":");
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
    const [, ownerId, gameIdRaw, , pageRaw] = interaction.customId.split(":");
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
    const [, ownerId, gameIdRaw, pageRaw] = interaction.customId.split(":");
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
    const [, ownerId, gameIdRaw, pageRaw] = interaction.customId.split(":");
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
    const [, ownerId, gameIdRaw, pageRaw] = interaction.customId.split(":");
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
      label: (entry.title ?? `Entry #${entry.entryNumber}`).slice(0, 100),
      value: String(entry.entryId),
      description: formatTableDate(entry.createdAt),
    }));
    const select = new StringSelectMenuBuilder()
      .setCustomId(`${NOW_PLAYING_JOURNAL_DELETE_SELECT_PREFIX}:${ownerId}:${gameId}:${page}`)
      .setPlaceholder("Choose an entry to delete")
      .addOptions(options);
    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent("## Delete Journal Entry\nSelect an entry to delete."),
    );
    const helpRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${NOW_PLAYING_HELP_PREFIX}:journal-delete:${ownerId}`)
        .setLabel("?")
        .setStyle(ButtonStyle.Secondary),
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
    const [, ownerId, gameIdRaw, pageRaw] = interaction.customId.split(":");
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
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        safeV2TextContent(
          `## Confirm Delete\nDelete **${entryTitle}** from ${formatTableDate(entry.createdAt)}?`,
          1000,
        ),
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
      new ButtonBuilder()
        .setCustomId(`${NOW_PLAYING_HELP_PREFIX}:journal-delete-confirm:${ownerId}`)
        .setLabel("?")
        .setStyle(ButtonStyle.Secondary),
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
    const [, action, ownerId, gameIdRaw, pageRaw, entryIdRaw] = interaction.customId.split(":");
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
    const [, ownerId, gameIdRaw, pageRaw] = interaction.customId.split(":");
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
    const [, ownerId, gameIdRaw, pageRaw, entryIdRaw] = interaction.customId.split(":");
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
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          "Only the owner of this Now Playing list can use Edit.",
        ),
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    setNowPlayingListContext(ownerId, interaction.message);
    await nowPlayingOwnerMenu.show(
      interaction,
      ownerId,
      [await this.buildNowPlayingManageRow(ownerId)],
    );
  }

  @ButtonComponent({ id: /^nowplaying-help:[a-z-]+:\d+$/ })
  async handleNowPlayingHelp(interaction: ButtonInteraction): Promise<void> {
    const [, screenType, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("This help button isn't for you.", true));
      return;
    }
    const helpText = NOW_PLAYING_HELP_TEXTS[screenType]
      ?? "No help available for this screen.";
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(safeV2TextContent(helpText, 1000)),
    );
    await safeReply(interaction, {
      components: [container],
      flags: buildComponentsV2Flags(true),
    });
  }

  @ButtonComponent({ id: /^nowplaying-edit-menu-sort:\d+$/ })
  async handleNowPlayingEditMenuSort(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("This edit menu isn't for you.", true));
      return;
    }
    await this.promptSortNowPlayingButtons(interaction, ownerId);
  }

  @ButtonComponent({ id: /^nowplaying-edit-menu-platform:\d+$/ })
  async handleNowPlayingEditMenuPlatform(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("This edit menu isn't for you.", true));
      return;
    }
    await this.promptEditNowPlayingPlatform(interaction, "update");
  }

  @ButtonComponent({ id: /^nowplaying-edit-menu-complete:\d+$/ })
  async handleNowPlayingEditMenuComplete(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("This edit menu isn't for you.", true));
      return;
    }
    const sessionId = createNowPlayingCompletionWizardSession(ownerId, true);
    await this.promptNowPlayingCompletionPick(interaction, ownerId, sessionId);
  }

  @ButtonComponent({ id: /^nowplaying-edit-menu-remove:\d+$/ })
  async handleNowPlayingEditMenuRemove(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("This edit menu isn't for you.", true));
      return;
    }
    await this.promptRemoveNowPlaying(interaction, "update");
  }

  @ButtonComponent({ id: /^nowplaying-edit-menu-start-journal:\d+$/ })
  async handleNowPlayingEditMenuStartJournal(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("This edit menu isn't for you.", true));
      return;
    }
    const entries = await Member.getNowPlaying(ownerId).then(getDisplayNowPlayingEntries);
    const gamesWithoutJournal = entries.filter((e) => !e.hasJournalEntry);
    if (!gamesWithoutJournal.length) {
      await safeUpdate(interaction, {
        components: [await this.buildNowPlayingManageRow(ownerId)],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    const options = gamesWithoutJournal.map((e) => ({
      label: e.title.slice(0, 100),
      value: String(e.gameId),
    }));
    const select = new StringSelectMenuBuilder()
      .setCustomId(`${NOW_PLAYING_EDIT_MENU_START_JOURNAL_SELECT_PREFIX}:${ownerId}`)
      .setPlaceholder("Select a game to start a journal")
      .addOptions(options);
    const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## Start a Game Journal\nSelect a game to write your first entry.",
      ),
    );
    await safeUpdate(interaction, {
      components: [container, selectRow],
      flags: buildComponentsV2Flags(true),
    });
  }

  @SelectMenuComponent({ id: /^nowplaying-edit-menu-start-journal-select:\d+$/ })
  async handleNowPlayingEditMenuStartJournalSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("This edit menu isn't for you.", true));
      return;
    }
    const gameId = Number(interaction.values[0]);
    if (!gameId) return;
    const entries = await Member.getNowPlaying(ownerId).then(getDisplayNowPlayingEntries);
    const selected = entries.find((e) => e.gameId === gameId);
    if (!selected || selected.hasJournalEntry) {
      await safeUpdate(interaction, {
        components: [await this.buildNowPlayingManageRow(ownerId)],
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
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This add prompt isn't for you."),
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    setNowPlayingListContext(ownerId, interaction.message);
    await interaction.showModal(this.buildNowPlayingAddModal()).catch(() => {});
  }

  @ButtonComponent({ id: /^nowplaying-list-edit-platform:\d+$/ })
  async handleNowPlayingListEditPlatform(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("This platform prompt isn't for you.", true));
      return;
    }
    setNowPlayingListContext(ownerId, interaction.message);
    await this.promptEditNowPlayingPlatform(interaction, "update");
  }

  @ButtonComponent({ id: /^np-edit-platform:\d+:\d+$/ })
  async handleNowPlayingEditPlatformPick(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, gameIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("This platform prompt isn't for you.", true));
      return;
    }
    const gameId = Number(gameIdRaw);
    if (!isPositiveInt(gameId)) {
      await safeReply(interaction, buildTextReply("Invalid selection.", true));
      return;
    }
    await this.promptNowPlayingEditPlatformSelection(interaction, ownerId, gameId, "update");
  }

  @ButtonComponent({ id: /^nowplaying-edit-platform-save:\d+:[a-z0-9_]+$/ })
  async handleNowPlayingEditPlatformSave(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, stateToken] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("This platform prompt isn't for you.", true));
      return;
    }

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
      const pmComponents = await this.withPmNowPlayingList(
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
    await this.refreshNowPlayingListFromContext(interaction, ownerId).catch(() => {});
    await this.returnToNowPlayingEditMenu(interaction, ownerId);
  }

  @ButtonComponent({ id: /^nowplaying-edit-platform-reset:\d+$/ })
  async handleNowPlayingEditPlatformReset(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("This platform prompt isn't for you.", true));
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
      await safeReply(interaction, buildTextReply("This sort prompt isn't for you.", true));
      return;
    }
    setNowPlayingListContext(ownerId, interaction.message);
    await this.promptSortNowPlayingButtons(interaction, ownerId);
  }

  @ButtonComponent({ id: /^nowplaying-list-complete:\d+$/ })
  async handleNowPlayingListComplete(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("This completion prompt isn't for you.", true));
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
      await safeReply(interaction, buildTextReply("This completion prompt isn't for you.", true));
      return;
    }
    await this.returnToNowPlayingEditMenu(interaction, ownerId);
  }

  @ButtonComponent({ id: /^nowplaying-list-remove:\d+$/ })
  async handleNowPlayingListRemove(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This remove prompt isn't for you."),
      );
      await safeReply(interaction, {
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
      await safeReply(interaction, buildTextReply("This remove prompt isn't for you.", true));
      return;
    }
    await this.returnToNowPlayingEditMenu(interaction, ownerId);
  }

  @ButtonComponent({ id: /^nowplaying-list-cancel:\d+$/ })
  async handleNowPlayingListCancel(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("This prompt isn't for you.", true));
      return;
    }
    await this.returnToNowPlayingEditMenu(interaction, ownerId);
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
        const container = this.buildNowPlayingMessageContainer(
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

      const container = this.buildNowPlayingMessageContainer(
        "Now Playing",
        `No Now Playing entries found for <@${target.id}>.`,
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
    const payload = await this.buildNowPlayingListPayload(
      target,
      sortedEntries,
      interaction.guildId,
      false,
      isOwnList,
      true,
    );
    const components = this.withNowPlayingActions(
      false,
      target.id,
      payload.components,
      false,
      this.hasDisplayableNowPlayingNotes(sortedEntries),
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
      const ownerName = target.displayName ?? target.username ?? target.id;
      const header = buildUserHeaderContainer(
        selectedUserId,
        ownerName,
        "Now Playing",
        `${NOW_PLAYING_LIST_EDIT_PREFIX}:${selectedUserId}`,
      );
      const container = this.buildNowPlayingMessageContainer(
        "Now Playing - Everyone",
        `No Now Playing entries found for <@${selectedUserId}>.`,
      );
      const components = this.withNowPlayingActions(
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
    const payload = await this.buildNowPlayingListPayload(
      target,
      sortedEntries,
      interaction.guildId,
      false,
      false,
      true,
    );
    const components = this.withNowPlayingActions(
      false,
      selectedUserId,
      payload.components,
      false,
      this.hasDisplayableNowPlayingNotes(sortedEntries),
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
      return `**${renderUsernameWithEmoji(record.userId, displayName)}**: ${count} ${suffix}`;
    });

    const container = this.buildNowPlayingListContainer("Now Playing - Everyone", lines);

    const selectRow = this.buildNowPlayingMemberSelect(sortedLists);

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

  private buildNowPlayingMessageContainer(title: string, message: string): ContainerBuilder {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(safeV2TextContent(`# ${title}`, 250)),
    );
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(safeV2TextContent(message, 1000)),
    );
    return container;
  }

  private buildComponentPayload(
    components: Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>>,
    files?: AttachmentBuilder[],
  ): {
    components: Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>>;
    files?: AttachmentBuilder[];
  } {
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
    showNotes: boolean = false,
    showPrivateOnlyJournalButtons: boolean = false,
    singleUserMode: boolean = false,
  ): Promise<{ components: NowPlayingPayloadComponents; files: AttachmentBuilder[] }> {
    const { files, covers } = await this.buildNowPlayingAttachments(
      entries, NOW_PLAYING_COMPOSITE_MAX,
    );
    const hasDisplayableNotes = this.hasDisplayableNowPlayingNotes(entries);
    const listComponents = this.buildNowPlayingEntryComponents(
      entries,
      target.id,
      guildId,
      await this.buildNowPlayingCompositeImageUrl(files, covers, target.id),
      showNotes,
      showPrivateOnlyJournalButtons,
      singleUserMode,
      singleUserMode,
      hasDisplayableNotes,
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
    const journalSelectRow = this.buildJournalSelectRow(entries, target.id);
    const trailingComponents: NowPlayingPayloadComponents =
      journalSelectRow ? [journalSelectRow] : [];
    return { components: [headerContainer, ...listComponents, ...trailingComponents], files };
  }

  private buildJournalSelectRow(
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
    // eslint-disable-next-line local/no-direct-interaction-response-methods
    hash.update(`owner:${ownerId}|count:${covers.length}|`);
    covers.forEach((cover) => {
      // eslint-disable-next-line local/no-direct-interaction-response-methods
      hash.update(`id:${cover.gameId}|title:${cover.title}|`);
      // eslint-disable-next-line local/no-direct-interaction-response-methods
      hash.update(cover.imageData);
    });
    return hash.digest("hex");
  }

  private buildNowPlayingActionRow(
    ownerId: string,
    showNotes: boolean,
    hasDisplayableNotes: boolean,
    includeEditButton: boolean = true,
  ): ActionRowBuilder<ButtonBuilder> | null {
    void includeEditButton;
    const row = new ActionRowBuilder<ButtonBuilder>();
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
    return row.components.length > 0 ? row : null;
  }

  private buildNowPlayingCancelRow(ownerId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`nowplaying-list-cancel:${ownerId}`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
    );
  }

  private async buildNowPlayingManageRow(
    ownerId: string,
  ): Promise<ActionRowBuilder<ButtonBuilder>> {
    const entries = await Member.getNowPlaying(ownerId).then(getDisplayNowPlayingEntries);
    const hasGamesWithoutJournal = entries.some((e) => !e.hasJournalEntry);
    const buttons: ButtonBuilder[] = [];
    if (hasGamesWithoutJournal) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`${NOW_PLAYING_EDIT_MENU_START_JOURNAL_PREFIX}:${ownerId}`)
          .setLabel("Start a Game Journal")
          .setStyle(ButtonStyle.Success),
      );
    }
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`${NOW_PLAYING_EDIT_MENU_SORT_PREFIX}:${ownerId}`)
        .setLabel("Sort")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${NOW_PLAYING_EDIT_MENU_PLATFORM_PREFIX}:${ownerId}`)
        .setLabel("Edit Platform")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${NOW_PLAYING_EDIT_MENU_COMPLETE_PREFIX}:${ownerId}`)
        .setLabel("Add Completion")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${NOW_PLAYING_EDIT_MENU_REMOVE_PREFIX}:${ownerId}`)
        .setLabel("Remove Game")
        .setStyle(ButtonStyle.Danger),
    );
    return new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
  }

  private buildNowPlayingEditMenuComponents(
    ownerId: string,
    entries: IMemberNowPlayingEntry[],
    statusMessage: string | null = null,
  ): Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>> {
    const introLines = ["## Manage Now Playing\nChoose an action."];
    if (statusMessage) {
      introLines.push(`-# ${statusMessage}`);
    }
    const introContainer = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(safeV2TextContent(introLines.join("\n"), 1000)),
    );
    const listContainer = entries.length
      ? this.buildNowPlayingEntryComponents(
        entries,
        ownerId,
        null,
        null,
        true,
        true,
      )[0]
      : this.buildNowPlayingMessageContainer(
        "Your Now Playing List",
        "Your Now Playing list is empty.",
      );
    const firstRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
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
        .setCustomId(`${NOW_PLAYING_EDIT_MENU_REMOVE_PREFIX}:${ownerId}`)
        .setLabel("Remove Game")
        .setStyle(ButtonStyle.Danger),
    );
    return [introContainer, listContainer, firstRow, secondRow];
  }

  private async returnToNowPlayingEditMenu(
    interaction: AnyRepliable,
    ownerId: string,
  ): Promise<void> {
    const row = await this.buildNowPlayingManageRow(ownerId);
    const flags = buildComponentsV2Flags(true);
    const anyInteraction = interaction as any;
    const isAcked = Boolean(
      anyInteraction.__rpgDeferred ?? anyInteraction.__rpgAcked ??
      anyInteraction.deferred ?? anyInteraction.replied,
    );
    if (isAcked) {
      await safeReply(interaction, { components: [row], flags }).catch(() => {});
    } else {
      await safeUpdate(interaction, { components: [row], flags }).catch(() => {});
    }
  }

  private async buildNowPlayingEditInitialComponents(
    ownerId: string,
    statusMessage: string | null = null,
  ): Promise<Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>>> {
    const entries = await Member.getNowPlaying(ownerId).then(getDisplayNowPlayingEntries);
    return this.buildNowPlayingEditMenuComponents(ownerId, entries, statusMessage);
  }

  private async withPmNowPlayingList(
    _ownerId: string,
    _guildId: string | null,
    components: Array<ContainerBuilder | ActionRowBuilder<any>>,
  ): Promise<Array<ContainerBuilder | ActionRowBuilder<any>>> {
    return components;
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
          safeV2TextContent(this.trimTextDisplayContent(lines.join("\n")), 3500),
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
      new ButtonBuilder()
        .setCustomId(`${NOW_PLAYING_HELP_PREFIX}:completion-pick:${ownerId}`)
        .setLabel("?")
        .setStyle(ButtonStyle.Secondary),
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
        safeV2TextContent(this.trimTextDisplayContent(textLines.join("\n")), 3500),
      ),
    );

    const selectOptions = entries
      .filter((entry) => isPositiveInt(entry.gameId))
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
      new ButtonBuilder()
        .setCustomId(`${NOW_PLAYING_HELP_PREFIX}:remove:${ownerId}`)
        .setLabel("?")
        .setStyle(ButtonStyle.Secondary),
    );
    return [container, selectRow, doneRow];
  }

  @SelectMenuComponent({ id: /^nowplaying-remove-select:\d+$/ })
  async handleNowPlayingRemoveSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const isEphemeral = interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false;
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("This remove prompt isn't for you.", true));
      return;
    }
    const gameId = Number(interaction.values?.[0]);
    if (!isPositiveInt(gameId)) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Invalid game selection."),
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    const loadingContainer = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent("Updating your Now Playing remove list..."),
    );
    await safeUpdate(interaction, {
      components: [loadingContainer],
      flags: buildComponentsV2Flags(isEphemeral),
    });

    try {
      const removed = await Member.removeNowPlaying(ownerId, gameId);
      if (!removed) {
        const container = new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            "Failed to remove that game (it may have been removed already).",
          ),
        );
        await safeReply(interaction, {
          components: [container],
          flags: buildComponentsV2Flags(isEphemeral),
        }).catch(() => {});
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
        await safeReply(interaction, {
          components: pmComponents,
          flags: buildComponentsV2Flags(isEphemeral),
        }).catch(() => {});
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
      await safeReply(interaction, {
        ...this.buildComponentPayload(pmComponents as any, files),
        flags: buildComponentsV2Flags(isEphemeral),
      }).catch(() => {});
    } catch (err: any) {
      const msg = extractErrorMessage(err);
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          safeV2TextContent(`Could not remove from Now Playing: ${msg}`, 1000),
        ),
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(isEphemeral),
      }).catch(() => {});
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
        ? `${entry.title.slice(0, 50)} - ${currentPlatformName}`.slice(0, 100)
        : entry.title.slice(0, 100);
      const select = new StringSelectMenuBuilder()
        .setCustomId(`${NOW_PLAYING_EDIT_PLATFORM_SLOT_PREFIX}:${ownerId}:${slotIndex}:${stateToken}`)
        .setPlaceholder(placeholder)
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options.map((option, optionIndex) => ({
          label: optionIndex === selectedIndex
            ? `${entry.title.slice(0, 50)} - ${option.label}`.slice(0, 100)
            : option.label,
          value: option.value,
          default: selectedIndex === optionIndex,
        })));
      rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
    }
    const components: Array<
      ContainerBuilder | ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>
    > = [
      container,
      ...rows,
    ];

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
      new ButtonBuilder()
        .setCustomId(`${NOW_PLAYING_HELP_PREFIX}:platform:${ownerId}`)
        .setLabel("?")
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
      new ButtonBuilder()
        .setCustomId(`${NOW_PLAYING_HELP_PREFIX}:sort:${ownerId}`)
        .setLabel("?")
        .setStyle(ButtonStyle.Secondary),
    );
    rows.push(actionRow);
    return [container, ...rows];
  }

  private withNowPlayingActions(
    isOwnList: boolean,
    ownerId: string,
    components: NowPlayingPayloadComponents,
    showNotes: boolean,
    hasDisplayableNotes: boolean = true,
    includeEditButton: boolean = true,
  ): NowPlayingMessageComponents {
    if (!isOwnList) {
      return components;
    }
    const actionRow = this.buildNowPlayingActionRow(
      ownerId,
      showNotes,
      hasDisplayableNotes,
      includeEditButton,
    );
    if (!actionRow) {
      return components;
    }
    return [
      ...components,
      actionRow,
    ];
  }

  private hasDisplayableNowPlayingNotes(entries: IMemberNowPlayingEntry[]): boolean {
    return entries.some((entry) => !entry.journalEnabled && Boolean(entry.note?.trim()));
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
            const ownerName = target.displayName ?? target.username ?? target.id;
            const header = buildUserHeaderContainer(
              ownerId,
              ownerName,
              "Now Playing",
              `${NOW_PLAYING_LIST_EDIT_PREFIX}:${ownerId}`,
            );
            const emptyMessage = ownerId === interaction.user.id
              ? "Your Now Playing list is empty."
              : `No Now Playing entries found for <@${ownerId}>.`;
            const container = this.buildNowPlayingMessageContainer(title, emptyMessage);
            const components = [header, container];
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
            showNotes,
            ownerId === interaction.user.id,
            true,
          );
          const components = this.withNowPlayingActions(
            false,
            ownerId,
            payload.components,
            showNotes,
            this.hasDisplayableNowPlayingNotes(entries),
            false,
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
            return `**${renderUsernameWithEmoji(record.userId, displayName)}**: ${count} ${suffix}`;
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
          const target =
            (await interaction.client.users.fetch(selectedUserId).catch(() => null)) ??
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
            const container = this.buildNowPlayingMessageContainer(
              "Now Playing - Everyone",
              `No Now Playing entries found for <@${selectedUserId}>.`,
            );
            const components = this.withNowPlayingActions(
              false,
              selectedUserId,
              [header, container],
              false,
              false,
            );
            await message.edit({
              components,
            });
            updatedAny = true;
            continue;
          }
          const payload = await this.buildNowPlayingListPayload(
            target,
            entries,
            message.guildId ?? interaction.guildId,
            false,
            false,
            true,
          );
          const components = this.withNowPlayingActions(
            false,
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
          .catch((err) => console.error(formatStructuredLog({
            context: "Journal",
            event: "delete_expired_context_from_db_failed",
            error: err instanceof Error ? err.message : String(err),
          })));
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
        .catch((err) => console.error(formatStructuredLog({
          context: "Journal",
          event: "delete_unreachable_context_from_db_failed",
          error: err instanceof Error ? err.message : String(err),
        })));
      return;
    }

    const message = await channel.messages.fetch(latestContext.messageId).catch(() => null);
    if (!message) {
      nowPlayingJournalContexts.delete(latestKey);
      await Member.deleteJournalMessageContext(latestContext.channelId, latestContext.messageId)
        .catch((err) => console.error(formatStructuredLog({
          context: "Journal",
          event: "delete_missing_context_from_db_failed",
          error: err instanceof Error ? err.message : String(err),
        })));
      return;
    }

    await message.delete().catch(() => null);
    nowPlayingJournalContexts.delete(latestKey);
    await Member.deleteJournalMessageContext(latestContext.channelId, latestContext.messageId)
      .catch((err) => console.error(formatStructuredLog({
        context: "Journal",
        event: "delete_context_from_db_after_message_delete_failed",
        error: err instanceof Error ? err.message : String(err),
      })));
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
    entries: IMemberNowPlayingEntry[],
    ownerId: string,
    guildId: string | null,
    imageUrl: string | null,
    showNotes: boolean,
    showPrivateOnlyJournalButtons: boolean = false,
    showHeaderEditHint: boolean = false,
    singleUserMode: boolean = false,
    hasDisplayableNotes: boolean = false,
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
        const journalMark = entry.hasJournalEntry ? " 📒" : "";
        const lines = [`${index + 1}. ${entryTitle}${journalMark}`];
        if (showNotes && entry.note && !entry.journalEnabled) {
          const quotedNote = entry.note
            .split("\n")
            .map((noteLine) => `> ${noteLine}`)
            .join("\n");
          lines.push(quotedNote);
        }
        return lines.join("\n");
      });
      const combined = this.trimTextDisplayContent(entryBlocks.join("\n"));
      if (hasDisplayableNotes) {
        const notesAction = showNotes ? "hide" : "show";
        const notesLabel = showNotes ? "Hide Notes" : "Show Notes";
        const section = new SectionBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent(safeV2TextContent(combined, 3500)),
        );
        section.setButtonAccessory(
          new V2ButtonBuilder()
            .setCustomId(`${NOW_PLAYING_LIST_NOTES_PREFIX}:${ownerId}:${notesAction}`)
            .setLabel(notesLabel)
            .setStyle(ButtonStyle.Secondary),
        );
        container.addSectionComponents(section);
      } else {
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(safeV2TextContent(combined, 3500)),
        );
      }
    } else {
      entries.forEach((entry, index) => {
      if (index === 0) {
        container.addSeparatorComponents(
          new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false),
        );
      }
      const entryTitle = formatEntry(entry, guildId);
      const journalMark = entry.hasJournalEntry ? " 📒" : "";
      const lines = [`${index + 1}. ${entryTitle}${journalMark}`];
      if (showNotes && entry.note && !entry.journalEnabled) {
        const quotedNote = entry.note
          .split("\n")
          .map((noteLine) => `> ${noteLine}`)
          .join("\n");
        lines.push(quotedNote);
      }
      const content = this.trimTextDisplayContent(lines.join("\n"));
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
        new TextDisplayBuilder().setContent("-# *Note: List owner can use button in the header to maintain this list.*"),
      );
    }
    return [container];
  }

  private trimTextDisplayContent(content: string): string {
    if (content.length <= 4000) {
      return content;
    }
    return `${content.slice(0, 3997)}...`;
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
            new ButtonBuilder()
              .setCustomId(`${NOW_PLAYING_JOURNAL_ADD_PREFIX}:${ownerId}:${gameId}:${safePage}`)
              .setLabel("Add Entry")
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(`${NOW_PLAYING_JOURNAL_EDIT_PREFIX}:${ownerId}:${gameId}:${safePage}`)
              .setLabel("Edit Entry")
              .setStyle(ButtonStyle.Primary)
              .setDisabled(!hasEntries),
            new ButtonBuilder()
              .setCustomId(
                `${NOW_PLAYING_JOURNAL_DELETE_PREFIX}:${ownerId}:${gameId}:${safePage}`,
              )
              .setLabel("Delete Entry")
              .setStyle(ButtonStyle.Danger)
              .setDisabled(!hasEntries),
          ]
        : undefined,
      navRowTrailingButtons: !guildId
        ? [
            new ButtonBuilder()
              .setCustomId(`${NOW_PLAYING_HELP_PREFIX}:journal-view:${ownerId}`)
              .setLabel("?")
              .setStyle(ButtonStyle.Secondary),
          ]
        : undefined,
      includeNowPlayingMeta: true,
      includeCompletions: true,
    });
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
            safeV2TextContent(`No IGDB results found for "${session.query}".`, 1000),
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
          const container = new ContainerBuilder().addTextDisplayComponents(
            new TextDisplayBuilder().setContent(safeV2TextContent(msg, 1000)),
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
            safeV2TextContent("Select an IGDB result to import and add to Now Playing:", 1000),
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
        new TextDisplayBuilder().setContent(safeV2TextContent(msg, 1000)),
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
