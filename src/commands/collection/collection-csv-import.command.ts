import {
  ApplicationCommandOptionType,
  ButtonInteraction,
  CommandInteraction,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
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
import {
  type ICollectionCsvImport,
  type ICsvImportReview,
  advanceCollectionCsvImport,
  applyCollectionCsvImportItem,
  getActiveCollectionCsvImportForUser,
  getCollectionCsvImportById,
  getCollectionCsvImportCounts,
  getCollectionCsvImportItemById,
  getCsvImportIgdbCandidates,
  remapCollectionCsvImportItem,
  setCollectionCsvImportStatus,
  skipCollectionCsvImportItem,
  startCollectionCsvImport,
  summarizeCsvImportCounts,
} from "../../classes/CollectionCsvImport.js";
import {
  resolveGameCompletionPlatformLabel,
} from "../game-completion/completion-autocomplete.utils.js";
import {
  canSafeReply,
  replyIfNotOwner,
  safeDeferReply,
  safeDeferUpdate,
  safeReply,
  safeUpdate,
  sanitizeUserInput,
} from "../../functions/InteractionUtils.js";
import {
  buildComponentsV2Flags,
  buildErrorReply,
  buildTextReply,
  buildTitledContainer,
} from "../../functions/ComponentsV2Utils.js";
import {
  OPEN_IMPORT_CONFLICT_LABEL,
  buildCaughtErrorMessage,
  isOpenImportConflict,
} from "../../utilities/ApiErrorUtils.js";
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
} from "./collection-import-ui.utils.js";
import {
  COLLECTION_CSV_EXAMPLE_NOTE,
  COLLECTION_CSV_MAX_BYTES,
  CSV_GAME_ID_INPUT_ID,
  CSV_IMPORT_MAX_ADVANCE_CALLS,
  CSV_REMAP_INPUT_ID,
  buildCollectionCsvChooseId,
  buildCollectionCsvGameIdModalId,
  buildCollectionCsvRemapModalId,
  buildCollectionCsvTemplateAttachment,
  buildCsvIgdbSelectOptions,
  buildCsvImportItemButtons,
  buildCsvImportItemMessage,
  buildCsvImportReasonSummary,
  buildCsvValidationLines,
  describeCsvImportError,
  fetchCsvAttachment,
  getCsvImportErrorCode,
  logCsvImportEvent,
  parseCollectionCsvChooseId,
  parseCollectionCsvGameIdModalId,
  parseCollectionCsvImportActionId,
  parseCollectionCsvRemapModalId,
  readCsvValidationProblems,
} from "./collection-csv-import.service.js";
import {
  createResumableIgdbSession,
  registerIgdbSelectFlow,
} from "../../services/IGDB/IgdbSelectService.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";
import { buildTextInputLabel } from "../../functions/uiComponents.js";
import { safeIgnore } from "../../utilities/AsyncUtils.js";
import { logError } from "../../utilities/LogUtils.js";

type CsvImportInteraction =
  | CommandInteraction
  | ButtonInteraction
  | StringSelectMenuInteraction
  | ModalSubmitInteraction;

type CsvIgdbContext = { ownerId: string; importId: number; itemId: number };

function parseCsvIgdbContext(raw: unknown): CsvIgdbContext | null {
  const value = raw as Partial<CsvIgdbContext> | null;
  if (
    !value ||
    typeof value.ownerId !== "string" ||
    !isPositiveInt(value.importId) ||
    !isPositiveInt(value.itemId)
  ) {
    return null;
  }
  return { ownerId: value.ownerId, importId: value.importId, itemId: value.itemId };
}

/** Replaces the panel on a component or modal interaction, and replies otherwise. */
async function sendCsvImportPanel(
  interaction: CsvImportInteraction,
  components: unknown[],
): Promise<void> {
  const payload = { content: null, components, flags: buildComponentsV2Flags(true) };
  const shouldUpdate = interaction.isModalSubmit() ||
    ((interaction.isButton() || interaction.isStringSelectMenu()) && canSafeReply(interaction));
  if (shouldUpdate) {
    await safeUpdate(interaction, payload);
    return;
  }
  await safeReply(interaction, payload);
}

/**
 * Shows an API failure with its full request and response. A failure the member can act
 * on leads with a plain reason and skips the developer ping.
 */
async function reportCsvImportFailure(
  interaction: CsvImportInteraction,
  fallbackLabel: string,
  error: unknown,
  followUp: boolean,
): Promise<void> {
  const reason = describeCsvImportError(error);
  const message = buildCaughtErrorMessage(reason ?? fallbackLabel, error, {
    devPing: reason === null,
  });
  await safeReply(interaction, {
    ...buildErrorReply(message, true),
    ...(followUp ? { __forceFollowUp: true } : {}),
  });
}

/** True when the API says the import or row moved on, so the panel just needs a redraw. */
function isStaleCsvImportError(error: unknown): boolean {
  const code = getCsvImportErrorCode(error);
  return code === "import_not_active" || code === "item_not_pending";
}

/**
 * Advances the import until a row needs a person. Each call auto-applies up to 25 rows,
 * and a null item on an active import means the cap was hit, so it runs again.
 */
async function advanceToReviewItem(importId: number): Promise<ICsvImportReview> {
  let review = await advanceCollectionCsvImport(importId);
  for (
    let calls = 1;
    !review.item && review.import.status === "ACTIVE" && calls < CSV_IMPORT_MAX_ADVANCE_CALLS;
    calls += 1
  ) {
    review = await advanceCollectionCsvImport(importId);
  }
  return review;
}

/** Advances the import and shows the row that needs a person, or the closing summary. */
async function advanceAndRenderCsvImport(
  interaction: CsvImportInteraction,
  importId: number,
  ownerId: string,
): Promise<void> {
  let review: ICsvImportReview;
  try {
    review = await advanceToReviewItem(importId);
  } catch (error) {
    if (isStaleCsvImportError(error)) {
      await sendCsvImportPanel(interaction, [
        buildImportTextContainer("This CSV import is no longer active."),
      ]);
      return;
    }
    await reportCsvImportFailure(interaction, "Failed to load the next CSV row", error, true);
    return;
  }
  await renderCsvImportReview(interaction, review, ownerId);
}

/**
 * Shows what an advance or remap returned. `igdbQuery` searches IGDB under another title,
 * which a remap passes so the suggestions follow the new search.
 */
async function renderCsvImportReview(
  interaction: CsvImportInteraction,
  review: ICsvImportReview,
  ownerId: string,
  igdbQuery?: string,
): Promise<void> {
  const session = review.import;
  if (session.userId !== ownerId) {
    await sendCsvImportPanel(interaction, [
      buildImportTextContainer("This CSV import session no longer exists."),
    ]);
    return;
  }

  const nextItem = review.item;
  if (!nextItem) {
    const stats = summarizeCsvImportCounts(review.counts);
    if (session.status === "ACTIVE") {
      await sendCsvImportPanel(interaction, [
        buildImportTextContainer(
          `CSV import #${session.importId} is still matching your rows ` +
            `(${stats.pending} left). Use \`/collection import-csv action:resume\` to continue.`,
        ),
      ]);
      return;
    }
    if (session.status !== "COMPLETED") {
      await sendCsvImportPanel(interaction, [
        buildImportTextContainer(
          `CSV import #${session.importId} is ${session.status.toLowerCase()}.`,
        ),
      ]);
      return;
    }
    logCsvImportEvent("completed", {
      userId: ownerId,
      importId: session.importId,
      added: stats.added,
      updated: stats.updated,
      skipped: stats.skipped,
      failed: stats.failed,
    });
    const reasonLines = buildCsvImportReasonSummary(review.counts.byResultReason);
    const done = [
      ...(session.testMode ? ["**TEST MODE** - nothing was persisted"] : []),
      `## CSV Import #${session.importId}`,
      "Import completed.",
      `Added: ${stats.added}`,
      `Updated: ${stats.updated}`,
      `Skipped: ${stats.skipped}`,
      `Failed: ${stats.failed}`,
      ...(reasonLines.length ? ["", `Reasons: ${reasonLines.join(" | ")}`] : []),
    ].join("\n");
    await sendCsvImportPanel(interaction, [buildImportTextContainer(done)]);
    return;
  }

  const candidates = review.candidates;
  const igdbOptions = await loadIgdbOptions(nextItem.itemId, igdbQuery);
  const igdbSession = createResumableIgdbSession({
    ownerId,
    options: igdbOptions,
    flow: csvIgdbFlow,
    context: { ownerId, importId: session.importId, itemId: nextItem.itemId },
    location: { channelId: interaction.channelId, guildId: interaction.guildId },
    emptyMessage: `No IGDB matches found for "${nextItem.rawTitle}". ` +
      "Try Search a different title.",
  });

  const platformLabel = nextItem.platformId
    ? await resolveGameCompletionPlatformLabel(nextItem.platformId)
    : nextItem.rawPlatform ?? "No platform";
  const content = buildCsvImportItemMessage({
    importId: session.importId,
    rowIndex: nextItem.rowIndex,
    totalCount: session.totalCount,
    title: nextItem.rawTitle,
    platformLabel,
    ownershipType: nextItem.ownershipType ?? nextItem.rawOwnershipType ?? "Digital",
    note: nextItem.note ?? nextItem.rawNote,
    sourceGameDbId: nextItem.rawGameDbId,
    sourceIgdbId: nextItem.rawIgdbId,
    testMode: session.testMode,
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
    searchTitle: igdbQuery ?? nextItem.rawTitle,
    igdbRows: igdbSession.components,
    noResultsText: igdbOptions.length
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
    await sendCsvImportPanel(interaction, components);
  } catch (error) {
    const messages = flattenErrorMessages(error);
    logCsvImportEvent("render_failed", {
      importId: session.importId,
      itemId: nextItem.itemId,
      rowIndex: nextItem.rowIndex,
    });
    logError("CsvImport.messageRender", {
      importId: session.importId,
      itemId: nextItem.itemId,
      rowIndex: nextItem.rowIndex,
      candidateCount: candidates.length,
      messages,
    });
    throw error;
  }
}

/** IGDB suggestions are a convenience, so a failed lookup leaves the list empty. */
async function loadIgdbOptions(itemId: number, query?: string) {
  try {
    return buildCsvIgdbSelectOptions(await getCsvImportIgdbCandidates(itemId, query));
  } catch (error) {
    logError("CsvImport.igdbCandidates", { itemId, messages: flattenErrorMessages(error) });
    return [];
  }
}

// Registered at module load so an IGDB pick after a bot restart finds its handler.
const csvIgdbFlow = registerIgdbSelectFlow<CsvIgdbContext>({
  key: "collection-csv-import",
  toJson: (context) => context,
  fromJson: parseCsvIgdbContext,
  onSelect: async (selection, igdbId, context) => {
    try {
      await applyCollectionCsvImportItem(context.itemId, { igdbId });
      logCsvImportEvent("item_igdb_imported", {
        userId: context.ownerId,
        importId: context.importId,
        itemId: context.itemId,
        igdbId,
      });
    } catch (error) {
      if (!isStaleCsvImportError(error)) {
        await reportCsvImportFailure(selection, "Failed to import title from IGDB", error, true);
        return;
      }
    }
    await advanceAndRenderCsvImport(selection, context.importId, context.ownerId);
  },
});

@Discord()
@SlashGroup("collection")
export class CollectionCsvImportCommand {
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
    @SlashOption({
      name: "test_mode",
      description: "Run in test mode (no data is persisted)",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    testMode: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      safeIgnore(safeReply(interaction, buildTextReply(
        "This command can only be used inside a server.",
        true,
      )));
      return;
    }

    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    await handleImportActionCommand<ICollectionCsvImport>({
      interaction,
      action,
      onStart: async () => {
        const existing = await getActiveCollectionCsvImportForUser(interaction.user.id);
        if (existing) {
          await safeReply(
            interaction,
            buildTextReply(
              `You already have import #${existing.importId} (${existing.status}). ` +
                "Use action:resume, action:status, action:pause, or action:cancel.",
              true,
            ),
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
                `Delete the example row marked "${COLLECTION_CSV_EXAMPLE_NOTE}" ` +
                  "before exporting to CSV.",
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

        if (typeof file.size === "number" && file.size > COLLECTION_CSV_MAX_BYTES) {
          await safeReply(
            interaction,
            buildTextReply("That CSV is larger than the 2 MB import limit.", true),
          );
          return;
        }

        const csvText = await fetchCsvAttachment(file);
        if (csvText === null) {
          await safeReply(
            interaction,
            buildTextReply("Failed to download the CSV file. Please try again.", true),
          );
          return;
        }

        let session: ICollectionCsvImport;
        try {
          session = await startCollectionCsvImport({
            userId: interaction.user.id,
            csvText,
            sourceFileName: file.name ?? null,
            testMode: testMode ?? false,
          });
        } catch (error: unknown) {
          const problems = readCsvValidationProblems(error);
          if (problems) {
            const template = await buildCollectionCsvTemplateAttachment();
            await safeReply(interaction, {
              ...buildTextReply(
                [
                  "CSV validation failed. Fix the following issues and try again.",
                  "",
                  ...buildCsvValidationLines(problems),
                ].join("\n"),
                false,
              ),
              files: [template],
            });
            return;
          }
          // The request carries the whole file, so a conflict is told in plain text and
          // anything else goes to the shared error handler.
          if (!isOpenImportConflict(error)) throw error;
          await safeReply(interaction, buildTextReply(OPEN_IMPORT_CONFLICT_LABEL, true));
          return;
        }
        logCsvImportEvent("started", {
          userId: interaction.user.id,
          importId: session.importId,
          total: session.totalCount,
        });

        await safeReply(
          interaction,
          buildTextReply(
            `CSV import #${session.importId} created for **${session.totalCount}** rows. ` +
              "Starting review now.",
            true,
          ),
        );
        try {
          await advanceAndRenderCsvImport(interaction, session.importId, interaction.user.id);
        } catch (error: unknown) {
          logCsvImportEvent("first_panel_failed", {
            userId: interaction.user.id,
            importId: session.importId,
            error: String((error as Error)?.message ?? "unknown"),
          });
          await safeReply(
            interaction,
            buildTextReply(
              "The import was created, but the first row could not be shown. " +
                "Use action:resume to continue.",
              true,
            ),
          );
        }
      },
      getActiveSession: (userId: string) => getActiveCollectionCsvImportForUser(userId),
      onMissingSession: async () => {
        await safeReply(interaction, buildTextReply("No active CSV import session found.", true));
      },
      onStatus: async (session) => {
        const counts = await getCollectionCsvImportCounts(session.importId);
        const stats = summarizeCsvImportCounts(counts);
        const reasonLines = buildCsvImportReasonSummary(counts.byResultReason);
        const statusLine = `Status: ${session.status}` +
          (session.testMode ? " (TEST MODE)" : "");
        const countsLine = `**Pending** ${stats.pending} | **Added** ${stats.added}` +
          ` | **Updated** ${stats.updated} | **Skipped** ${stats.skipped}` +
          ` | **Failed** ${stats.failed}`;
        const parts = [statusLine, countsLine];
        if (reasonLines.length) {
          parts.push(
            `**Reason breakdown** ${reasonLines.join(" | ").slice(0, 500)}`,
          );
        }
        const container = buildTitledContainer(
          `CSV Collection Import #${session.importId}`,
          parts.join("\n\n"),
        );
        await safeReply(interaction, {
          components: [container],
          flags: buildComponentsV2Flags(false),
        });
      },
      onPause: async (session) => {
        await setCollectionCsvImportStatus(session.importId, "PAUSED");
        const stats = summarizeCsvImportCounts(
          await getCollectionCsvImportCounts(session.importId),
        );
        logCsvImportEvent("paused", {
          userId: interaction.user.id,
          importId: session.importId,
          pending: stats.pending,
        });
        await safeReply(
          interaction,
          buildTextReply(
            `CSV import #${session.importId} paused. ` +
              `Pending ${stats.pending}, Added ${stats.added}, Updated ${stats.updated}, ` +
              `Skipped ${stats.skipped}, Failed ${stats.failed}.`,
            true,
          ),
        );
      },
      onCancel: async (session) => {
        await setCollectionCsvImportStatus(session.importId, "CANCELED");
        const stats = summarizeCsvImportCounts(
          await getCollectionCsvImportCounts(session.importId),
        );
        logCsvImportEvent("canceled", {
          userId: interaction.user.id,
          importId: session.importId,
          pending: stats.pending,
        });
        await safeReply(
          interaction,
          buildTextReply(
            `CSV import #${session.importId} canceled. ` +
              `Pending ${stats.pending}, Added ${stats.added}, Updated ${stats.updated}, ` +
              `Skipped ${stats.skipped}, Failed ${stats.failed}.`,
            true,
          ),
        );
      },
      onResume: async (session) => {
        await setCollectionCsvImportStatus(session.importId, "ACTIVE");
        await safeReply(
          interaction,
          buildTextReply(`CSV import #${session.importId} resumed.`, true),
        );
        logCsvImportEvent("resumed", {
          userId: interaction.user.id,
          importId: session.importId,
        });
        await advanceAndRenderCsvImport(interaction, session.importId, interaction.user.id);
      },
    });
  }

  @ButtonComponent({
    id: /^collection-csv-import-v1:[^:]+:\d+:\d+:[srpi]$/,
  })
  async onCsvImportAction(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseCollectionCsvImportActionId(interaction.customId);
    if (!parsed) {
      safeIgnore(safeReply(interaction, buildTextReply(
        "This CSV import control is invalid.",
        true,
      )));
      return;
    }

    if (
      await replyIfNotOwner(interaction, parsed.ownerId, "This CSV import control is not for you.")
    ) return;

    if (parsed.action === "pause") {
      const session = await getCollectionCsvImportById(parsed.importId);
      if (!session || session.userId !== parsed.ownerId) {
        await sendCsvImportPanel(interaction, [
          buildImportTextContainer("This CSV import session no longer exists."),
        ]);
        return;
      }
      if (session.status !== "ACTIVE") {
        await sendCsvImportPanel(interaction, [
          buildImportTextContainer(
            `CSV import #${session.importId} is ${session.status.toLowerCase()}.`,
          ),
        ]);
        return;
      }
      await setCollectionCsvImportStatus(session.importId, "PAUSED");
      await sendCsvImportPanel(interaction, [
        buildImportTextContainer(
          `CSV import #${session.importId} paused. ` +
          "Use `/collection import-csv action:resume` to continue.",
        ),
      ]);
      return;
    }

    if (parsed.action === "skip") {
      await safeDeferUpdate(interaction);
      try {
        await skipCollectionCsvImportItem(parsed.itemId);
        logCsvImportEvent("item_skipped", {
          userId: parsed.ownerId,
          importId: parsed.importId,
          itemId: parsed.itemId,
        });
      } catch (error) {
        if (!isStaleCsvImportError(error)) {
          await reportCsvImportFailure(interaction, "Failed to skip that CSV row", error, true);
          return;
        }
      }
      await advanceAndRenderCsvImport(interaction, parsed.importId, parsed.ownerId);
      return;
    }

    if (parsed.action === "remap") {
      const item = await getCollectionCsvImportItemById(parsed.itemId);
      if (!item || item.importId !== parsed.importId || item.status !== "PENDING") {
        await safeDeferUpdate(interaction);
        await advanceAndRenderCsvImport(interaction, parsed.importId, parsed.ownerId);
        return;
      }
      const modal = new ModalBuilder()
        .setCustomId(
          buildCollectionCsvRemapModalId({
            ownerId: parsed.ownerId,
            importId: parsed.importId,
            itemId: item.itemId,
          }),
        )
        .setTitle("CSV import remap");

      modal.addLabelComponents(buildTextInputLabel({
        customId: CSV_REMAP_INPUT_ID,
        label: "Search title",
        maxLength: 120,
        value: item.rawTitle.slice(0, 120),
        placeholder: "Call of Duty Classic",
      }));
      safeIgnore(interaction.showModal(modal));
      return;
    }

    if (parsed.action === "game-id") {
      const modal = new ModalBuilder()
        .setCustomId(
          buildCollectionCsvGameIdModalId({
            ownerId: parsed.ownerId,
            importId: parsed.importId,
            itemId: parsed.itemId,
          }),
        )
        .setTitle("CSV import: Enter GameDB ID");

      modal.addLabelComponents(buildTextInputLabel({
        customId: CSV_GAME_ID_INPUT_ID,
        label: "GameDB ID (or IGDB numeric ID)",
        maxLength: 20,
        placeholder: "12345",
      }));
      safeIgnore(interaction.showModal(modal));
      return;
    }
  }

  @ButtonComponent({
    id: /^collection-csv-choose-v1:[^:]+:\d+:\d+:\d+$/,
  })
  async onCsvImportChoose(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseCollectionCsvChooseId(interaction.customId);
    if (!parsed) {
      safeIgnore(
        safeReply(interaction, buildTextReply("This CSV import choice is invalid.", true)),
      );
      return;
    }

    if (
      await replyIfNotOwner(interaction, parsed.ownerId, "This CSV import choice is not for you.")
    ) return;

    await safeDeferUpdate(interaction);
    try {
      await applyCollectionCsvImportItem(parsed.itemId, { gameId: parsed.gameId });
      logCsvImportEvent("item_selected", {
        userId: parsed.ownerId,
        importId: parsed.importId,
        itemId: parsed.itemId,
        gameDbGameId: parsed.gameId,
      });
    } catch (error) {
      if (!isStaleCsvImportError(error)) {
        await reportCsvImportFailure(interaction, "Failed to add that game", error, true);
        return;
      }
    }

    await advanceAndRenderCsvImport(interaction, parsed.importId, parsed.ownerId);
  }

  @ModalComponent({
    id: /^collection-csv-remap-v1:[^:]+:\d+:\d+$/,
  })
  async onCsvImportRemapModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseCollectionCsvRemapModalId(interaction.customId);
    if (!parsed) {
      safeIgnore(safeReply(interaction, buildTextReply("This remap form is invalid.", true)));
      return;
    }

    if (
      await replyIfNotOwner(interaction, parsed.ownerId, "This remap form is not for you.")
    ) return;

    const remapTitle = sanitizeUserInput(
      interaction.fields.getTextInputValue(CSV_REMAP_INPUT_ID) ?? "",
      { preserveNewlines: false, maxLength: 120 },
    ).trim();
    if (!remapTitle) {
      await safeUpdate(interaction, {
        content: "Enter a title to search for remap.",
        components: [],
      });
      return;
    }

    await safeDeferUpdate(interaction);
    let review: ICsvImportReview;
    try {
      review = await remapCollectionCsvImportItem(parsed.itemId, remapTitle);
      logCsvImportEvent("item_remapped", {
        userId: parsed.ownerId,
        importId: parsed.importId,
        itemId: parsed.itemId,
        candidateCount: review.candidates.length,
      });
    } catch (error) {
      if (!isStaleCsvImportError(error)) {
        await reportCsvImportFailure(interaction, "Failed to search for that title", error, true);
        return;
      }
      await advanceAndRenderCsvImport(interaction, parsed.importId, parsed.ownerId);
      return;
    }

    await renderCsvImportReview(interaction, review, parsed.ownerId, remapTitle);
  }

  @ModalComponent({
    id: /^collection-csv-game-id-v1:[^:]+:\d+:\d+$/,
  })
  async onCsvImportGameIdModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseCollectionCsvGameIdModalId(interaction.customId);
    if (!parsed) {
      safeIgnore(safeReply(interaction, buildTextReply("This GameDB ID form is invalid.", true)));
      return;
    }

    if (
      await replyIfNotOwner(interaction, parsed.ownerId, "This GameDB ID form is not for you.")
    ) return;

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

    await safeDeferUpdate(interaction);
    try {
      // A GameDB id wins; any other number is taken as an IGDB id the API imports.
      const game = await Game.getGameById(enteredId);
      const source = game ? "gamedb" : "igdb";
      await applyCollectionCsvImportItem(
        parsed.itemId,
        game ? { gameId: game.id } : { igdbId: enteredId },
      );
      logCsvImportEvent("item_selected_by_game_id", {
        userId: parsed.ownerId,
        importId: parsed.importId,
        itemId: parsed.itemId,
        enteredId,
        source,
      });
    } catch (error) {
      if (!isStaleCsvImportError(error)) {
        await reportCsvImportFailure(
          interaction,
          `Could not find or import game ID ${enteredId}`,
          error,
          true,
        );
        return;
      }
    }

    await advanceAndRenderCsvImport(interaction, parsed.importId, parsed.ownerId);
  }
}
