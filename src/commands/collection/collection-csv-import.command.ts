import {
  ApplicationCommandOptionType,
  ButtonInteraction,
  CommandInteraction,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  ActionRowBuilder,
  type Attachment,
} from "discord.js";
import {
  ButtonComponent,
  Discord,
  ModalComponent,
  Slash,
  SlashChoice,
  SlashGroup,
  SlashOption,
} from "discordx";
import Game from "../../classes/Game.js";
import UserGameCollection from "../../classes/UserGameCollection.js";
import {
  type ICollectionCsvImport,
  type ICollectionCsvImportItem,
  countCollectionCsvImportItems,
  countCollectionCsvImportResultReasons,
  createCollectionCsvImportSession,
  getActiveCollectionCsvImportForUser,
  getCollectionCsvImportById,
  getCollectionCsvImportItemById,
  getNextPendingCollectionCsvImportItem,
  insertCollectionCsvImportItems,
  setCollectionCsvImportStatus,
  updateCollectionCsvImportIndex,
  updateCollectionCsvImportItem,
} from "../../classes/CollectionCsvImport.js";
import {
  resolveGameCompletionPlatformLabel,
} from "../game-completion/completion-autocomplete.utils.js";
import {
  canSafeReply,
  safeDeferReply,
  safeDeferUpdate,
  safeReply,
  safeUpdate,
  sanitizeUserInput,
} from "../../functions/InteractionUtils.js";
import {
  buildImportCandidates,
  buildImportMatchConfidence,
  isExactImportTitleMatch,
  parseImportCandidates,
  searchIgdbWithProgressiveTitleVariants,
  type ImportCandidate,
} from "../../functions/ImportCandidateUtils.js";
import { buildComponentsV2Flags, buildTextReply } from "../../functions/ComponentsV2Utils.js";
import {
  buildImportActionsContainer,
  buildImportMessageContainer,
  buildImportTextContainer,
  flattenErrorMessages,
  handleImportActionCommand,
  IMPORT_ACTIONS,
  logImportComponentDiagnostics,
  type ImportAction,
} from "../imports/import-scaffold.service.js";
import {
  buildImportCandidatesContainer,
  buildImportIgdbContainer,
  buildImportReasonSummary,
} from "./collection-import-ui.utils.js";
import {
  buildCollectionCsvChooseId,
  buildCollectionCsvGameIdModalId,
  buildCollectionCsvRemapModalId,
  buildCsvImportItemButtons,
  buildCsvImportItemMessage,
  CSV_GAME_ID_INPUT_ID,
  CSV_IMPORT_REASON_LABELS,
  CSV_REMAP_INPUT_ID,
  logCsvImportEvent,
  parseCollectionCsvChooseId,
  parseCollectionCsvGameIdModalId,
  parseCollectionCsvImportActionId,
  parseCollectionCsvRemapModalId,
} from "./collection-csv-import.service.js";
import { buildCollectionIgdbSelectOptions } from "./collection-game-resolve.utils.js";
import {
  COLLECTION_CSV_EXAMPLE_NOTE,
  COLLECTION_CSV_TEMPLATE_VERSION,
  buildCollectionCsvTemplateAttachment,
  fetchCsvAttachment,
  parseCollectionCsvImportText,
} from "./collection-csv-import.service.js";
import { createIgdbSession } from "../../services/IGDB/IgdbSelectService.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";
import { DISCORD_EMBED_FIELD_VALUE_MAX } from "../../config/textLimits.js";
import { buildTextInputRow } from "../../functions/uiComponents.js";

@Discord()
@SlashGroup("collection")
export class CollectionCsvImportCommand {
  private async applyCsvImportSelection(params: {
    ownerId: string;
    item: ICollectionCsvImportItem;
    gameId: number;
    reason: "AUTO_MATCH" | "MANUAL_REMAP" | "CSV_GAMEDB_ID" | "CSV_IGDB_ID";
  }): Promise<void> {
    const platformId = params.item.platformId ?? null;
    const platformWarning = !platformId && params.item.rawPlatform
      ? "Platform not recognized; imported without platform."
      : null;
    const ownershipType = params.item.ownershipType ?? "Digital";
    const note = params.item.note ?? null;
    const matchConfidence = params.reason === "AUTO_MATCH" ? "EXACT" : "MANUAL";

    try {
      const created = await UserGameCollection.addEntry({
        userId: params.ownerId,
        gameId: params.gameId,
        platformId,
        ownershipType,
        note,
      });
      await updateCollectionCsvImportItem(params.item.itemId, {
        status: "ADDED",
        gameDbGameId: params.gameId,
        collectionEntryId: created.entryId,
        matchConfidence,
        resultReason: platformWarning ? "PLATFORM_UNRESOLVED" : params.reason,
        errorText: platformWarning,
      });
    } catch (error: any) {
      const message = String(error?.message ?? "");
      const isDuplicate = /already exists/i.test(message);
      await updateCollectionCsvImportItem(params.item.itemId, {
        status: isDuplicate ? "SKIPPED" : "FAILED",
        gameDbGameId: params.gameId,
        matchConfidence,
        resultReason: isDuplicate ? "DUPLICATE" : "ADD_FAILED",
        errorText: message || "Failed to add collection entry.",
      });
    }
  }

  async renderNextCsvImportItem(
    interaction:
      | CommandInteraction
      | ButtonInteraction
      | StringSelectMenuInteraction
      | ModalSubmitInteraction,
    importId: number,
    ownerId: string,
  ): Promise<void> {
    const shouldUseInteractionUpdate =
      (interaction.isButton() || interaction.isStringSelectMenu()) &&
      canSafeReply(interaction);
    const shouldUseModalUpdate = interaction.isModalSubmit();

    const session = await getCollectionCsvImportById(importId);
    if (!session || session.userId !== ownerId) {
      const payload = {
        content: null,
        components: [buildImportTextContainer("This CSV import session no longer exists.")],
        flags: buildComponentsV2Flags(true),
      };
      if (shouldUseInteractionUpdate || shouldUseModalUpdate) {
        await safeUpdate(interaction, payload);
      } else {
        await safeReply(interaction, payload);
      }
      return;
    }

    if (session.status !== "ACTIVE") {
      const payload = {
        content: null,
        components: [buildImportTextContainer(
          `CSV import #${session.importId} is ${session.status.toLowerCase()}.`,
        )],
        flags: buildComponentsV2Flags(true),
      };
      if (shouldUseInteractionUpdate || shouldUseModalUpdate) {
        await safeUpdate(interaction, payload);
      } else {
        await safeReply(interaction, payload);
      }
      return;
    }

    const nextItem = await getNextPendingCollectionCsvImportItem(session.importId);
    if (!nextItem) {
      await setCollectionCsvImportStatus(session.importId, "COMPLETED");
      const stats = await countCollectionCsvImportItems(session.importId);
      const reasonCounts = await countCollectionCsvImportResultReasons(session.importId);
      logCsvImportEvent("completed", {
        userId: ownerId,
        importId: session.importId,
        added: stats.added,
        updated: stats.updated,
        skipped: stats.skipped,
        failed: stats.failed,
      });
      const reasonLines = buildImportReasonSummary(reasonCounts, CSV_IMPORT_REASON_LABELS);
      const done = [
        `## CSV Import #${session.importId}`,
        "Import completed.",
        `Added: ${stats.added}`,
        `Updated: ${stats.updated}`,
        `Skipped: ${stats.skipped}`,
        `Failed: ${stats.failed}`,
        ...(reasonLines.length ? ["", `Reasons: ${reasonLines.join(" | ")}`] : []),
      ].join("\n");
      const payload = {
        content: null,
        components: [buildImportTextContainer(done)],
        flags: buildComponentsV2Flags(true),
      };
      if (shouldUseInteractionUpdate || shouldUseModalUpdate) {
        await safeUpdate(interaction, payload);
      } else {
        await safeReply(interaction, payload);
      }
      return;
    }

    await updateCollectionCsvImportIndex(session.importId, nextItem.rowIndex);

    if (nextItem.rawGameDbId) {
      const game = await Game.getGameById(nextItem.rawGameDbId);
      if (!game) {
        await updateCollectionCsvImportItem(nextItem.itemId, {
          status: "FAILED",
          resultReason: "INVALID_ROW",
          errorText: `GameDB id ${nextItem.rawGameDbId} was not found.`,
        });
        await this.renderNextCsvImportItem(interaction, session.importId, ownerId);
        return;
      }
      await this.applyCsvImportSelection({
        ownerId,
        item: nextItem,
        gameId: game.id,
        reason: "CSV_GAMEDB_ID",
      });
      logCsvImportEvent("item_csv_gamedb_id", {
        userId: ownerId,
        importId: session.importId,
        itemId: nextItem.itemId,
        gameDbGameId: game.id,
      });
      await this.renderNextCsvImportItem(interaction, session.importId, ownerId);
      return;
    }

    if (nextItem.rawIgdbId) {
      try {
        const imported = await Game.importGameFromIgdb(nextItem.rawIgdbId);
        await this.applyCsvImportSelection({
          ownerId,
          item: nextItem,
          gameId: imported.gameId,
          reason: "CSV_IGDB_ID",
        });
        logCsvImportEvent("item_csv_igdb_id", {
          userId: ownerId,
          importId: session.importId,
          itemId: nextItem.itemId,
          igdbId: nextItem.rawIgdbId,
          gameDbGameId: imported.gameId,
        });
      } catch (error: any) {
        await updateCollectionCsvImportItem(nextItem.itemId, {
          status: "FAILED",
          resultReason: "INVALID_ROW",
          errorText: error?.message ?? "Failed to import IGDB id.",
        });
      }
      await this.renderNextCsvImportItem(interaction, session.importId, ownerId);
      return;
    }

    let candidates = parseImportCandidates(nextItem.matchCandidateJson);
    let igdbComponents: ActionRowBuilder<any>[] | null = null;
    let igdbHasResults = false;
    if (!candidates.length) {
      candidates = await buildImportCandidates(nextItem.rawTitle);
      const matchConfidence = buildImportMatchConfidence(nextItem.rawTitle, candidates);
      await updateCollectionCsvImportItem(nextItem.itemId, {
        matchCandidateJson: candidates.length ? JSON.stringify(candidates) : null,
        matchConfidence,
      });
    }

    try {
      const igdbResults = await searchIgdbWithProgressiveTitleVariants(nextItem.rawTitle, 10);
      igdbHasResults = igdbResults.length > 0;
      const options = igdbHasResults ? await buildCollectionIgdbSelectOptions(igdbResults) : [];
      const igdbSession = createIgdbSession(
        ownerId,
        options,
        async (selectionInteraction, igdbId) => {
          const currentSession = await getCollectionCsvImportById(session.importId);
          if (
            !currentSession ||
            currentSession.userId !== ownerId ||
            currentSession.status !== "ACTIVE"
          ) {
            await safeReply(selectionInteraction, {
              ...buildTextReply("This CSV import session is no longer active.", true),
              __forceFollowUp: true,
            });
            return;
          }

          const currentItem = await getCollectionCsvImportItemById(nextItem.itemId);
          if (
            !currentItem ||
            currentItem.importId !== session.importId ||
            currentItem.status !== "PENDING"
          ) {
            await safeReply(selectionInteraction, {
              ...buildTextReply("This import row is no longer pending.", true),
              __forceFollowUp: true,
            });
            return;
          }

          try {
            const imported = await Game.importGameFromIgdb(igdbId);
            await updateCollectionCsvImportItem(currentItem.itemId, {
              matchCandidateJson: JSON.stringify([{
                gameId: imported.gameId,
                title: imported.title,
              } satisfies ImportCandidate]),
              matchConfidence: "MANUAL",
            });

            await this.applyCsvImportSelection({
              ownerId,
              item: currentItem,
              gameId: imported.gameId,
              reason: "MANUAL_REMAP",
            });
            logCsvImportEvent("item_igdb_imported", {
              userId: ownerId,
              importId: session.importId,
              itemId: currentItem.itemId,
              gameDbGameId: imported.gameId,
            });
          } catch (error: any) {
            await updateCollectionCsvImportItem(currentItem.itemId, {
              resultReason: "ADD_FAILED",
              errorText: error?.message ?? "Failed to import title from IGDB.",
            });
          }

          await this.renderNextCsvImportItem(selectionInteraction, session.importId, ownerId);
        },
        undefined,
        `No IGDB matches found for "${nextItem.rawTitle}". Try Search a different title.`,
      );
      igdbComponents = igdbSession.components;
    } catch {
      const igdbSession = createIgdbSession(
        ownerId,
        [],
        async () => {},
        undefined,
        `No IGDB matches found for "${nextItem.rawTitle}". Try Search a different title.`,
      );
      igdbComponents = igdbSession.components;
    }

    const singleExactCandidate = candidates.length === 1 &&
      isExactImportTitleMatch(nextItem.rawTitle, candidates[0].title)
      ? candidates[0]
      : null;
    if (singleExactCandidate) {
      await this.applyCsvImportSelection({
        ownerId,
        item: nextItem,
        gameId: singleExactCandidate.gameId,
        reason: "AUTO_MATCH",
      });
      logCsvImportEvent("item_auto_accepted_exact", {
        userId: ownerId,
        importId: session.importId,
        itemId: nextItem.itemId,
        gameDbGameId: singleExactCandidate.gameId,
      });
      await this.renderNextCsvImportItem(interaction, session.importId, ownerId);
      return;
    }

    const platformLabel = nextItem.platformId
      ? await resolveGameCompletionPlatformLabel(nextItem.platformId)
      : nextItem.rawPlatform ?? "No platform";
    const content = buildCsvImportItemMessage({
      importId: session.importId,
      rowIndex: nextItem.rowIndex,
      totalCount: session.totalCount,
      title: nextItem.rawTitle,
      platformLabel,
      ownershipType: nextItem.ownershipType ?? "Digital",
      note: nextItem.note,
      sourceGameDbId: nextItem.rawGameDbId,
      sourceIgdbId: nextItem.rawIgdbId,
    });
    const guidance = candidates.length > 1
      ? "Ambiguous match. Use Choose to select the right GameDB title."
      : candidates.length === 1
        ? "Single match found. Use Choose to confirm import."
        : "No matches yet. Use Search a different title to search again or Skip.";
    const helpText = "Use **Choose**, or choose **Search a different title**, " +
      "**Enter GameDB or IGDB ID**, **Skip**, or **Pause**.";
    const controlsRow = buildCsvImportItemButtons({
      ownerId,
      importId: session.importId,
      itemId: nextItem.itemId,
    });
    const contentContainer = buildImportMessageContainer({
      content,
      thumbnailUrl: null,
      logPrefix: "CsvImport",
      logMeta: {
        importId: session.importId,
        itemId: nextItem.itemId,
        rowIndex: nextItem.rowIndex,
      },
    });
    const candidatesContainer = await buildImportCandidatesContainer({
      ownerId,
      importId: session.importId,
      itemId: nextItem.itemId,
      headerText: "### GameDB Match Candidates",
      headerHelpText: candidates.length > 1 ? guidance : null,
      candidates,
      buildChooseCustomId: buildCollectionCsvChooseId,
      logPrefix: "CsvImport",
    });
    const igdbContainer = buildImportIgdbContainer({
      searchTitle: nextItem.rawTitle,
      igdbRows: igdbComponents ?? [],
      noResultsText: igdbHasResults
        ? null
        : "No IGDB matches found for this title. Try Search a different title.",
    });
    const actionsContainer = buildImportActionsContainer({
      helpText,
      controlRow: controlsRow,
    });
    const components = [contentContainer, candidatesContainer, igdbContainer, actionsContainer];
    logImportComponentDiagnostics({
      importId: session.importId,
      itemId: nextItem.itemId,
      rowIndex: nextItem.rowIndex,
      components,
      logPrefix: "CsvImport",
      logEvent: logCsvImportEvent,
    });

    try {
      if (shouldUseInteractionUpdate || shouldUseModalUpdate) {
        await safeUpdate(interaction, {
          content: null,
          components,
          flags: buildComponentsV2Flags(true),
        });
        return;
      }
      await safeReply(interaction, {
        content: null,
        components,
        flags: buildComponentsV2Flags(true),
      });
    } catch (error) {
      const messages = flattenErrorMessages(error);
      logCsvImportEvent("render_failed", {
        importId: session.importId,
        itemId: nextItem.itemId,
        rowIndex: nextItem.rowIndex,
      });
      console.error(
        "[CsvImport] message render failed",
        JSON.stringify({
          importId: session.importId,
          itemId: nextItem.itemId,
          rowIndex: nextItem.rowIndex,
          candidateCount: candidates.length,
          messages,
        }),
      );
      throw error;
    }
  }

  @Slash({
    name: "import-csv",
    description: "Import your collection from a custom CSV template",
  })
  async csvImport(
    @SlashChoice(
      ...IMPORT_ACTIONS.map((value) => ({
        name: value,
        value,
      })),
    )
    @SlashOption({
      name: "action",
      description: "CSV import action",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    action: ImportAction,
    @SlashOption({
      name: "file",
      description: "CSV file exported from the collection template (required for start)",
      type: ApplicationCommandOptionType.Attachment,
      required: false,
    })
    file: Attachment | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await safeReply(interaction, buildTextReply(
        "This command can only be used inside a server.",
        true,
      )).catch(() => {});
      return;
    }

    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    await handleImportActionCommand<ICollectionCsvImport>({
      interaction,
      action,
      onStart: async () => {
        const existing = await getActiveCollectionCsvImportForUser(interaction.user.id);
        if (existing) {
          await safeReply(interaction, 
            `You already have import #${existing.importId} (${existing.status}). ` +
            "Use action:resume, action:status, action:pause, or action:cancel.",
          );
          return;
        }

        if (!file) {
          const template = await buildCollectionCsvTemplateAttachment();
          await safeReply(interaction, {
            ...buildTextReply(
              [
                "### Custom CSV Collection Import",
                "Download the attached Excel template and fill in your rows.",
                "Required column: `title`.",
                "Optional columns: `platform`, `ownership_type`, `note`, `gamedb_id`, `igdb_id`.",
                `Delete the example row marked "${COLLECTION_CSV_EXAMPLE_NOTE}" before exporting to CSV.`,
                "Then upload the CSV with `/collection import-csv action:start file:<csv>`.",
                "Duplicates are detected by game, platform, and ownership type.",
              ].join("\n"),
              false,
            ),
            files: [template],
          });
          return;
        }

        const isCsv = file.name?.toLowerCase().endsWith(".csv") ||
          file.contentType?.toLowerCase().includes("csv");
        if (!isCsv) {
          const template = await buildCollectionCsvTemplateAttachment();
          await safeReply(interaction, {
            ...buildTextReply(
              "The uploaded file is not a CSV. Use the attached template and export to CSV.",
              false,
            ),
            files: [template],
          });
          return;
        }

        const csvText = await fetchCsvAttachment(file);
        if (!csvText) {
          await safeReply(interaction, "Failed to download the CSV file. Please try again.");
          return;
        }

        const parsed = await parseCollectionCsvImportText(csvText);
        if (parsed.errors.length) {
          const lines = parsed.errors
            .slice(0, 12)
            .map((error) => `- Row ${error.rowIndex}, ${error.column}: ${error.message}`);
          if (parsed.errors.length > 12) {
            lines.push(`- ...and ${parsed.errors.length - 12} more`);
          }
          const template = await buildCollectionCsvTemplateAttachment();
          await safeReply(interaction, {
            ...buildTextReply(
              [
                "CSV validation failed. Fix the following issues and try again.",
                "",
                ...lines,
              ].join("\n"),
              false,
            ),
            files: [template],
          });
          return;
        }

        if (!parsed.rows.length) {
          await safeReply(interaction, "CSV file contains no importable rows.");
          return;
        }

        const session = await createCollectionCsvImportSession({
          userId: interaction.user.id,
          totalCount: parsed.rows.length,
          sourceFileName: file.name ?? null,
          sourceFileSize: typeof file.size === "number" ? file.size : null,
          templateVersion: COLLECTION_CSV_TEMPLATE_VERSION,
        });
        await insertCollectionCsvImportItems(
          session.importId,
          parsed.rows.map((row) => ({
            rowIndex: row.rowIndex,
            rawTitle: row.title,
            rawPlatform: row.platformRaw,
            rawOwnershipType: row.ownershipRaw,
            rawNote: row.noteRaw,
            rawGameDbId: row.sourceGameDbId,
            rawIgdbId: row.sourceIgdbId,
            platformId: row.platformId,
            ownershipType: row.ownershipType,
            note: row.note,
          })),
        );
        logCsvImportEvent("started", {
          userId: interaction.user.id,
          importId: session.importId,
          total: parsed.rows.length,
        });

        await safeReply(interaction, 
          `CSV import #${session.importId} created for **${parsed.rows.length}** rows. ` +
          "Starting review now.",
        );
        await this.renderNextCsvImportItem(interaction, session.importId, interaction.user.id);
      },
      getActiveSession: (userId: string) => getActiveCollectionCsvImportForUser(userId),
      onMissingSession: async () => {
        await safeReply(interaction, "No active CSV import session found.");
      },
      onStatus: async (session) => {
        const stats = await countCollectionCsvImportItems(session.importId);
        const reasonCounts = await countCollectionCsvImportResultReasons(session.importId);
        const reasonLines = buildImportReasonSummary(reasonCounts, CSV_IMPORT_REASON_LABELS);
        const embed = new EmbedBuilder()
          .setTitle(`CSV Collection Import #${session.importId}`)
          .setDescription(`Status: ${session.status}`)
          .addFields(
            { name: "Pending", value: String(stats.pending), inline: true },
            { name: "Added", value: String(stats.added), inline: true },
            { name: "Updated", value: String(stats.updated), inline: true },
            { name: "Skipped", value: String(stats.skipped), inline: true },
            { name: "Failed", value: String(stats.failed), inline: true },
          );
        if (reasonLines.length) {
          embed.addFields({
            name: "Reason breakdown",
            value: reasonLines.join(" | ").slice(0, DISCORD_EMBED_FIELD_VALUE_MAX),
          });
        }
        await safeReply(interaction, { embeds: [embed] });
      },
      onPause: async (session) => {
        await setCollectionCsvImportStatus(session.importId, "PAUSED");
        const stats = await countCollectionCsvImportItems(session.importId);
        logCsvImportEvent("paused", {
          userId: interaction.user.id,
          importId: session.importId,
          pending: stats.pending,
        });
        await safeReply(interaction, 
          `CSV import #${session.importId} paused. ` +
          `Pending ${stats.pending}, Added ${stats.added}, Updated ${stats.updated}, ` +
          `Skipped ${stats.skipped}, Failed ${stats.failed}.`,
        );
      },
      onCancel: async (session) => {
        await setCollectionCsvImportStatus(session.importId, "CANCELED");
        const stats = await countCollectionCsvImportItems(session.importId);
        logCsvImportEvent("canceled", {
          userId: interaction.user.id,
          importId: session.importId,
          pending: stats.pending,
        });
        await safeReply(interaction, 
          `CSV import #${session.importId} canceled. ` +
          `Pending ${stats.pending}, Added ${stats.added}, Updated ${stats.updated}, ` +
          `Skipped ${stats.skipped}, Failed ${stats.failed}.`,
        );
      },
      onResume: async (session) => {
        await setCollectionCsvImportStatus(session.importId, "ACTIVE");
        await safeReply(interaction, `CSV import #${session.importId} resumed.`);
        logCsvImportEvent("resumed", {
          userId: interaction.user.id,
          importId: session.importId,
        });
        await this.renderNextCsvImportItem(interaction, session.importId, interaction.user.id);
      },
    });
  }

  @ButtonComponent({
    id: /^collection-csv-import-v1:[^:]+:\d+:\d+:[srpi]$/,
  })
  async onCsvImportAction(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseCollectionCsvImportActionId(interaction.customId);
    if (!parsed) {
      await safeReply(interaction, buildTextReply(
        "This CSV import control is invalid.",
        true,
      )).catch(() => {});
      return;
    }

    if (interaction.user.id !== parsed.ownerId) {
      await safeReply(interaction, buildTextReply(
        "This CSV import control is not for you.",
        true,
      )).catch(() => {});
      return;
    }

    const session = await getCollectionCsvImportById(parsed.importId);
    if (!session || session.userId !== parsed.ownerId) {
      await safeUpdate(interaction, {
        content: null,
        components: [buildImportTextContainer("This CSV import session no longer exists.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    if (session.status !== "ACTIVE") {
      await safeUpdate(interaction, {
        content: null,
        components: [buildImportTextContainer(
          `CSV import #${session.importId} is ${session.status.toLowerCase()}.`,
        )],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const item = await getNextPendingCollectionCsvImportItem(session.importId);
    if (!item || item.itemId !== parsed.itemId) {
      await safeDeferUpdate(interaction).catch(() => {});
      await this.renderNextCsvImportItem(interaction, session.importId, parsed.ownerId);
      return;
    }

    if (parsed.action === "pause") {
      await setCollectionCsvImportStatus(session.importId, "PAUSED");
      await safeUpdate(interaction, {
        content: null,
        components: [buildImportTextContainer(
          `CSV import #${session.importId} paused. ` +
          "Use `/collection import-csv action:resume` to continue.",
        )],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (parsed.action === "skip") {
      await safeDeferUpdate(interaction).catch(() => {});
      await updateCollectionCsvImportItem(item.itemId, {
        status: "SKIPPED",
        resultReason: "MANUAL_SKIP",
        errorText: "Skipped by user.",
      });
      logCsvImportEvent("item_skipped", {
        userId: parsed.ownerId,
        importId: session.importId,
        itemId: item.itemId,
      });
      await this.renderNextCsvImportItem(interaction, session.importId, parsed.ownerId);
      return;
    }

    if (parsed.action === "remap") {
      const modal = new ModalBuilder()
        .setCustomId(
          buildCollectionCsvRemapModalId({
            ownerId: parsed.ownerId,
            importId: session.importId,
            itemId: item.itemId,
          }),
        )
        .setTitle("CSV import remap");

      modal.addComponents(buildTextInputRow({
        customId: CSV_REMAP_INPUT_ID,
        label: "Search title",
        maxLength: 120,
        value: item.rawTitle.slice(0, 120),
        placeholder: "Call of Duty Classic",
      }));
      await interaction.showModal(modal).catch(() => {});
      return;
    }

    if (parsed.action === "game-id") {
      const modal = new ModalBuilder()
        .setCustomId(
          buildCollectionCsvGameIdModalId({
            ownerId: parsed.ownerId,
            importId: session.importId,
            itemId: item.itemId,
          }),
        )
        .setTitle("CSV import: Enter GameDB ID");

      modal.addComponents(buildTextInputRow({
        customId: CSV_GAME_ID_INPUT_ID,
        label: "GameDB ID (or IGDB numeric ID)",
        maxLength: 20,
        placeholder: "12345",
      }));
      await interaction.showModal(modal).catch(() => {});
      return;
    }
  }

  @ButtonComponent({
    id: /^collection-csv-choose-v1:[^:]+:\d+:\d+:\d+$/,
  })
  async onCsvImportChoose(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseCollectionCsvChooseId(interaction.customId);
    if (!parsed) {
      await safeReply(interaction, buildTextReply(
        "This CSV import choice is invalid.",
        true,
      )).catch(() => {});
      return;
    }

    if (interaction.user.id !== parsed.ownerId) {
      await safeReply(interaction, buildTextReply(
        "This CSV import choice is not for you.",
        true,
      )).catch(() => {});
      return;
    }

    const session = await getCollectionCsvImportById(parsed.importId);
    if (!session || session.userId !== parsed.ownerId || session.status !== "ACTIVE") {
      await safeUpdate(interaction, {
        content: null,
        components: [buildImportTextContainer(
          "This CSV import session is no longer active.",
        )],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const item = await getNextPendingCollectionCsvImportItem(session.importId);
    if (!item || item.itemId !== parsed.itemId) {
      await safeDeferUpdate(interaction).catch(() => {});
      await this.renderNextCsvImportItem(interaction, session.importId, parsed.ownerId);
      return;
    }

    await safeDeferUpdate(interaction).catch(() => {});
    await this.applyCsvImportSelection({
      ownerId: parsed.ownerId,
      item,
      gameId: parsed.gameId,
      reason: "MANUAL_REMAP",
    });
    logCsvImportEvent("item_selected", {
      userId: parsed.ownerId,
      importId: session.importId,
      itemId: item.itemId,
      gameDbGameId: parsed.gameId,
    });

    await this.renderNextCsvImportItem(interaction, session.importId, parsed.ownerId);
  }

  @ModalComponent({
    id: /^collection-csv-remap-v1:[^:]+:\d+:\d+$/,
  })
  async onCsvImportRemapModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseCollectionCsvRemapModalId(interaction.customId);
    if (!parsed) {
      await safeReply(interaction, buildTextReply(
        "This remap form is invalid.",
        true,
      )).catch(() => {});
      return;
    }

    if (interaction.user.id !== parsed.ownerId) {
      await safeReply(interaction, buildTextReply(
        "This remap form is not for you.",
        true,
      )).catch(() => {});
      return;
    }

    const session = await getCollectionCsvImportById(parsed.importId);
    if (!session || session.userId !== parsed.ownerId || session.status !== "ACTIVE") {
      await safeReply(interaction, buildTextReply(
        "This CSV import session is no longer active.",
        true,
      )).catch(() => {});
      return;
    }

    const item = await getNextPendingCollectionCsvImportItem(session.importId);
    if (!item || item.itemId !== parsed.itemId) {
      await safeUpdate(interaction, {
        content: "This import row is no longer pending.",
        components: [],
      });
      return;
    }

    const gameIdRaw = sanitizeUserInput(
      interaction.fields.getTextInputValue(CSV_REMAP_INPUT_ID) ?? "",
      { preserveNewlines: false, maxLength: 120 },
    );
    const remapTitle = gameIdRaw.trim();
    if (!remapTitle) {
      await updateCollectionCsvImportItem(item.itemId, {
        resultReason: "INVALID_REMAP",
      });
      await safeUpdate(interaction, {
        content: "Enter a title to search for remap.",
        components: [],
      });
      return;
    }

    const remapCandidates = await buildImportCandidates(remapTitle);
    if (!remapCandidates.length) {
      await updateCollectionCsvImportItem(item.itemId, {
        matchCandidateJson: null,
        matchConfidence: null,
        resultReason: "NO_CANDIDATE",
        errorText: `No candidates found for remap search "${remapTitle}".`,
      });
      await safeUpdate(interaction, {
        content:
          `No GameDB matches found for "${remapTitle}". ` +
          "Use Search a different title to try another title or Skip.",
        components: [buildCsvImportItemButtons({
          ownerId: parsed.ownerId,
          importId: session.importId,
          itemId: item.itemId,
        })],
      });
      return;
    }

    const remapMatchConfidence = buildImportMatchConfidence(remapTitle, remapCandidates);
    await updateCollectionCsvImportItem(item.itemId, {
      matchCandidateJson: JSON.stringify(remapCandidates),
      matchConfidence: remapMatchConfidence,
      resultReason: null,
      errorText: null,
    });
    logCsvImportEvent("item_remapped", {
      userId: parsed.ownerId,
      importId: session.importId,
      itemId: item.itemId,
      candidateCount: remapCandidates.length,
    });

    await this.renderNextCsvImportItem(interaction, session.importId, parsed.ownerId);
  }

  @ModalComponent({
    id: /^collection-csv-game-id-v1:[^:]+:\d+:\d+$/,
  })
  async onCsvImportGameIdModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseCollectionCsvGameIdModalId(interaction.customId);
    if (!parsed) {
      await safeReply(interaction, buildTextReply(
        "This GameDB ID form is invalid.",
        true,
      )).catch(() => {});
      return;
    }

    if (interaction.user.id !== parsed.ownerId) {
      await safeReply(interaction, buildTextReply(
        "This GameDB ID form is not for you.",
        true,
      )).catch(() => {});
      return;
    }

    const session = await getCollectionCsvImportById(parsed.importId);
    if (!session || session.userId !== parsed.ownerId || session.status !== "ACTIVE") {
      await safeReply(interaction, buildTextReply(
        "This CSV import session is no longer active.",
        true,
      )).catch(() => {});
      return;
    }

    const item = await getNextPendingCollectionCsvImportItem(session.importId);
    if (!item || item.itemId !== parsed.itemId) {
      await safeUpdate(interaction, {
        content: "This import row is no longer pending.",
        components: [],
      });
      return;
    }

    const gameIdRaw = sanitizeUserInput(
      interaction.fields.getTextInputValue(CSV_GAME_ID_INPUT_ID) ?? "",
      { preserveNewlines: false, maxLength: 20 },
    ).trim();
    const enteredId = Number(gameIdRaw);
    if (!isPositiveInt(enteredId)) {
      await safeUpdate(interaction, {
        content: "Game ID must be a positive integer.",
        components: [],
      });
      return;
    }

    let resolvedGameId: number | null = null;
    let source: "gamedb" | "igdb" | null = null;

    const game = await Game.getGameById(enteredId);
    if (game) {
      resolvedGameId = game.id;
      source = "gamedb";
    } else {
      try {
        const imported = await Game.importGameFromIgdb(enteredId);
        resolvedGameId = imported.gameId;
        source = "igdb";
      } catch {
        resolvedGameId = null;
      }
    }

    if (!resolvedGameId) {
      await safeUpdate(interaction, {
        content: `Could not find or import game ID ${enteredId}.`,
        components: [],
      });
      return;
    }

    await this.applyCsvImportSelection({
      ownerId: parsed.ownerId,
      item,
      gameId: resolvedGameId,
      reason: "MANUAL_REMAP",
    });
    logCsvImportEvent("item_selected_by_game_id", {
      userId: parsed.ownerId,
      importId: session.importId,
      itemId: item.itemId,
      gameDbGameId: resolvedGameId,
      source: source ?? "unknown",
    });

    await this.renderNextCsvImportItem(interaction, session.importId, parsed.ownerId);
  }
}
