import {
  ButtonInteraction,
  MessageFlags,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from "discord.js";
import { Discord, ButtonComponent, ModalComponent, SelectMenuComponent } from "discordx";
import Member from "../../classes/Member.js";
import {
  getModalField,
  replyIfNotOwner,
  safeDeferReply,
  safeReply,
  safeUpdate,
} from "../../functions/InteractionUtils.js";
import { buildActionButton, buildButtonRow } from "../../functions/uiComponents.js";
import {
  buildComponentsV2EditFlags,
  buildComponentsV2Flags,
  buildTextReply,
  buildTitledContainer,
} from "../../functions/ComponentsV2Utils.js";
import { formatEntryTitleWithPlatform } from "../../functions/NowPlayingUtils.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";
import {
  assertCustomIdSegments,
  parseCustomIdSegmentsMin,
} from "../../utilities/CustomIdUtils.js";
import { safeIgnore } from "../../utilities/AsyncUtils.js";
import {
  MAX_NOW_PLAYING_NOTE_LEN,
  NOW_PLAYING_NOTE_INPUT_ID,
  NOW_PLAYING_NOTE_MODAL_MAX_FIELDS,
} from "./nowPlayingIds.js";
import {
  buildNowPlayingEditInitialComponents,
  buildNowPlayingListPayload,
  refreshNowPlayingListFromContext,
} from "./nowPlayingListRenderer.js";
import { buildEditNoteModal } from "./nowPlayingModals.js";
import { setNowPlayingListContext } from "./nowPlayingContexts.js";

@Discord()
export class NowPlayingEditNoteHandlers {
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
}
