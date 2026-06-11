import { ButtonStyle } from "discord.js";
import { buildJournalView } from "../../functions/journalView.js";
import { buildActionButton } from "../../functions/uiComponents.js";
import { NOW_PLAYING_HELP_PREFIX } from "../now-playing-help.js";
import {
  NOW_PLAYING_JOURNAL_ADD_PREFIX,
  NOW_PLAYING_JOURNAL_DELETE_PREFIX,
  NOW_PLAYING_JOURNAL_EDIT_PREFIX,
  NOW_PLAYING_JOURNAL_HEADER_PREFIX,
  NOW_PLAYING_JOURNAL_PAGE_PREFIX,
} from "./nowPlayingIds.js";

export function buildJournalComponents(
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
          buildActionButton({
            customId: `${NOW_PLAYING_HELP_PREFIX}:journal-view:${ownerId}`,
            label: "?",
            style: ButtonStyle.Secondary,
          }),
        ]
      : undefined,
    includeNowPlayingMeta: true,
    includeCompletions: true,
  });
}
