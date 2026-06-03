import {
  ApplicationCommandOptionType,
  ButtonInteraction,
  CommandInteraction,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} from "discord.js";
import { ButtonComponent, Discord, ModalComponent, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import Game from "../../classes/Game.js";
import UserGameCollection from "../../classes/UserGameCollection.js";
import {
  type SteamCollectionMatchConfidence,
  countSteamCollectionImportItems,
  countSteamCollectionImportResultReasons,
  createSteamCollectionImportSession,
  getActiveSteamCollectionImportForUser,
  getNextPendingSteamCollectionImportItem,
  getSteamAppGameDbMapByAppId,
  getSteamAppHistoricalMappedGameIds,
  getSteamCollectionImportById,
  getSteamCollectionImportItemById,
  insertSteamCollectionImportItems,
  setSteamCollectionImportStatus,
  updateSteamCollectionImportIndex,
  updateSteamCollectionImportItem,
  upsertSteamAppGameDbMap,
} from "../../classes/SteamCollectionImport.js";
import Member from "../../classes/Member.js";
import {
  resolveGameCompletionPlatformId,
} from "../game-completion/completion-autocomplete.utils.js";
import {
  safeDeferReply,
  safeUpdate,
  sanitizeUserInput,
} from "../../functions/InteractionUtils.js";
import {
  buildImportCandidates,
  buildImportCandidatesFromMappedIds,
  buildImportMatchConfidence,
  dedupeImportCandidates,
  isExactImportTitleMatch,
  parseImportCandidates,
  searchIgdbWithProgressiveTitleVariants,
  type ImportCandidate,
} from "../../functions/ImportCandidateUtils.js";
import { buildComponentsV2Flags } from "../../functions/ComponentsV2Utils.js";
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
  buildCollectionSteamChooseId,
  buildCollectionSteamGameIdModalId,
  buildCollectionSteamRemapModalId,
  buildSteamImportItemButtons,
  buildSteamImportItemMessage,
  buildSteamImportReasonSummary,
  logSteamImportEvent,
  parseCollectionSteamChooseId,
  parseCollectionSteamGameIdModalId,
  parseCollectionSteamImportActionId,
  parseCollectionSteamRemapModalId,
  STEAM_GAME_ID_INPUT_ID,
  STEAM_REMAP_INPUT_ID,
} from "./collection-steam-import.service.js";
import { buildCollectionIgdbSelectOptions } from "./collection-game-resolve.utils.js";
import { SteamApiError, steamApiService } from "../../services/SteamApiService.js";
import { createIgdbSession } from "../../services/IGDB/IgdbSelectService.js";

@Discord()
@SlashGroup("collection")
export class CollectionSteamImportCommand {
  private async applySteamImportSelection(params: {
    ownerId: string;
    gameId: number;
    itemId: number;
    steamAppId: number;
    reason: "AUTO_MATCH" | "MANUAL_REMAP";
  }): Promise<void> {
    const steamPlatformId = await resolveGameCompletionPlatformId("steam");
    const platformId = steamPlatformId ?? null;
    const platformWarning = steamPlatformId
      ? null
      : "Steam platform id not found; imported without platform.";

    try {
      const created = await UserGameCollection.addEntry({
        userId: params.ownerId,
        gameId: params.gameId,
        platformId,
        ownershipType: "Digital",
      });
      await updateSteamCollectionImportItem(params.itemId, {
        status: "ADDED",
        gameDbGameId: params.gameId,
        collectionEntryId: created.entryId,
        matchConfidence: params.reason === "MANUAL_REMAP" ? "MANUAL" : undefined,
        resultReason: steamPlatformId ? params.reason : "PLATFORM_UNRESOLVED",
        errorText: platformWarning,
      });
      await upsertSteamAppGameDbMap({
        steamAppId: params.steamAppId,
        gameDbGameId: params.gameId,
        status: "MAPPED",
        createdBy: params.ownerId,
      });
    } catch (error: any) {
      const message = String(error?.message ?? "");
      const isDuplicate = /already exists/i.test(message);
      await updateSteamCollectionImportItem(params.itemId, {
        status: isDuplicate ? "SKIPPED" : "FAILED",
        gameDbGameId: params.gameId,
        matchConfidence: params.reason === "MANUAL_REMAP" ? "MANUAL" : undefined,
        resultReason: isDuplicate ? "DUPLICATE" : "ADD_FAILED",
        errorText: message || "Failed to add collection entry.",
      });
      if (isDuplicate) {
        await upsertSteamAppGameDbMap({
          steamAppId: params.steamAppId,
          gameDbGameId: params.gameId,
          status: "MAPPED",
          createdBy: params.ownerId,
        });
      }
    }
  }

  async renderNextSteamImportItem(
    interaction:
      | CommandInteraction
      | ButtonInteraction
      | StringSelectMenuInteraction
      | ModalSubmitInteraction,
    importId: number,
    ownerId: string,
  ): Promise<void> {
    const shouldUseInteractionUpdate = (interaction.isButton() || interaction.isStringSelectMenu()) &&
      !interaction.deferred &&
      !interaction.replied;
    const shouldUseModalUpdate = interaction.isModalSubmit();

    const session = await getSteamCollectionImportById(importId);
    if (!session || session.userId !== ownerId) {
      const payload = {
        content: null,
        components: [buildImportTextContainer("This Steam import session no longer exists.")],
        flags: buildComponentsV2Flags(true),
      };
      if (shouldUseInteractionUpdate || shouldUseModalUpdate) {
        await safeUpdate(interaction, payload);
      } else {
        await interaction.editReply(payload);
      }
      return;
    }

    if (session.status !== "ACTIVE") {
      const payload = {
        content: null,
        components: [buildImportTextContainer(
          `Steam import #${session.importId} is ${session.status.toLowerCase()}.`,
        )],
        flags: buildComponentsV2Flags(true),
      };
      if (shouldUseInteractionUpdate || shouldUseModalUpdate) {
        await safeUpdate(interaction, payload);
      } else {
        await interaction.editReply(payload);
      }
      return;
    }

    const nextItem = await getNextPendingSteamCollectionImportItem(session.importId);
    if (!nextItem) {
      await setSteamCollectionImportStatus(session.importId, "COMPLETED");
      const stats = await countSteamCollectionImportItems(session.importId);
      const reasonCounts = await countSteamCollectionImportResultReasons(session.importId);
      logSteamImportEvent("completed", {
        userId: ownerId,
        importId: session.importId,
        added: stats.added,
        updated: stats.updated,
        skipped: stats.skipped,
        failed: stats.failed,
      });
      const reasonLines = buildSteamImportReasonSummary(reasonCounts);
      const done = [
        `## Steam Import #${session.importId}`,
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
        await interaction.editReply(payload);
      }
      return;
    }

    await updateSteamCollectionImportIndex(session.importId, nextItem.rowIndex);
    let candidates = parseImportCandidates(nextItem.matchCandidateJson);
    let igdbComponents: ActionRowBuilder<any>[] | null = null;
    let igdbHasResults = false;
    if (!candidates.length) {
      const mapped = await getSteamAppGameDbMapByAppId(nextItem.steamAppId);
      if (mapped?.status === "MAPPED" && mapped.gameDbGameId) {
        const mappedGame = await Game.getGameById(mapped.gameDbGameId);
        if (mappedGame) {
          candidates = [{ gameId: mappedGame.id, title: mappedGame.title }];
        }
      }
      if (!candidates.length && mapped?.status !== "SKIPPED") {
        candidates = await buildImportCandidates(nextItem.steamAppName);
      }

      if (candidates.length > 1) {
        const historicalGameIds = await getSteamAppHistoricalMappedGameIds({
          steamAppId: nextItem.steamAppId,
          excludeUserId: ownerId,
          limit: 5,
        });
        if (historicalGameIds.length) {
          const historicalCandidates = await buildImportCandidatesFromMappedIds(historicalGameIds);
          candidates = dedupeImportCandidates([...candidates, ...historicalCandidates]);
        }
      }
      const matchConfidence = buildImportMatchConfidence(nextItem.steamAppName, candidates);
      await updateSteamCollectionImportItem(nextItem.itemId, {
        matchCandidateJson: candidates.length ? JSON.stringify(candidates) : null,
        matchConfidence: matchConfidence as SteamCollectionMatchConfidence | null | undefined,
        resultReason: !candidates.length && mapped?.status === "SKIPPED" ? "SKIP_MAPPED" : null,
      });
    }

    try {
      const igdbResults = await searchIgdbWithProgressiveTitleVariants(nextItem.steamAppName, 10);
      igdbHasResults = igdbResults.length > 0;
      const options = igdbHasResults ? await buildCollectionIgdbSelectOptions(igdbResults) : [];
      const igdbSession = createIgdbSession(
        ownerId,
        options,
        async (selectionInteraction, igdbId) => {
          const currentSession = await getSteamCollectionImportById(session.importId);
          if (
            !currentSession ||
            currentSession.userId !== ownerId ||
            currentSession.status !== "ACTIVE"
          ) {
            await selectionInteraction.followUp({
              content: "This Steam import session is no longer active.",
              flags: MessageFlags.Ephemeral,
            }).catch(() => {});
            return;
          }

          const currentItem = await getSteamCollectionImportItemById(nextItem.itemId);
          if (
            !currentItem ||
            currentItem.importId !== session.importId ||
            currentItem.status !== "PENDING"
          ) {
            await selectionInteraction.followUp({
              content: "This import row is no longer pending.",
              flags: MessageFlags.Ephemeral,
            }).catch(() => {});
            return;
          }

          try {
            const imported = await Game.importGameFromIgdb(igdbId);
            await updateSteamCollectionImportItem(currentItem.itemId, {
              matchCandidateJson: JSON.stringify([{
                gameId: imported.gameId,
                title: imported.title,
              } satisfies ImportCandidate]),
              matchConfidence: "MANUAL",
            });

            await this.applySteamImportSelection({
              ownerId,
              gameId: imported.gameId,
              itemId: currentItem.itemId,
              steamAppId: currentItem.steamAppId,
              reason: "MANUAL_REMAP",
            });
            logSteamImportEvent("item_igdb_imported", {
              userId: ownerId,
              importId: session.importId,
              itemId: currentItem.itemId,
              steamAppId: currentItem.steamAppId,
              gameDbGameId: imported.gameId,
            });
          } catch (error: any) {
            await updateSteamCollectionImportItem(currentItem.itemId, {
              resultReason: "ADD_FAILED",
              errorText: error?.message ?? "Failed to import title from IGDB.",
            });
          }

          await this.renderNextSteamImportItem(
            selectionInteraction,
            session.importId,
            ownerId,
          );
        },
        undefined,
        `No IGDB matches found for "${nextItem.steamAppName}". Try Search a different title.`,
      );
      igdbComponents = igdbSession.components;
    } catch {
      const igdbSession = createIgdbSession(
        ownerId,
        [],
        async () => {},
        undefined,
        `No IGDB matches found for "${nextItem.steamAppName}". Try Search a different title.`,
      );
      igdbComponents = igdbSession.components;
    }

    const [steamReleaseYear, steamHeaderImageUrl] = await Promise.all([
      steamApiService.getAppReleaseYear(nextItem.steamAppId),
      steamApiService.getAppHeaderImageUrl(nextItem.steamAppId),
    ]);
    const singleExactCandidate = candidates.length === 1 &&
      isExactImportTitleMatch(nextItem.steamAppName, candidates[0].title)
      ? candidates[0]
      : null;
    if (singleExactCandidate) {
      await this.applySteamImportSelection({
        ownerId,
        gameId: singleExactCandidate.gameId,
        itemId: nextItem.itemId,
        steamAppId: nextItem.steamAppId,
        reason: "AUTO_MATCH",
      });
      logSteamImportEvent("item_auto_accepted_exact", {
        userId: ownerId,
        importId: session.importId,
        itemId: nextItem.itemId,
        steamAppId: nextItem.steamAppId,
        gameDbGameId: singleExactCandidate.gameId,
      });
      await this.renderNextSteamImportItem(interaction, session.importId, ownerId);
      return;
    }
    const content = buildSteamImportItemMessage({
      importId: session.importId,
      rowIndex: nextItem.rowIndex,
      totalCount: session.totalCount,
      steamAppName: nextItem.steamAppName,
      steamAppId: nextItem.steamAppId,
      steamReleaseYear,
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
      thumbnailUrl: steamHeaderImageUrl,
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
      logPrefix: "SteamImport",
      logEvent: logSteamImportEvent,
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
      await interaction.editReply({
        content: null,
        components,
        flags: buildComponentsV2Flags(true),
      });
    } catch (error) {
      const messages = flattenErrorMessages(error);
      logSteamImportEvent("render_failed", {
        importId: session.importId,
        itemId: nextItem.itemId,
        rowIndex: nextItem.rowIndex,
      });
      console.error(
        "[SteamImport] message render failed",
        JSON.stringify({
          importId: session.importId,
          itemId: nextItem.itemId,
          rowIndex: nextItem.rowIndex,
          steamAppId: nextItem.steamAppId,
          steamAppName: nextItem.steamAppName,
          candidateCount: candidates.length,
          messages,
        }),
      );
      throw error;
    }
  }

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
    interaction: CommandInteraction,
  ): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({
        content: "This command can only be used inside a server.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    await handleImportActionCommand({
      interaction,
      action,
      onStart: async () => {
        const existing = await getActiveSteamCollectionImportForUser(interaction.user.id);
        if (existing) {
          await interaction.editReply(
            `You already have import #${existing.importId} (${existing.status}). ` +
            "Use action:resume, action:status, action:pause, or action:cancel.",
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
          await interaction.editReply(
            "Add your Steam profile first:\n" +
            "1. Set it once with `/profile edit steam:<url>`\n" +
            "2. Then run `/collection import-steam action:start`\n" +
            "Or include it now with `steam_profile:<url|vanity|steamid64>`.",
          );
          return;
        }

        try {
          const resolved = await steamApiService.resolveProfileIdentifier(identifier);
          const library = await steamApiService.getOwnedGames(resolved.steamId64);

          if (!library.games.length) {
            await interaction.editReply(
              "No Steam games were found. Ensure your profile and game details are public.",
            );
            return;
          }

          const session = await createSteamCollectionImportSession({
            userId: interaction.user.id,
            totalCount: library.games.length,
            steamId64: resolved.steamId64,
            steamProfileRef: identifier,
            sourceProfileName: library.profileName,
          });

          await insertSteamCollectionImportItems(
            session.importId,
            library.games.map((game, index) => ({
              rowIndex: index + 1,
              steamAppId: game.appId,
              steamAppName: game.name,
              playtimeForeverMin: game.playtimeForeverMinutes,
              playtimeWindowsMin: game.playtimeWindowsMinutes,
              playtimeMacMin: game.playtimeMacMinutes,
              playtimeLinuxMin: game.playtimeLinuxMinutes,
              playtimeDeckMin: game.playtimeDeckMinutes,
              lastPlayedAt: game.lastPlayedAt,
            })),
          );
          logSteamImportEvent("started", {
            userId: interaction.user.id,
            importId: session.importId,
            steamId64: resolved.steamId64,
            total: library.gameCount,
          });

          await interaction.editReply(
            `Steam import #${session.importId} created for **${library.gameCount}** games ` +
            `(${library.profileName ?? resolved.steamId64}). Starting review now.`,
          );
          await this.renderNextSteamImportItem(
            interaction,
            session.importId,
            interaction.user.id,
          );
        } catch (error: any) {
          logSteamImportEvent("start_failed", {
            userId: interaction.user.id,
            error: String(error?.message ?? "unknown"),
          });
          if (error instanceof SteamApiError) {
            await interaction.editReply(error.message);
            return;
          }
          await interaction.editReply(
            error?.message ?? "Failed to start Steam import. Verify profile and try again.",
          );
        }
      },
      getActiveSession: (userId: string) => getActiveSteamCollectionImportForUser(userId),
      onMissingSession: async () => {
        await interaction.editReply("No active Steam import session found.");
      },
      onStatus: async (session) => {
        const stats = await countSteamCollectionImportItems(session.importId);
        const reasonCounts = await countSteamCollectionImportResultReasons(session.importId);
        const reasonLines = buildSteamImportReasonSummary(reasonCounts);
        const embed = new EmbedBuilder()
          .setTitle(`Steam Collection Import #${session.importId}`)
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
            value: reasonLines.join(" | ").slice(0, 1024),
          });
        }
        await interaction.editReply({ embeds: [embed] });
      },
      onPause: async (session) => {
        await setSteamCollectionImportStatus(session.importId, "PAUSED");
        const stats = await countSteamCollectionImportItems(session.importId);
        logSteamImportEvent("paused", {
          userId: interaction.user.id,
          importId: session.importId,
          pending: stats.pending,
        });
        await interaction.editReply(
          `Steam import #${session.importId} paused. ` +
          `Pending ${stats.pending}, Added ${stats.added}, Updated ${stats.updated}, ` +
          `Skipped ${stats.skipped}, Failed ${stats.failed}.`,
        );
      },
      onCancel: async (session) => {
        await setSteamCollectionImportStatus(session.importId, "CANCELED");
        const stats = await countSteamCollectionImportItems(session.importId);
        logSteamImportEvent("canceled", {
          userId: interaction.user.id,
          importId: session.importId,
          pending: stats.pending,
        });
        await interaction.editReply(
          `Steam import #${session.importId} canceled. ` +
          `Pending ${stats.pending}, Added ${stats.added}, Updated ${stats.updated}, ` +
          `Skipped ${stats.skipped}, Failed ${stats.failed}.`,
        );
      },
      onResume: async (session) => {
        await setSteamCollectionImportStatus(session.importId, "ACTIVE");
        await interaction.editReply(`Steam import #${session.importId} resumed.`);
        logSteamImportEvent("resumed", {
          userId: interaction.user.id,
          importId: session.importId,
        });
        await this.renderNextSteamImportItem(
          interaction,
          session.importId,
          interaction.user.id,
        );
      },
    });
  }

  @ButtonComponent({
    id: /^collection-steam-import-v1:[^:]+:\d+:\d+:[srpi]$/,
  })
  async onSteamImportAction(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseCollectionSteamImportActionId(interaction.customId);
    if (!parsed) {
      await interaction.reply({
        content: "This Steam import control is invalid.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (interaction.user.id !== parsed.ownerId) {
      await interaction.reply({
        content: "This Steam import control is not for you.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const session = await getSteamCollectionImportById(parsed.importId);
    if (!session || session.userId !== parsed.ownerId) {
      await safeUpdate(interaction, {
        content: null,
        components: [buildImportTextContainer("This Steam import session no longer exists.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    if (session.status !== "ACTIVE") {
      await safeUpdate(interaction, {
        content: null,
        components: [buildImportTextContainer(
          `Steam import #${session.importId} is ${session.status.toLowerCase()}.`,
        )],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const item = await getNextPendingSteamCollectionImportItem(session.importId);
    if (!item || item.itemId !== parsed.itemId) {
      await interaction.deferUpdate().catch(() => {});
      await this.renderNextSteamImportItem(interaction, session.importId, parsed.ownerId);
      return;
    }

    if (parsed.action === "pause") {
      await setSteamCollectionImportStatus(session.importId, "PAUSED");
      await safeUpdate(interaction, {
        content: null,
        components: [buildImportTextContainer(
          `Steam import #${session.importId} paused. ` +
          "Use `/collection import-steam action:resume` to continue.",
        )],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (parsed.action === "skip") {
      await interaction.deferUpdate().catch(() => {});
      await updateSteamCollectionImportItem(item.itemId, {
        status: "SKIPPED",
        resultReason: "MANUAL_SKIP",
        errorText: "Skipped by user.",
      });
      logSteamImportEvent("item_skipped", {
        userId: parsed.ownerId,
        importId: session.importId,
        itemId: item.itemId,
        steamAppId: item.steamAppId,
      });
      await upsertSteamAppGameDbMap({
        steamAppId: item.steamAppId,
        gameDbGameId: null,
        status: "SKIPPED",
        createdBy: parsed.ownerId,
      });
      await this.renderNextSteamImportItem(interaction, session.importId, parsed.ownerId);
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

      const remapInput = new TextInputBuilder()
        .setCustomId(STEAM_REMAP_INPUT_ID)
        .setLabel("Search title")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(120)
        .setValue(item.steamAppName.slice(0, 120))
        .setPlaceholder("Call of Duty Classic");

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(remapInput),
      );
      await interaction.showModal(modal).catch(() => {});
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

      const gameIdInput = new TextInputBuilder()
        .setCustomId(STEAM_GAME_ID_INPUT_ID)
        .setLabel("GameDB ID (or IGDB numeric ID)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(20)
        .setPlaceholder("12345");

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(gameIdInput),
      );
      await interaction.showModal(modal).catch(() => {});
      return;
    }
  }

  @ButtonComponent({
    id: /^collection-steam-choose-v1:[^:]+:\d+:\d+:\d+$/,
  })
  async onSteamImportChoose(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseCollectionSteamChooseId(interaction.customId);
    if (!parsed) {
      await interaction.reply({
        content: "This Steam import choice is invalid.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (interaction.user.id !== parsed.ownerId) {
      await interaction.reply({
        content: "This Steam import choice is not for you.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const session = await getSteamCollectionImportById(parsed.importId);
    if (!session || session.userId !== parsed.ownerId || session.status !== "ACTIVE") {
      await safeUpdate(interaction, {
        content: null,
        components: [buildImportTextContainer(
          "This Steam import session is no longer active.",
        )],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const item = await getNextPendingSteamCollectionImportItem(session.importId);
    if (!item || item.itemId !== parsed.itemId) {
      await interaction.deferUpdate().catch(() => {});
      await this.renderNextSteamImportItem(interaction, session.importId, parsed.ownerId);
      return;
    }

    await interaction.deferUpdate().catch(() => {});
    await this.applySteamImportSelection({
      ownerId: parsed.ownerId,
      gameId: parsed.gameId,
      itemId: item.itemId,
      steamAppId: item.steamAppId,
      reason: "MANUAL_REMAP",
    });
    logSteamImportEvent("item_selected", {
      userId: parsed.ownerId,
      importId: session.importId,
      itemId: item.itemId,
      steamAppId: item.steamAppId,
      gameDbGameId: parsed.gameId,
    });

    await this.renderNextSteamImportItem(interaction, session.importId, parsed.ownerId);
  }

  @ModalComponent({
    id: /^collection-steam-remap-v1:[^:]+:\d+:\d+$/,
  })
  async onSteamImportRemapModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseCollectionSteamRemapModalId(interaction.customId);
    if (!parsed) {
      await interaction.reply({
        content: "This remap form is invalid.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (interaction.user.id !== parsed.ownerId) {
      await interaction.reply({
        content: "This remap form is not for you.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const session = await getSteamCollectionImportById(parsed.importId);
    if (!session || session.userId !== parsed.ownerId || session.status !== "ACTIVE") {
      await interaction.reply({
        content: "This Steam import session is no longer active.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const item = await getNextPendingSteamCollectionImportItem(session.importId);
    if (!item || item.itemId !== parsed.itemId) {
      await safeUpdate(interaction, {
        content: "This import row is no longer pending.",
        components: [],
      });
      return;
    }

    const gameIdRaw = sanitizeUserInput(
      interaction.fields.getTextInputValue(STEAM_REMAP_INPUT_ID) ?? "",
      { preserveNewlines: false, maxLength: 120 },
    );
    const remapTitle = gameIdRaw.trim();
    if (!remapTitle) {
      await updateSteamCollectionImportItem(item.itemId, {
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
      await updateSteamCollectionImportItem(item.itemId, {
        matchCandidateJson: null,
        matchConfidence: null,
        resultReason: "NO_CANDIDATE",
        errorText: `No candidates found for remap search "${remapTitle}".`,
      });
      await safeUpdate(interaction, {
        content:
          `No GameDB matches found for "${remapTitle}". ` +
          "Use Search a different title to try another title or Skip.",
        components: [buildSteamImportItemButtons({
          ownerId: parsed.ownerId,
          importId: session.importId,
          itemId: item.itemId,
        })],
      });
      return;
    }

    const remapMatchConfidence = buildImportMatchConfidence(remapTitle, remapCandidates);
    await updateSteamCollectionImportItem(item.itemId, {
      matchCandidateJson: JSON.stringify(remapCandidates),
      matchConfidence: remapMatchConfidence as SteamCollectionMatchConfidence | null | undefined,
      resultReason: null,
      errorText: null,
    });
    logSteamImportEvent("item_remapped", {
      userId: parsed.ownerId,
      importId: session.importId,
      itemId: item.itemId,
      steamAppId: item.steamAppId,
      candidateCount: remapCandidates.length,
    });

    await this.renderNextSteamImportItem(interaction, session.importId, parsed.ownerId);
  }

  @ModalComponent({
    id: /^collection-steam-game-id-v1:[^:]+:\d+:\d+$/,
  })
  async onSteamImportGameIdModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseCollectionSteamGameIdModalId(interaction.customId);
    if (!parsed) {
      await interaction.reply({
        content: "This GameDB ID form is invalid.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (interaction.user.id !== parsed.ownerId) {
      await interaction.reply({
        content: "This GameDB ID form is not for you.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const session = await getSteamCollectionImportById(parsed.importId);
    if (!session || session.userId !== parsed.ownerId || session.status !== "ACTIVE") {
      await interaction.reply({
        content: "This Steam import session is no longer active.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const item = await getNextPendingSteamCollectionImportItem(session.importId);
    if (!item || item.itemId !== parsed.itemId) {
      await safeUpdate(interaction, {
        content: "This import row is no longer pending.",
        components: [],
      });
      return;
    }

    const gameIdRaw = sanitizeUserInput(
      interaction.fields.getTextInputValue(STEAM_GAME_ID_INPUT_ID) ?? "",
      { preserveNewlines: false, maxLength: 20 },
    ).trim();
    const enteredId = Number(gameIdRaw);
    if (!Number.isInteger(enteredId) || enteredId <= 0) {
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

    await this.applySteamImportSelection({
      ownerId: parsed.ownerId,
      gameId: resolvedGameId,
      itemId: item.itemId,
      steamAppId: item.steamAppId,
      reason: "MANUAL_REMAP",
    });
    logSteamImportEvent("item_selected_by_game_id", {
      userId: parsed.ownerId,
      importId: session.importId,
      itemId: item.itemId,
      steamAppId: item.steamAppId,
      gameDbGameId: resolvedGameId,
      source: source ?? "unknown",
    });

    await this.renderNextSteamImportItem(interaction, session.importId, parsed.ownerId);
  }
}
