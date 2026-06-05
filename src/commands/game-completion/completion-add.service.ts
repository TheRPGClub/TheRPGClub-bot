import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type CommandInteraction,
  type StringSelectMenuInteraction,
  type ButtonInteraction,
  type Message,
} from "discord.js";
import axios from "axios";
import Game from "../../classes/Game.js";
import Member from "../../classes/Member.js";
import { saveCompletion } from "../../functions/CompletionHelpers.js";
import {
  extractErrorMessage,
  safeDeferUpdate,
  safeReply,
  safeUpdate,
} from "../../functions/InteractionUtils.js";
import { formatDiscordTimestamp, formatPlaytimeHours } from "../profile.command.js";
import { igdbService } from "../../services/IGDB/IgdbService.js";
import { createIgdbSession, type IgdbSelectOption } from "../../services/IGDB/IgdbSelectService.js";
import { resolveNowPlayingRemoval } from "./completion-helpers.js";
import { promptCompletionPlatformSelection } from "./completion-platform.service.js";
import { completionAddSessions, type CompletionAddContext } from "./completion.types.js";
import {
  buildComponentsV2Flags,
  buildTextContainer,
  buildTextReply,
} from "../../functions/ComponentsV2Utils.js";
import { COMPONENTS_V2_FLAG } from "../../config/flags.js";

/**
 * Creates a completion session and returns the session ID
 */
export function createCompletionSession(ctx: CompletionAddContext): string {
  const sessionId = `comp-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  completionAddSessions.set(sessionId, ctx);
  return sessionId;
}

/**
 * Prompts user to select from GameDB search results or import from IGDB
 */
export async function promptCompletionSelection(
  interaction: CommandInteraction,
  searchTerm: string,
  ctx: CompletionAddContext,
): Promise<void> {
  const localResults = await Game.searchGames(searchTerm);
  if (localResults.length) {
    const sessionId = createCompletionSession(ctx);
    const options = localResults.slice(0, 24).map((game) => ({
      label: game.title.slice(0, 100),
      value: String(game.id),
      description: `GameDB #${game.id}`,
    }));

    options.push({
      label: "Import another game from IGDB",
      value: "import-igdb",
      description: "Search IGDB and import a new GameDB entry",
    });

    const select = new StringSelectMenuBuilder()
      // eslint-disable-next-line local/custom-id-has-matching-handler
      .setCustomId(`completion-add-select:${sessionId}`)
      .setPlaceholder("Select a game to log completion")
      .addOptions(options);

    await safeReply(interaction, {
      components: [
        ...buildTextReply(`Select the game for "${searchTerm}".`, true).components,
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
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
    if (interaction.deferred || interaction.replied) {
      await safeReply(interaction, {
        components: loadingComponents,
        flags: COMPONENTS_V2_FLAG,
      });
    } else {
      await safeUpdate(interaction, {
        components: loadingComponents,
        flags: COMPONENTS_V2_FLAG,
      });
    }
  }

  const igdbSearch = await igdbService.searchGames(searchTerm);
  if (!igdbSearch.results.length) {
    const content = `No GameDB or IGDB matches found for "${searchTerm}" (len: ${searchTerm.length}).`;
    if (interaction.isMessageComponent()) {
      await safeReply(interaction, {
        components: [buildTextContainer(content)],
        flags: COMPONENTS_V2_FLAG,
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
      description: (game.summary || "No summary").slice(0, 95),
    };
  });

  const { components } = createIgdbSession(
    interaction.user.id,
    opts,
    async (sel, gameId) => {
      if (!sel.deferred && !sel.replied) {
        await safeDeferUpdate(sel);
      }
      await safeReply(sel, {
        components: [buildTextContainer("Importing game details from IGDB...")],
        flags: COMPONENTS_V2_FLAG,
      });

      const imported = await importGameFromIgdb(gameId);
      const referenceDate = ctx.completedAt ?? new Date();
      const recent = await Member.getRecentCompletionForGame(
        ctx.userId,
        imported.gameId,
        referenceDate,
      );
      if (recent) {
        const confirmed = await confirmDuplicateCompletion(
          sel,
          imported.title,
          recent,
        );
        if (!confirmed) {
          return;
        }
      }
      const removeFromNowPlaying = await resolveNowPlayingRemoval(
        sel,
        ctx.userId,
        imported.gameId,
        imported.title,
        ctx.completedAt,
        false,
      );
      if (ctx.selectedPlatformId != null) {
        await saveCompletion(
          sel,
          ctx.userId,
          imported.gameId,
          ctx.selectedPlatformId,
          ctx.completionType,
          ctx.completedAt,
          ctx.finalPlaytimeHours,
          ctx.note,
          imported.title,
          ctx.announce,
          false,
          removeFromNowPlaying,
        );
      } else {
        await promptCompletionPlatformSelection(sel, {
          userId: ctx.userId,
          gameId: imported.gameId,
          gameTitle: imported.title,
          completionType: ctx.completionType,
          completedAt: ctx.completedAt,
          finalPlaytimeHours: ctx.finalPlaytimeHours,
          note: ctx.note,
          announce: ctx.announce,
          removeFromNowPlaying,
        });
      }
    },
  );

  const content = `No GameDB match; select an IGDB result to import for "${searchTerm}".`;
  if (interaction.isMessageComponent()) {
    await safeReply(interaction, {
      components: [buildTextContainer("Found results on IGDB. Please see the new message below.")],
      flags: COMPONENTS_V2_FLAG,
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

  if (!interaction.deferred && !interaction.replied) {
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
      const igdbId = Number(value.split(":")[1]);
      if (!Number.isInteger(igdbId) || igdbId <= 0) {
        await safeReply(interaction, {
          components: [buildTextContainer("Invalid IGDB selection.")],
          flags: buildComponentsV2Flags(true),
          __forceFollowUp: true,
        });
        return false;
      }
      const imported = await importGameFromIgdb(igdbId);
      gameId = imported.gameId;
      gameTitle = imported.title;
    } else {
      const parsedId = Number(value);
      if (!Number.isInteger(parsedId) || parsedId <= 0) {
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
  } catch (err: any) {
    const msg = extractErrorMessage(err);
    await safeReply(interaction, {
      components: [buildTextContainer(`Failed to add completion: ${msg}`)],
      flags: buildComponentsV2Flags(true),
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
  const [, sessionId] = interaction.customId.split(":");
  const ctx = completionAddSessions.get(sessionId);

  if (!ctx) {
    await safeReply(interaction, buildTextReply("This completion prompt has expired.", true));
    return;
  }

  if (interaction.user.id !== ctx.userId) {
    await safeReply(interaction, buildTextReply("This completion prompt isn't for you.", true));
    return;
  }

  const value = interaction.values?.[0];
  if (!value) {
    await safeReply(interaction, buildTextReply("No selection received.", true));
    return;
  }

  await safeDeferUpdate(interaction);

  try {
    await processCompletionSelection(interaction, value, ctx);
  } finally {
    completionAddSessions.delete(sessionId);
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
      __forceFollowUp: interaction.deferred || interaction.replied,
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
  const existing = await Game.getGameByIgdbId(igdbId);
  if (existing) {
    return { gameId: existing.id, title: existing.title };
  }

  const details = await igdbService.getGameDetails(igdbId);
  if (!details) {
    throw new Error("Failed to load game details from IGDB.");
  }

  let imageData: Buffer | null = null;
  if (details.cover?.image_id) {
    try {
      const imageUrl =
        `https://images.igdb.com/igdb/image/upload/t_cover_big/${details.cover.image_id}.jpg`;
      const imageResponse = await axios.get(imageUrl, { responseType: "arraybuffer" });
      imageData = Buffer.from(imageResponse.data);
    } catch (err) {
      console.error("Failed to download cover image:", err);
    }
  }

  const newGame = await Game.createGame(
    details.name,
    details.summary ?? "",
    imageData,
    details.id,
    details.slug ?? null,
    details.total_rating ?? null,
    details.url ?? null,
    Game.getFeaturedVideoUrl(details),
  ).catch(async (err: any) => {
    const message = String(err?.message ?? "");
    if (!message.includes("ORA-00001")) {
      throw err;
    }

    const matches = await Game.searchGames(details.name);
    const exact = matches.find(
      (game) => game.title.toLowerCase() === details.name.toLowerCase(),
    );
    if (exact) {
      return { id: exact.id, title: exact.title } as any;
    }
    throw err;
  });
  await Game.saveFullGameMetadata(newGame.id, details);
  return { gameId: newGame.id, title: details.name };
}
