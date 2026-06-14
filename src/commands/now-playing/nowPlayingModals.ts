import { ModalBuilder, TextInputStyle } from "discord.js";
import { buildTextInputRow } from "../../functions/uiComponents.js";
import { formatEntryTitleWithPlatform } from "../../functions/NowPlayingUtils.js";
import {
  MAX_NOW_PLAYING_NOTE_LEN,
  NOW_PLAYING_NOTE_MODAL_ID,
  NOW_PLAYING_NOTE_INPUT_ID,
  NOW_PLAYING_ADD_MODAL_ID,
  NOW_PLAYING_ADD_TITLE_INPUT_ID,
  NOW_PLAYING_ADD_NOTE_INPUT_ID,
} from "./nowPlayingIds.js";

export function buildEditNoteModal(
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

export function buildEditNotesModal(
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

export function buildNowPlayingAddModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(NOW_PLAYING_ADD_MODAL_ID)
    .setTitle("Add Now Playing Game")
    .addComponents(
      buildTextInputRow({
        customId: NOW_PLAYING_ADD_TITLE_INPUT_ID,
        label: "Game title",
        maxLength: 100,
      }),
      buildTextInputRow({
        customId: NOW_PLAYING_ADD_NOTE_INPUT_ID,
        label: "Note (optional)",
        style: TextInputStyle.Paragraph,
        required: false,
        maxLength: MAX_NOW_PLAYING_NOTE_LEN,
      }),
    );
}
