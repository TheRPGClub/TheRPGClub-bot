import {
  type ActionRow,
  ButtonInteraction,
  type MessageActionRowComponent,
  ModalSubmitInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
} from "discord.js";
import { Discord, ButtonComponent, ModalComponent, SelectMenuComponent } from "discordx";
import Member from "../../classes/Member.js";
import {
  extractErrorMessage,
  getModalField,
  replyIfNotOwner,
  safeDeferUpdate,
  safeReply,
  safeUpdate,
} from "../../functions/InteractionUtils.js";
import { buildSelectRow } from "../../functions/uiComponents.js";
import {
  buildComponentsV2Flags,
  buildTextContainer,
} from "../../functions/ComponentsV2Utils.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";
import { assertCustomIdSegments } from "../../utilities/CustomIdUtils.js";
import { safeIgnore } from "../../utilities/AsyncUtils.js";
import GameSearchService from "../../classes/GameSearchService.js";
import {
  MAX_NOW_PLAYING_NOTE_LEN,
  NOW_PLAYING_ADD_MODAL_ID,
  NOW_PLAYING_ADD_NOTE_INPUT_ID,
  NOW_PLAYING_ADD_TITLE_INPUT_ID,
} from "./nowPlayingIds.js";
import { type NowPlayingAddSession } from "./nowPlayingTypes.js";
import {
  clearNowPlayingAddSession,
  nowPlayingAddPlatformSessions,
  nowPlayingAddSessions,
  setNowPlayingListContext,
} from "./nowPlayingContexts.js";
import {
  buildNowPlayingListPayload,
  refreshNowPlayingListFromContext,
  trimTextDisplayContent,
} from "./nowPlayingListRenderer.js";
import { buildNowPlayingAddModal } from "./nowPlayingModals.js";
import { promptNowPlayingAddPlatformSelection } from "./nowPlayingAddService.js";
import {
  startNowPlayingIgdbImport,
  startNowPlayingIgdbImportFromInteraction,
} from "./nowPlayingIgdbImport.service.js";

@Discord()
export class NowPlayingAddHandlers {
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
      const results = await GameSearchService.searchGames(query);
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

  @ButtonComponent({ id: /^nowplaying-list-add:\d+$/ })
  async handleNowPlayingListAdd(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId, "This add prompt isn't for you.")) return;
    setNowPlayingListContext(ownerId, interaction.message);
    safeIgnore(interaction.showModal(buildNowPlayingAddModal()));
  }
}
