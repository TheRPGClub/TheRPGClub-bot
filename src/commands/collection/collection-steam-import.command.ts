import {
  ApplicationCommandOptionType,
  ButtonInteraction,
  CommandInteraction,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
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
  type ISteamImportReview,
  advanceSteamCollectionImport,
  applySteamImportItem,
  getActiveSteamCollectionImportForUser,
  getSteamCollectionImportById,
  getSteamCollectionImportCounts,
  getSteamCollectionImportItemById,
  getSteamImportIgdbCandidates,
  remapSteamImportItem,
  setSteamCollectionImportStatus,
  skipSteamImportItem,
  startSteamCollectionImport,
  summarizeSteamImportCounts,
} from "../../classes/SteamCollectionImport.js";
import Member from "../../classes/Member.js";
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
import { buildCaughtErrorMessage } from "../../utilities/ApiErrorUtils.js";
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
  STEAM_GAME_ID_INPUT_ID,
  STEAM_IMPORT_MAX_ADVANCE_CALLS,
  STEAM_REMAP_INPUT_ID,
  buildCollectionSteamChooseId,
  buildCollectionSteamGameIdModalId,
  buildCollectionSteamRemapModalId,
  buildSteamHeaderImageUrl,
  buildSteamIgdbSelectOptions,
  buildSteamImportItemButtons,
  buildSteamImportItemMessage,
  buildSteamImportReasonSummary,
  describeSteamImportError,
  getSteamImportErrorCode,
  logSteamImportEvent,
  parseCollectionSteamChooseId,
  parseCollectionSteamGameIdModalId,
  parseCollectionSteamImportActionId,
  parseCollectionSteamRemapModalId,
} from "./collection-steam-import.service.js";
import {
  createResumableIgdbSession,
  registerIgdbSelectFlow,
} from "../../services/IGDB/IgdbSelectService.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";
import { buildTextInputLabel } from "../../functions/uiComponents.js";
import { safeIgnore } from "../../utilities/AsyncUtils.js";
import { logError } from "../../utilities/LogUtils.js";

type SteamImportInteraction =
  | CommandInteraction
  | ButtonInteraction
  | StringSelectMenuInteraction
  | ModalSubmitInteraction;

type SteamIgdbContext = { ownerId: string; importId: number; itemId: number };

function parseSteamIgdbContext(raw: unknown): SteamIgdbContext | null {
  const value = raw as Partial<SteamIgdbContext> | null;
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
async function sendSteamImportPanel(
  interaction: SteamImportInteraction,
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
async function reportSteamImportFailure(
  interaction: SteamImportInteraction,
  fallbackLabel: string,
  error: unknown,
  followUp: boolean,
): Promise<void> {
  const reason = describeSteamImportError(error);
  const message = buildCaughtErrorMessage(reason ?? fallbackLabel, error, {
    devPing: reason === null,
  });
  await safeReply(interaction, {
    ...buildErrorReply(message, true),
    ...(followUp ? { __forceFollowUp: true } : {}),
  });
}

/** True when the API says the import or row moved on, so the panel just needs a redraw. */
function isStaleSteamImportError(error: unknown): boolean {
  const code = getSteamImportErrorCode(error);
  return code === "import_not_active" || code === "item_not_pending";
}

/**
 * Advances the import until a row needs a person. Each call auto-applies up to 25 exact
 * matches, and a null item on an active import means the cap was hit, so it runs again.
 */
async function advanceToReviewItem(importId: number): Promise<ISteamImportReview> {
  let review = await advanceSteamCollectionImport(importId);
  for (
    let calls = 1;
    !review.item && review.import.status === "ACTIVE" && calls < STEAM_IMPORT_MAX_ADVANCE_CALLS;
    calls += 1
  ) {
    review = await advanceSteamCollectionImport(importId);
  }
  return review;
}

async function renderNextSteamImportItem(
  interaction: SteamImportInteraction,
  importId: number,
  ownerId: string,
): Promise<void> {
  const session = await getSteamCollectionImportById(importId);
  if (!session || session.userId !== ownerId) {
    await sendSteamImportPanel(interaction, [
      buildImportTextContainer("This Steam import session no longer exists."),
    ]);
    return;
  }

  if (session.status !== "ACTIVE") {
    await sendSteamImportPanel(interaction, [
      buildImportTextContainer(
        `Steam import #${session.importId} is ${session.status.toLowerCase()}.`,
      ),
    ]);
    return;
  }

  let review: ISteamImportReview;
  try {
    review = await advanceToReviewItem(session.importId);
  } catch (error) {
    if (isStaleSteamImportError(error)) {
      await sendSteamImportPanel(interaction, [
        buildImportTextContainer("This Steam import is no longer active."),
      ]);
      return;
    }
    await reportSteamImportFailure(interaction, "Failed to load the next Steam row", error, true);
    return;
  }

  const nextItem = review.item;
  if (!nextItem) {
    const stats = summarizeSteamImportCounts(review.counts);
    if (review.import.status !== "COMPLETED") {
      await sendSteamImportPanel(interaction, [
        buildImportTextContainer(
          `Steam import #${session.importId} is still matching your library ` +
            `(${stats.pending} left). Use \`/collection import-steam action:resume\` to continue.`,
        ),
      ]);
      return;
    }
    logSteamImportEvent("completed", {
      userId: ownerId,
      importId: session.importId,
      added: stats.added,
      updated: stats.updated,
      skipped: stats.skipped,
      failed: stats.failed,
    });
    const reasonLines = buildSteamImportReasonSummary(review.counts.byResultReason);
    const done = [
      `## Steam Import #${session.importId}`,
      "Import completed.",
      `Added: ${stats.added}`,
      `Updated: ${stats.updated}`,
      `Skipped: ${stats.skipped}`,
      `Failed: ${stats.failed}`,
      ...(reasonLines.length ? ["", `Reasons: ${reasonLines.join(" | ")}`] : []),
    ].join("\n");
    await sendSteamImportPanel(interaction, [buildImportTextContainer(done)]);
    return;
  }

  const candidates = review.candidates;
  const igdbOptions = await loadIgdbOptions(nextItem.itemId);
  const igdbSession = createResumableIgdbSession({
    ownerId,
    options: igdbOptions,
    flow: steamIgdbFlow,
    context: { ownerId, importId: session.importId, itemId: nextItem.itemId },
    location: { channelId: interaction.channelId, guildId: interaction.guildId },
    emptyMessage: `No IGDB matches found for "${nextItem.steamAppName}". ` +
      "Try Search a different title.",
  });

  const content = buildSteamImportItemMessage({
    importId: session.importId,
    rowIndex: nextItem.rowIndex,
    totalCount: session.totalCount,
    steamAppName: nextItem.steamAppName,
    steamAppId: nextItem.steamAppId,
  });
  const guidance = candidates.length > 1
    ? "Ambiguous match. Use Choose to select the right GameDB title."
    : candidates.length === 1
      ? "Single match found. Use Choose to confirm import."
      : "No matches yet. Use Search a different title to search again or Skip.";
  const helpText = "Use **Choose**, or choose **Search a different title**, " +
    "**Enter GameDB or IGDB ID**, **Skip**, or **Pause**.";
  const controlsRow = buildSteamImportItemButtons({
    ownerId,
    importId: session.importId,
    itemId: nextItem.itemId,
  });
  const contentContainer = buildImportMessageContainer({
    content,
    thumbnailUrl: buildSteamHeaderImageUrl(nextItem.steamAppId),
    logPrefix: "SteamImport",
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
    buildChooseCustomId: buildCollectionSteamChooseId,
    logPrefix: "SteamImport",
  });
  const igdbContainer = buildImportIgdbContainer({
    searchTitle: nextItem.steamAppName,
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
    logPrefix: "SteamImport",
    logEvent: logSteamImportEvent,
  });

  try {
    await sendSteamImportPanel(interaction, components);
  } catch (error) {
    const messages = flattenErrorMessages(error);
    logSteamImportEvent("render_failed", {
      importId: session.importId,
      itemId: nextItem.itemId,
      rowIndex: nextItem.rowIndex,
    });
    logError("SteamImport.messageRender", {
      importId: session.importId,
      itemId: nextItem.itemId,
      rowIndex: nextItem.rowIndex,
      steamAppId: nextItem.steamAppId,
      steamAppName: nextItem.steamAppName,
      candidateCount: candidates.length,
      messages,
    });
    throw error;
  }
}

/** IGDB suggestions are a convenience, so a failed lookup leaves the list empty. */
async function loadIgdbOptions(itemId: number) {
  try {
    return buildSteamIgdbSelectOptions(await getSteamImportIgdbCandidates(itemId));
  } catch (error) {
    logError("SteamImport.igdbCandidates", { itemId, messages: flattenErrorMessages(error) });
    return [];
  }
}

// Registered at module load so an IGDB pick after a bot restart finds its handler.
const steamIgdbFlow = registerIgdbSelectFlow<SteamIgdbContext>({
  key: "collection-steam-import",
  toJson: (context) => context,
  fromJson: parseSteamIgdbContext,
  onSelect: async (selection, igdbId, context) => {
    try {
      await applySteamImportItem(context.itemId, { igdbId });
      logSteamImportEvent("item_igdb_imported", {
        userId: context.ownerId,
        importId: context.importId,
        itemId: context.itemId,
        igdbId,
      });
    } catch (error) {
      if (!isStaleSteamImportError(error)) {
        await reportSteamImportFailure(selection, "Failed to import title from IGDB", error, true);
        return;
      }
    }
    await renderNextSteamImportItem(selection, context.importId, context.ownerId);
  },
});

@Discord()
@SlashGroup("collection")
export class CollectionSteamImportCommand {
  @Slash({ name: "import-steam", description: "Import your collection from Steam" })
  async steamImport(
    @SlashChoice(
      ...IMPORT_ACTIONS.map((value) => ({
        name: value,
        value,
      })),
    )
    @SlashOption({
      name: "action",
      description: "Steam import action",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    action: ImportAction,
    @SlashOption({
      name: "steam_profile",
      description: "Steam profile URL, vanity name, or SteamID64",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    steamProfile: string | undefined,
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
      safeIgnore(safeReply(interaction, buildTextReply("This command can only be used inside a server.", true)));
      return;
    }

    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    await handleImportActionCommand({
      interaction,
      action,
      onStart: async () => {
        const existing = await getActiveSteamCollectionImportForUser(interaction.user.id);
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

        const identifierInput = steamProfile
          ? sanitizeUserInput(steamProfile, { preserveNewlines: false }).trim()
          : "";
        let identifier = identifierInput;
        if (!identifier) {
          const memberRecord = await Member.getByUserId(interaction.user.id);
          identifier = memberRecord?.steamUrl?.trim() ?? "";
        }

        if (!identifier) {
          await safeReply(
            interaction,
            buildTextReply(
              "Add your Steam profile first:\n" +
                "1. Set it once with `/profile edit steam:<url>`\n" +
                "2. Then run `/collection import-steam action:start`\n" +
                "Or include it now with `steam_profile:<url|vanity|steamid64>`.",
              true,
            ),
          );
          return;
        }

        try {
          const session = await startSteamCollectionImport({
            userId: interaction.user.id,
            steamProfile: identifier,
            testMode: testMode ?? false,
          });
          logSteamImportEvent("started", {
            userId: interaction.user.id,
            importId: session.importId,
            steamId64: session.steamId64,
            total: session.totalCount,
          });

          await safeReply(
            interaction,
            buildTextReply(
              `Steam import #${session.importId} created for **${session.totalCount}** games ` +
                `(${session.sourceProfileName ?? session.steamId64}). Starting review now.`,
              true,
            ),
          );
          try {
            await renderNextSteamImportItem(interaction, session.importId, interaction.user.id);
          } catch (error: unknown) {
            logSteamImportEvent("first_panel_failed", {
              userId: interaction.user.id,
              importId: session.importId,
              error: String((error as Error)?.message ?? "unknown"),
            });
            await safeReply(
              interaction,
              buildTextReply(
                "The import was created, but the first game could not be shown. " +
                  "Use action:resume to continue.",
                true,
              ),
            );
          }
        } catch (error: unknown) {
          logSteamImportEvent("start_failed", {
            userId: interaction.user.id,
            error: String(getSteamImportErrorCode(error) ?? (error as Error)?.message ?? "unknown"),
          });
          await reportSteamImportFailure(interaction, "Failed to start Steam import", error, false);
        }
      },
      getActiveSession: (userId: string) => getActiveSteamCollectionImportForUser(userId),
      onMissingSession: async () => {
        await safeReply(interaction, buildTextReply("No active Steam import session found.", true));
      },
      onStatus: async (session) => {
        const counts = await getSteamCollectionImportCounts(session.importId);
        const stats = summarizeSteamImportCounts(counts);
        const reasonLines = buildSteamImportReasonSummary(counts.byResultReason);
        const statusLine = `Status: ${session.status}`;
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
          `Steam Collection Import #${session.importId}`,
          parts.join("\n\n"),
        );
        await safeReply(interaction, {
          components: [container],
          flags: buildComponentsV2Flags(false),
        });
      },
      onPause: async (session) => {
        await setSteamCollectionImportStatus(session.importId, "PAUSED");
        const stats = summarizeSteamImportCounts(
          await getSteamCollectionImportCounts(session.importId),
        );
        logSteamImportEvent("paused", {
          userId: interaction.user.id,
          importId: session.importId,
          pending: stats.pending,
        });
        await safeReply(
          interaction,
          buildTextReply(
            `Steam import #${session.importId} paused. ` +
              `Pending ${stats.pending}, Added ${stats.added}, Updated ${stats.updated}, ` +
              `Skipped ${stats.skipped}, Failed ${stats.failed}.`,
            true,
          ),
        );
      },
      onCancel: async (session) => {
        await setSteamCollectionImportStatus(session.importId, "CANCELED");
        const stats = summarizeSteamImportCounts(
          await getSteamCollectionImportCounts(session.importId),
        );
        logSteamImportEvent("canceled", {
          userId: interaction.user.id,
          importId: session.importId,
          pending: stats.pending,
        });
        await safeReply(
          interaction,
          buildTextReply(
            `Steam import #${session.importId} canceled. ` +
              `Pending ${stats.pending}, Added ${stats.added}, Updated ${stats.updated}, ` +
              `Skipped ${stats.skipped}, Failed ${stats.failed}.`,
            true,
          ),
        );
      },
      onResume: async (session) => {
        await setSteamCollectionImportStatus(session.importId, "ACTIVE");
        await safeReply(
          interaction,
          buildTextReply(`Steam import #${session.importId} resumed.`, true),
        );
        logSteamImportEvent("resumed", {
          userId: interaction.user.id,
          importId: session.importId,
        });
        await renderNextSteamImportItem(interaction, session.importId, interaction.user.id);
      },
    });
  }

  @ButtonComponent({
    id: /^collection-steam-import-v1:[^:]+:\d+:\d+:[srpi]$/,
  })
  async onSteamImportAction(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseCollectionSteamImportActionId(interaction.customId);
    if (!parsed) {
      safeIgnore(safeReply(interaction, buildTextReply("This Steam import control is invalid.", true)));
      return;
    }

    if (await replyIfNotOwner(interaction, parsed.ownerId, "This Steam import control is not for you.")) return;

    const session = await getSteamCollectionImportById(parsed.importId);
    if (!session || session.userId !== parsed.ownerId) {
      await sendSteamImportPanel(interaction, [
        buildImportTextContainer("This Steam import session no longer exists."),
      ]);
      return;
    }
    if (session.status !== "ACTIVE") {
      await sendSteamImportPanel(interaction, [
        buildImportTextContainer(
          `Steam import #${session.importId} is ${session.status.toLowerCase()}.`,
        ),
      ]);
      return;
    }

    const item = await getSteamCollectionImportItemById(parsed.itemId);
    if (!item || item.importId !== session.importId || item.status !== "PENDING") {
      safeIgnore(safeDeferUpdate(interaction));
      await renderNextSteamImportItem(interaction, session.importId, parsed.ownerId);
      return;
    }

    if (parsed.action === "pause") {
      await setSteamCollectionImportStatus(session.importId, "PAUSED");
      await sendSteamImportPanel(interaction, [
        buildImportTextContainer(
          `Steam import #${session.importId} paused. ` +
          "Use `/collection import-steam action:resume` to continue.",
        ),
      ]);
      return;
    }

    if (parsed.action === "skip") {
      safeIgnore(safeDeferUpdate(interaction));
      try {
        await skipSteamImportItem(item.itemId);
        logSteamImportEvent("item_skipped", {
          userId: parsed.ownerId,
          importId: session.importId,
          itemId: item.itemId,
          steamAppId: item.steamAppId,
        });
      } catch (error) {
        if (!isStaleSteamImportError(error)) {
          await reportSteamImportFailure(interaction, "Failed to skip that Steam row", error, true);
          return;
        }
      }
      await renderNextSteamImportItem(interaction, session.importId, parsed.ownerId);
      return;
    }

    if (parsed.action === "remap") {
      const modal = new ModalBuilder()
        .setCustomId(
          buildCollectionSteamRemapModalId({
            ownerId: parsed.ownerId,
            importId: session.importId,
            itemId: item.itemId,
          }),
        )
        .setTitle("Steam import remap");

      modal.addLabelComponents(buildTextInputLabel({
        customId: STEAM_REMAP_INPUT_ID,
        label: "Search title",
        maxLength: 120,
        value: item.steamAppName.slice(0, 120),
        placeholder: "Call of Duty Classic",
      }));
      safeIgnore(interaction.showModal(modal));
      return;
    }

    if (parsed.action === "game-id") {
      const modal = new ModalBuilder()
        .setCustomId(
          buildCollectionSteamGameIdModalId({
            ownerId: parsed.ownerId,
            importId: session.importId,
            itemId: item.itemId,
          }),
        )
        .setTitle("Steam import: Enter GameDB ID");

      modal.addLabelComponents(buildTextInputLabel({
        customId: STEAM_GAME_ID_INPUT_ID,
        label: "GameDB ID (or IGDB numeric ID)",
        maxLength: 20,
        placeholder: "12345",
      }));
      safeIgnore(interaction.showModal(modal));
      return;
    }
  }

  @ButtonComponent({
    id: /^collection-steam-choose-v1:[^:]+:\d+:\d+:\d+$/,
  })
  async onSteamImportChoose(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseCollectionSteamChooseId(interaction.customId);
    if (!parsed) {
      safeIgnore(safeReply(interaction, buildTextReply("This Steam import choice is invalid.", true)));
      return;
    }

    if (await replyIfNotOwner(interaction, parsed.ownerId, "This Steam import choice is not for you.")) return;

    safeIgnore(safeDeferUpdate(interaction));
    try {
      await applySteamImportItem(parsed.itemId, { gameId: parsed.gameId });
      logSteamImportEvent("item_selected", {
        userId: parsed.ownerId,
        importId: parsed.importId,
        itemId: parsed.itemId,
        gameDbGameId: parsed.gameId,
      });
    } catch (error) {
      if (!isStaleSteamImportError(error)) {
        await reportSteamImportFailure(interaction, "Failed to add that game", error, true);
        return;
      }
    }

    await renderNextSteamImportItem(interaction, parsed.importId, parsed.ownerId);
  }

  @ModalComponent({
    id: /^collection-steam-remap-v1:[^:]+:\d+:\d+$/,
  })
  async onSteamImportRemapModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseCollectionSteamRemapModalId(interaction.customId);
    if (!parsed) {
      safeIgnore(safeReply(interaction, buildTextReply("This remap form is invalid.", true)));
      return;
    }

    if (await replyIfNotOwner(interaction, parsed.ownerId, "This remap form is not for you.")) return;

    const remapTitle = sanitizeUserInput(
      interaction.fields.getTextInputValue(STEAM_REMAP_INPUT_ID) ?? "",
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
    try {
      const review = await remapSteamImportItem(parsed.itemId, remapTitle);
      logSteamImportEvent("item_remapped", {
        userId: parsed.ownerId,
        importId: parsed.importId,
        itemId: parsed.itemId,
        candidateCount: review.candidates.length,
      });
    } catch (error) {
      if (!isStaleSteamImportError(error)) {
        await reportSteamImportFailure(interaction, "Failed to search for that title", error, true);
        return;
      }
    }

    await renderNextSteamImportItem(interaction, parsed.importId, parsed.ownerId);
  }

  @ModalComponent({
    id: /^collection-steam-game-id-v1:[^:]+:\d+:\d+$/,
  })
  async onSteamImportGameIdModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseCollectionSteamGameIdModalId(interaction.customId);
    if (!parsed) {
      safeIgnore(safeReply(interaction, buildTextReply("This GameDB ID form is invalid.", true)));
      return;
    }

    if (await replyIfNotOwner(interaction, parsed.ownerId, "This GameDB ID form is not for you.")) return;

    const gameIdRaw = sanitizeUserInput(
      interaction.fields.getTextInputValue(STEAM_GAME_ID_INPUT_ID) ?? "",
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
      await applySteamImportItem(
        parsed.itemId,
        game ? { gameId: game.id } : { igdbId: enteredId },
      );
      logSteamImportEvent("item_selected_by_game_id", {
        userId: parsed.ownerId,
        importId: parsed.importId,
        itemId: parsed.itemId,
        enteredId,
        source,
      });
    } catch (error) {
      if (!isStaleSteamImportError(error)) {
        await reportSteamImportFailure(
          interaction,
          `Could not find or import game ID ${enteredId}`,
          error,
          true,
        );
        return;
      }
    }

    await renderNextSteamImportItem(interaction, parsed.importId, parsed.ownerId);
  }
}
