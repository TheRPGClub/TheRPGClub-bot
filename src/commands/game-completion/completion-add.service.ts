import {
  StringSelectMenuBuilder,
  ButtonStyle,
  ComponentType,
  type CommandInteraction,
  type StringSelectMenuInteraction,
  type ButtonInteraction,
  type Message,
} from "discord.js";
import Game from "../../classes/Game.js";
import Member from "../../classes/Member.js";
import { saveCompletion } from "../../functions/CompletionHelpers.js";
import {
  canSafeReply,
  isInteractionSettled,
  safeDeferUpdate,
  safeEditReply,
  safeReply,
  safeUpdate,
  replyIfNotOwner,
} from "../../functions/InteractionUtils.js";
import { formatDiscordTimestamp, formatPlaytimeHours } from "../../functions/DateFormatUtils.js";
import { igdbService } from "../../services/IGDB/IgdbService.js";
import {
  createResumableIgdbSession,
  registerIgdbSelectFlow,
  type IgdbSelectOption,
} from "../../services/IGDB/IgdbSelectService.js";
import {
  persistedSessionStore,
  persistSessionInBackground,
  removePersistedSession,
  type PersistedSessionLocation,
} from "../../services/PersistedInteractionSessionStore.js";
import {
  completionAddContextFromJson,
  completionAddContextToJson,
} from "./completion-add-context.codec.js";
import { resolveNowPlayingRemoval } from "./completion-helpers.js";
import { promptCompletionPlatformSelection } from "./completion-platform.service.js";
import { completionAddSessions, type CompletionAddContext } from "./completion.types.js";
import {
  buildComponentsV2EditFlags,
  buildComponentsV2Flags,
  buildErrorReply,
  buildTextContainer,
  buildTextReply,
} from "../../functions/ComponentsV2Utils.js";
import { buildApiErrorMessage } from "../../utilities/ApiErrorUtils.js";
import { logError } from "../../utilities/LogUtils.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";
import { truncateDescription } from "../../config/textLimits.js";
import {
  buildActionButton,
  buildButtonRow,
  buildSelectOptions,
  buildSelectRow,
} from "../../functions/uiComponents.js";
import { assertCustomIdSegments, parseCustomIdSegments } from "../../utilities/CustomIdUtils.js";
import GameSearchService from "../../classes/GameSearchService.js";

const IGDB_IMPORT_FAILED_STATUS = "Import failed. See the error below.";
const COMPLETION_ADD_PERSISTED_KIND = "completion-add";
const completionAddRowIds = new Map<string, Promise<string | null>>();

// Registered at module load so a pick after a bot restart finds the handler.
const completionAddIgdbFlow = registerIgdbSelectFlow<CompletionAddContext>({
  key: "completion-add",
  toJson: completionAddContextToJson,
  fromJson: completionAddContextFromJson,
  onSelect: async (sel, gameId, ctx) => {
    if (!sel.deferred && !sel.replied) {
      await safeDeferUpdate(sel);
    }
    await safeEditReply(sel, {
      components: [buildTextContainer("Importing game details from IGDB...")],
      flags: buildComponentsV2EditFlags(),
    });

    // Reuse the GameDB selection path so IGDB picks get the same error reporting.
    await processCompletionSelection(sel, `igdb:${gameId}`, ctx);
  },
});

function toSessionLocation(
  interaction: CommandInteraction | StringSelectMenuInteraction | ButtonInteraction,
): PersistedSessionLocation {
  return { channelId: interaction.channelId, guildId: interaction.guildId };
}

/**
 * Creates a completion session and returns the session ID. The context is also
 * persisted so the GameDB select still works after a bot restart.
 */
export function createCompletionSession(
  ctx: CompletionAddContext,
  location: PersistedSessionLocation,
): string {
  const sessionId = `comp-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  completionAddSessions.set(sessionId, ctx);
  completionAddRowIds.set(sessionId, persistSessionInBackground({
    kind: COMPLETION_ADD_PERSISTED_KIND,
    sessionId,
    ownerId: ctx.userId,
    location,
    state: completionAddContextToJson(ctx),
  }));
  return sessionId;
}

async function resolveCompletionAddSession(
  sessionId: string,
  interaction: StringSelectMenuInteraction,
): Promise<CompletionAddContext | null> {
  const cached = completionAddSessions.get(sessionId);
  if (cached) return cached;
  const record = await persistedSessionStore.load({
    kind: COMPLETION_ADD_PERSISTED_KIND,
    sessionId,
    ownerId: interaction.user.id,
    channelId: interaction.channelId,
  });
  if (!record) return null;
  const ctx = completionAddContextFromJson(record.state);
  if (!ctx) return null;
  completionAddSessions.set(sessionId, ctx);
  completionAddRowIds.set(sessionId, Promise.resolve(record.rowId));
  return ctx;
}

function finishCompletionAddSession(sessionId: string): void {
  completionAddSessions.delete(sessionId);
  void removePersistedSession(completionAddRowIds.get(sessionId));
  completionAddRowIds.delete(sessionId);
}

/**
 * Prompts user to select from GameDB search results or import from IGDB
 */
export async function promptCompletionSelection(
  interaction: CommandInteraction,
  searchTerm: string,
  ctx: CompletionAddContext,
): Promise<void> {
  const localResults = await GameSearchService.searchGames(searchTerm);
  if (localResults.length) {
    const sessionId = createCompletionSession(ctx, toSessionLocation(interaction));
    const gameOptions = localResults.map((game) => ({
      label: game.title,
      value: String(game.id),
      description: `GameDB #${game.id}`,
    }));
    gameOptions.push({
      label: "Import another game from IGDB",
      value: "import-igdb",
      description: "Search IGDB and import a new GameDB entry",
    });
    const options = buildSelectOptions(gameOptions);

    const select = new StringSelectMenuBuilder()
      // eslint-disable-next-line local/custom-id-has-matching-handler
      .setCustomId(`completion-add-select:${sessionId}`)
      .setPlaceholder("Select a game to log completion")
      .addOptions(options);

    await safeReply(interaction, {
      components: [
        ...buildTextReply(`Select the game for "${searchTerm}".`, true).components,
        buildSelectRow(select),
      ],
      flags: buildComponentsV2Flags(true),
    });
    return;
  }

  await promptIgdbSelection(interaction, searchTerm, ctx);
}

/**
 * Prompts user to select a game from IGDB search results
 */
export async function promptIgdbSelection(
  interaction: CommandInteraction | StringSelectMenuInteraction | ButtonInteraction,
  searchTerm: string,
  ctx: CompletionAddContext,
): Promise<void> {
  if (interaction.isMessageComponent()) {
    const loadingComponents = [buildTextContainer(`Searching IGDB for "${searchTerm}"...`)];
    if (isInteractionSettled(interaction)) {
      await safeReply(interaction, {
        components: loadingComponents,
        flags: buildComponentsV2EditFlags(),
      });
    } else {
      await safeUpdate(interaction, {
        components: loadingComponents,
        flags: buildComponentsV2EditFlags(),
      });
    }
  }

  const igdbSearch = await igdbService.searchGames(searchTerm);
  if (!igdbSearch.results.length) {
    const content = `No GameDB or IGDB matches found for "${searchTerm}" (len: ${searchTerm.length}).`;
    if (interaction.isMessageComponent()) {
      await safeReply(interaction, {
        components: [buildTextContainer(content)],
        flags: buildComponentsV2EditFlags(),
      });
    } else {
      await safeReply(interaction, buildTextReply(content, true));
    }
    return;
  }

  const opts: IgdbSelectOption[] = igdbSearch.results.map((game) => {
    const year = game.first_release_date
      ? new Date(game.first_release_date * 1000).getFullYear()
      : "TBD";
    return {
      id: game.id,
      label: `${game.name} (${year})`,
      description: truncateDescription((game.summary || "No summary")),
    };
  });

  const { components } = createResumableIgdbSession({
    ownerId: interaction.user.id,
    options: opts,
    flow: completionAddIgdbFlow,
    context: ctx,
    location: toSessionLocation(interaction),
  });

  const content = `No GameDB match; select an IGDB result to import for "${searchTerm}".`;
  if (interaction.isMessageComponent()) {
    await safeReply(interaction, {
      components: [buildTextContainer("Found results on IGDB. Please see the new message below.")],
      flags: buildComponentsV2EditFlags(),
    });
    await safeReply(interaction, {
      components: [buildTextContainer(content), ...components],
      flags: buildComponentsV2Flags(true),
      __forceFollowUp: true,
    });
  } else {
    await safeReply(interaction, {
      components: [...buildTextReply(content, true).components, ...components],
      flags: buildComponentsV2Flags(true),
    });
  }
}

/**
 * Processes the user's game selection from completion-add-select menu
 */
export async function processCompletionSelection(
  interaction: StringSelectMenuInteraction,
  value: string,
  ctx: CompletionAddContext,
): Promise<boolean> {
  if (value === "import-igdb") {
    if (!ctx.query) {
      await safeReply(interaction, buildTextReply("Original search query lost. Please try again.", true));
      return false;
    }
    await promptIgdbSelection(interaction, ctx.query, ctx);
    return true;
  }

  if (canSafeReply(interaction)) {
    try {
      await safeDeferUpdate(interaction);
    } catch {
      // ignore
    }
  }

  try {
    let gameId: number | null = null;
    let gameTitle: string | null = null;

    if (value.startsWith("igdb:")) {
      const segs = parseCustomIdSegments(value, 1);
      const igdbId = Number(segs?.[0]);
      if (!isPositiveInt(igdbId)) {
        await safeReply(interaction, {
          components: [buildTextContainer("Invalid IGDB selection.")],
          flags: buildComponentsV2Flags(true),
          __forceFollowUp: true,
        });
        return false;
      }
      let imported: { gameId: number; title: string };
      try {
        imported = await importGameFromIgdb(igdbId);
      } catch (err: unknown) {
        // Replace the "Importing..." status; the outer catch posts the ephemeral error.
        await safeEditReply(interaction, {
          components: [buildTextContainer(IGDB_IMPORT_FAILED_STATUS)],
          flags: buildComponentsV2EditFlags(),
        }).catch((editErr: unknown) => logError("CompletionAdd.importStatus", editErr));
        throw err;
      }
      gameId = imported.gameId;
      gameTitle = imported.title;
    } else {
      const parsedId = Number(value);
      if (!isPositiveInt(parsedId)) {
        await safeReply(interaction, {
          components: [buildTextContainer("Invalid selection.")],
          flags: buildComponentsV2Flags(true),
          __forceFollowUp: true,
        });
        return false;
      }
      const game = await Game.getGameById(parsedId);
      if (!game) {
        await safeReply(interaction, {
          components: [buildTextContainer("Selected game was not found in GameDB.")],
          flags: buildComponentsV2Flags(true),
          __forceFollowUp: true,
        });
        return false;
      }
      gameId = game.id;
      gameTitle = game.title;
    }

    if (!gameId) {
      await safeReply(interaction, {
        components: [buildTextContainer("Could not determine a game to log.")],
        flags: buildComponentsV2Flags(true),
        __forceFollowUp: true,
      });
      return false;
    }

    const referenceDate = ctx.completedAt ?? new Date();
    const recent = await Member.getRecentCompletionForGame(
      ctx.userId,
      gameId,
      referenceDate,
    );
    if (recent) {
      const confirmed = await confirmDuplicateCompletion(
        interaction,
        gameTitle ?? "this game",
        recent,
      );
      if (!confirmed) {
        return false;
      }
    }

    const removeFromNowPlaying = await resolveNowPlayingRemoval(
      interaction,
      ctx.userId,
      gameId,
      gameTitle ?? "this game",
      ctx.completedAt,
      false,
    );
    if (ctx.selectedPlatformId != null) {
      await saveCompletion(
        interaction,
        ctx.userId,
        gameId,
        ctx.selectedPlatformId,
        ctx.completionType,
        ctx.completedAt,
        ctx.finalPlaytimeHours,
        ctx.note,
        gameTitle ?? "this game",
        ctx.announce,
        false,
        removeFromNowPlaying,
      );
    } else {
      await promptCompletionPlatformSelection(interaction, {
        userId: ctx.userId,
        gameId,
        gameTitle: gameTitle ?? "this game",
        completionType: ctx.completionType,
        completedAt: ctx.completedAt,
        finalPlaytimeHours: ctx.finalPlaytimeHours,
        note: ctx.note,
        announce: ctx.announce,
        removeFromNowPlaying,
      });
    }
    return false;
  } catch (err: unknown) {
    logError("CompletionAdd.processCompletionSelection", err);
    await safeReply(interaction, {
      ...buildErrorReply(buildApiErrorMessage("Failed to add completion.", err), true),
      __forceFollowUp: true,
    });
    return false;
  }
}

/**
 * Handles the completion-add-select menu selection
 */
export async function handleCompletionAddSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const segs = assertCustomIdSegments(interaction, 1);
  if (!segs) return;
  const [sessionId] = segs;
  let ctx: CompletionAddContext | null;
  try {
    ctx = await resolveCompletionAddSession(sessionId, interaction);
  } catch (err: unknown) {
    logError("CompletionAdd.resolveCompletionAddSession", err);
    await safeReply(interaction, buildErrorReply(
      buildApiErrorMessage("Could not restore this completion prompt.", err),
      true,
    ));
    return;
  }

  if (!ctx) {
    await safeReply(interaction, buildTextReply("This completion prompt has expired.", true));
    return;
  }

  if (await replyIfNotOwner(interaction, ctx.userId, "This completion prompt isn't for you.")) return;

  const value = interaction.values?.[0];
  if (!value) {
    await safeReply(interaction, buildTextReply("No selection received.", true));
    return;
  }

  await safeDeferUpdate(interaction);

  try {
    await processCompletionSelection(interaction, value, ctx);
  } finally {
    finishCompletionAddSession(sessionId);
  }
}

/**
 * Confirms with user if they want to add a duplicate completion
 */
async function confirmDuplicateCompletion(
  interaction: CommandInteraction | StringSelectMenuInteraction | ButtonInteraction,
  gameTitle: string,
  existing: Awaited<ReturnType<typeof Member.getRecentCompletionForGame>>,
): Promise<boolean> {
  if (!existing) return true;

  const promptId = `comp-dup:${interaction.user.id}:${Date.now()}`;
  const yesId = `${promptId}:yes`;
  const noId = `${promptId}:no`;
  const dateText = existing.completedAt
    ? formatDiscordTimestamp(existing.completedAt)
    : "No date";
  const playtimeText = formatPlaytimeHours(existing.finalPlaytimeHours);
  const detailParts = [existing.completionType, dateText, playtimeText].filter(Boolean);
  const noteLine = existing.note ? `\n> ${existing.note}` : "";

  const row = buildButtonRow(
    buildActionButton({ customId: yesId, label: "Add Another", style: ButtonStyle.Danger }),
    buildActionButton("cancel", noId),
  );

  const promptText =
    `We found a completion for **${gameTitle}** within the last week:\n` +
    `- ${detailParts.join(" - ")} (Completion #${existing.completionId})${noteLine}\n\n` +
    "Add another completion anyway?";

  const payload = {
    components: [buildTextContainer(promptText), row],
    flags: buildComponentsV2Flags(true),
  };

  let message: Message | null = null;
  try {
    const reply = await safeReply(interaction, {
      ...payload,
      __forceFollowUp: isInteractionSettled(interaction),
    });
    message = (reply as any)?.resource?.message ?? (reply as Message) ?? null;
  } catch {
    try {
      const reply = await safeReply(interaction, { ...payload, __forceFollowUp: true });
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
    await safeUpdate(selection, {
      components: [buildTextContainer(
        confirmed ? "Adding another completion." : "Cancelled.",
      )],
      flags: buildComponentsV2Flags(false),
    });
    return confirmed;
  } catch {
    return false;
  }
}

/**
 * Imports a game from IGDB into GameDB
 */
export async function importGameFromIgdb(
  igdbId: number,
): Promise<{ gameId: number; title: string }> {
  const game = await Game.createGame(igdbId);
  return { gameId: game.id, title: game.title };
}
