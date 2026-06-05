import {
  ApplicationCommandOptionType,
  Attachment,
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
import {
  ButtonComponent,
  Discord,
  ModalComponent,
  SelectMenuComponent,
  Slash,
  SlashChoice,
  SlashGroup,
  SlashOption,
} from "discordx";
import axios from "axios";
import {
  safeDeferReply,
  safeDeferUpdate,
  safeReply,
  safeUpdate,
  stripModalInput,
} from "../../functions/InteractionUtils.js";
import {
  normalizeCsvHeader,
  normalizeTitleKey,
  parseCsvDate,
  parseCsvLine,
  stripTitleDateSuffix,
} from "../../functions/CsvUtils.js";
import {
  countGameDbCsvImportItems,
  createGameDbCsvImportSession,
  getActiveGameDbCsvImportForUser,
  getGameDbCsvImportById,
  getGameDbCsvImportItemById,
  getNextGameDbCsvImportItem,
  insertGameDbCsvImportItems,
  setGameDbCsvImportStatus,
  updateGameDbCsvImportIndex,
  updateGameDbCsvImportItem,
  type IGameDbCsvImport,
} from "../../classes/GameDbCsvImport.js";
import {
  getGameDbCsvTitleMapByNorm,
  upsertGameDbCsvTitleMap,
} from "../../classes/GameDbCsvImportMapping.js";
import { igdbService, type IGDBGame } from "../../services/IGDB/IgdbService.js";
import Game from "../../classes/Game.js";
import {
  buildComponentsV2Flags,
  pushAutoAcceptedTitle,
  consumeAutoAcceptedSummary,
} from "./gamedb-utils.js";
import { buildTextReply } from "../../functions/ComponentsV2Utils.js";
import {
  buildCsvPromptComponents,
  buildCsvPromptContainer,
  buildCsvPromptContent,
  GAMEDB_CSV_RESULT_LIMIT,
  scoreCsvImportGames,
  shouldAutoAcceptFirstCsvMatch,
} from "./gamedb-csv-import.service.js";
import { processReleaseDates } from "./gamedb-add.command.js";

const GAMEDB_CSV_ACTIONS = ["start", "resume", "status", "pause", "cancel"] as const;
type GameDbCsvAction = (typeof GAMEDB_CSV_ACTIONS)[number];

const GAMEDB_CSV_MANUAL_PREFIX = "gamedb-csv-manual";
const GAMEDB_CSV_MANUAL_INPUT_ID = "gamedb-csv-manual-igdb-id";
const GAMEDB_CSV_QUERY_PREFIX = "gamedb-csv-query";
const GAMEDB_CSV_QUERY_INPUT_ID = "gamedb-csv-query-text";

type GameDbCsvParsedRow = {
  rowIndex: number;
  gameTitle: string;
  rawGameTitle: string | null;
  platformName: string | null;
  regionName: string | null;
  initialReleaseDate: Date | null;
};

function parseGameDbCsv(csvText: string): GameDbCsvParsedRow[] {
  const rows = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (!rows.length) return [];
  const header = parseCsvLine(rows[0]).map(normalizeCsvHeader);
  const nameIndex = header.indexOf("name");
  const platformIndex = header.indexOf("platform");
  const regionIndex = header.indexOf("region");
  const initialReleaseIndex = header.indexOf("initial release date");

  if (nameIndex < 0) return [];

  const dataRows = rows.slice(1);
  const items: GameDbCsvParsedRow[] = [];

  dataRows.forEach((line, idx) => {
    const fields = parseCsvLine(line);
    const titleRaw = fields[nameIndex] ?? "";
    const rawTitle = titleRaw.trim();
    const title = stripTitleDateSuffix(rawTitle).trim();
    if (!title) return;

    const platformName = platformIndex >= 0 ? fields[platformIndex]?.trim() : "";
    const regionName = regionIndex >= 0 ? fields[regionIndex]?.trim() : "";
    const initialRelease = initialReleaseIndex >= 0
      ? parseCsvDate(fields[initialReleaseIndex])
      : null;

    items.push({
      rowIndex: idx + 1,
      gameTitle: title,
      rawGameTitle: rawTitle || null,
      platformName: platformName || null,
      regionName: regionName || null,
      initialReleaseDate: initialRelease,
    });
  });

  return items;
}

async function fetchCsvText(url: string): Promise<string | null> {
  try {
    const response = await axios.get(url, { responseType: "arraybuffer" });
    return Buffer.from(response.data).toString("utf-8");
  } catch {
    return null;
  }
}

async function importGameFromCsv(igdbId: number): Promise<{ gameId: number; title: string }> {
  const details = await igdbService.getGameDetails(igdbId);
  if (!details) {
    throw new Error("Failed to fetch IGDB details for this game.");
  }

  const existing = await Game.getGameByIgdbId(igdbId);
  if (existing) {
    const igdbPlatformIds: number[] = (details.platforms ?? [])
      .map((platform) => platform.id)
      .filter((id) => Number.isInteger(id) && id > 0);
    await Game.addGamePlatformsByIgdbIds(existing.id, igdbPlatformIds);
    await processReleaseDates(existing.id, details.release_dates ?? []);

    if (!existing.imageData) {
      const coverRes = await igdbService.getGameDetails(igdbId);
      if (coverRes?.cover?.image_id) {
        try {
          const url = `https://images.igdb.com/igdb/image/upload/t_cover_big/${coverRes.cover.image_id}.jpg`;
          const imgRes = await axios.get(url, { responseType: "arraybuffer" });
          await Game.updateGameImage(existing.id, Buffer.from(imgRes.data));
        } catch { /* ignore */ }
      }
    }
    if (!existing.artData) {
      const artImageId = details.artworks?.[0]?.image_id;
      if (artImageId) {
        try {
          const url = `https://images.igdb.com/igdb/image/upload/t_thumb_2x/${artImageId}.jpg`;
          const imgRes = await axios.get(url, { responseType: "arraybuffer" });
          await Game.updateGameArt(existing.id, Buffer.from(imgRes.data));
        } catch { /* ignore */ }
      }
    }
    return { gameId: existing.id, title: existing.title };
  }

  const igdbUrl = details.url
    || (details.slug ? `https://www.igdb.com/games/${details.slug}` : null);

  const newGame = await Game.createGame(
    details.name,
    details.summary || null,
    null,
    details.id,
    details.slug,
    details.total_rating ?? null,
    igdbUrl,
    Game.getFeaturedVideoUrl(details),
    null,
  );

  await Game.saveFullGameMetadata(newGame.id, details);
  const igdbPlatformIds: number[] = (details.platforms ?? [])
    .map((platform) => platform.id)
    .filter((id) => Number.isInteger(id) && id > 0);
  await Game.addGamePlatformsByIgdbIds(newGame.id, igdbPlatformIds);
  await processReleaseDates(newGame.id, details.release_dates ?? []);

  return { gameId: newGame.id, title: newGame.title };
}

async function processNextGameDbCsvImportItem(
  interaction:
    | CommandInteraction
    | ButtonInteraction
    | StringSelectMenuInteraction
    | ModalSubmitInteraction,
  session: IGameDbCsvImport,
): Promise<void> {
  const current = await getGameDbCsvImportById(session.importId);
  if (!current || current.status !== "ACTIVE") {
    return;
  }

  const nextItem = await getNextGameDbCsvImportItem(session.importId);
  if (!nextItem) {
    await setGameDbCsvImportStatus(session.importId, "COMPLETED");
    await safeReply(interaction, {
      ...buildTextReply(`CSV import #${session.importId} completed.`, true),
      __forceFollowUp: true,
    });
    return;
  }

  await updateGameDbCsvImportIndex(session.importId, nextItem.rowIndex);

  const searchTitle = stripTitleDateSuffix(
    nextItem.rawGameTitle ?? nextItem.gameTitle,
  ).trim();
  if (!searchTitle) {
    await updateGameDbCsvImportItem(nextItem.itemId, {
      status: "ERROR",
      errorText: "Missing title for IGDB search.",
    });
    await safeReply(interaction, {
      ...buildTextReply("Missing title for IGDB search. Skipping.", true),
      __forceFollowUp: true,
    });
    await processNextGameDbCsvImportItem(interaction, session);
    return;
  }

  const normalizedTitle = normalizeTitleKey(searchTitle);
  if (normalizedTitle) {
    const mapping = await getGameDbCsvTitleMapByNorm(normalizedTitle);
    if (mapping?.status === "SKIPPED") {
      await updateGameDbCsvImportItem(nextItem.itemId, { status: "SKIPPED" });
      await processNextGameDbCsvImportItem(interaction, session);
      return;
    }
    if (mapping?.status === "MAPPED" && mapping.gameDbGameId) {
      const mappedGame = await Game.getGameById(mapping.gameDbGameId);
      if (!mappedGame) {
        await updateGameDbCsvImportItem(nextItem.itemId, {
          status: "ERROR",
          errorText: `Mapped GameDB id ${mapping.gameDbGameId} not found.`,
        });
        await safeReply(interaction, {
          ...buildTextReply(
            `Mapped GameDB #${mapping.gameDbGameId} not found. Skipping.`, true,
          ),
          __forceFollowUp: true,
        });
        await processNextGameDbCsvImportItem(interaction, session);
        return;
      }

      await updateGameDbCsvImportItem(nextItem.itemId, {
        status: "IMPORTED",
        gameDbGameId: mappedGame.id,
        errorText: null,
      });
      pushAutoAcceptedTitle(session.importId, mappedGame.title);
      await processNextGameDbCsvImportItem(interaction, session);
      return;
    }
  }

  let results: IGDBGame[] = [];
  try {
    const search = await igdbService.searchGames(searchTitle, 50);
    results = search.results ?? [];
  } catch (err: any) {
    await updateGameDbCsvImportItem(nextItem.itemId, {
      status: "ERROR",
      errorText: err?.message ?? "IGDB search failed.",
    });
    await safeReply(interaction, {
      ...buildTextReply(
        `IGDB search failed for "${nextItem.gameTitle}". Skipping.`, true,
      ),
      __forceFollowUp: true,
    });
    await processNextGameDbCsvImportItem(interaction, session);
    return;
  }

  const sortedGames = results.length
    ? await scoreCsvImportGames(nextItem, results)
    : [];
  const options = sortedGames.length
    ? sortedGames.slice(0, GAMEDB_CSV_RESULT_LIMIT).map((game) => {
      const year = game.first_release_date
        ? new Date(game.first_release_date * 1000).getFullYear()
        : "TBD";
      return {
        id: game.id,
        label: `${game.name} (${year})`,
        description: game.summary ? game.summary.slice(0, 95) : "No summary",
      };
    })
    : [];
  const bestMatch = sortedGames[0];
  const shouldAutoAccept = shouldAutoAcceptFirstCsvMatch(nextItem, bestMatch);
  if (shouldAutoAccept && bestMatch) {
    try {
      const result = await importGameFromCsv(bestMatch.id);
      await updateGameDbCsvImportItem(nextItem.itemId, {
        status: "IMPORTED",
        gameDbGameId: result.gameId,
        errorText: null,
      });
      await upsertGameDbCsvTitleMap({
        titleRaw: nextItem.rawGameTitle ?? nextItem.gameTitle,
        titleNorm: normalizeTitleKey(searchTitle),
        gameDbGameId: result.gameId,
        status: "MAPPED",
        createdBy: interaction.user.id,
      });
      pushAutoAcceptedTitle(session.importId, result.title);
    } catch (err: any) {
      await updateGameDbCsvImportItem(nextItem.itemId, {
        status: "ERROR",
        errorText: err?.message ?? "Import failed.",
      });
    }
    await processNextGameDbCsvImportItem(interaction, session);
    return;
  }
  const summary = consumeAutoAcceptedSummary(session.importId);
  const contentBase = buildCsvPromptContent(session, nextItem, options.length > 0);
  const content = summary ? `${summary}\n\n${contentBase}` : contentBase;
  const container = buildCsvPromptContainer(content);
  const components = buildCsvPromptComponents(
    interaction.user.id,
    session.importId,
    nextItem.itemId,
    options,
  );

  await safeReply(interaction, {
    components: [container, ...components],
    flags: buildComponentsV2Flags(true),
    __forceFollowUp: true,
  });
}

@Discord()
@SlashGroup("gamedb")
export class GameDbCsvImportCommand {
  private async requireGameDbCsvImportAccess(
    interaction: CommandInteraction,
  ): Promise<boolean> {
    const guild = interaction.guild;
    if (!guild) {
      await safeReply(interaction,
        buildTextReply("This command can only be used inside a server.", true));
      return false;
    }

    const isOwner = guild.ownerId === interaction.user.id;
    if (isOwner) {
      return true;
    }

    await safeReply(interaction,
      buildTextReply("Access denied. Command requires server owner.", true));
    return false;
  }

  @Slash({ description: "Import games from a Completionator CSV", name: "csv-import" })
  async csvImport(
    @SlashChoice(
      ...GAMEDB_CSV_ACTIONS.map((value) => ({
        name: value,
        value,
      })),
    )
    @SlashOption({
      description: "Action to perform",
      name: "action",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    action: GameDbCsvAction,
    @SlashOption({
      description: "Completionator CSV file (required for start)",
      name: "file",
      required: false,
      type: ApplicationCommandOptionType.Attachment,
    })
    file: Attachment | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const hasAccess = await this.requireGameDbCsvImportAccess(interaction);
    if (!hasAccess) return;

    const userId = interaction.user.id;

    if (action === "start") {
      if (!file?.url) {
        await safeReply(interaction, {
          content: "Please attach the Completionator CSV file.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const csvText = await fetchCsvText(file.url);
      if (!csvText) {
        await safeReply(interaction, {
          content: "Failed to download the CSV file.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const parsed = parseGameDbCsv(csvText);
      if (!parsed.length) {
        await safeReply(interaction, {
          content: "No rows found in the CSV file.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const session = await createGameDbCsvImportSession({
        userId,
        totalCount: parsed.length,
        sourceFilename: file.name ?? null,
      });
      await insertGameDbCsvImportItems(session.importId, parsed);

      await safeReply(interaction, {
        content:
          `CSV import #${session.importId} created with ${parsed.length} rows.` +
          " Starting review now.",
        flags: MessageFlags.Ephemeral,
      });

      await processNextGameDbCsvImportItem(interaction, session);
      return;
    }

    if (action === "status") {
      const session = await getActiveGameDbCsvImportForUser(userId);
      if (!session) {
        await safeReply(interaction, {
          content: "No active CSV import session found.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const stats = await countGameDbCsvImportItems(session.importId);
      const embed = new EmbedBuilder()
        .setTitle(`GameDB CSV Import #${session.importId}`)
        .setDescription(`Status: ${session.status}`)
        .addFields(
          { name: "Pending", value: String(stats.pending), inline: true },
          { name: "Imported", value: String(stats.imported), inline: true },
          { name: "Skipped", value: String(stats.skipped), inline: true },
          { name: "Errors", value: String(stats.error), inline: true },
        );

      await safeReply(interaction, {
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const session = await getActiveGameDbCsvImportForUser(userId);
    if (!session) {
      await safeReply(interaction, {
        content: "No active CSV import session found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action === "pause") {
      await setGameDbCsvImportStatus(session.importId, "PAUSED");
      await safeReply(interaction, {
        content: `CSV import #${session.importId} paused.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action === "cancel") {
      await setGameDbCsvImportStatus(session.importId, "CANCELED");
      await safeReply(interaction, {
        content: `CSV import #${session.importId} canceled.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await setGameDbCsvImportStatus(session.importId, "ACTIVE");
    await safeReply(interaction, {
      content: `Resuming CSV import #${session.importId}.`,
      flags: MessageFlags.Ephemeral,
    });
    await processNextGameDbCsvImportItem(interaction, session);
  }

  @SelectMenuComponent({ id: /^gamedb-csv-select:\d+:\d+:\d+$/ })
  async handleGameDbCsvSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, ownerId, importIdRaw, itemIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, {
          content: "This import prompt is not for you.",
          flags: MessageFlags.Ephemeral,
        });
      return;
    }

    const igdbIdRaw = interaction.values?.[0];
    const igdbId = Number(igdbIdRaw);
    if (!Number.isInteger(igdbId) || igdbId <= 0) {
      await safeReply(interaction, {
          content: "Invalid IGDB selection.",
          flags: MessageFlags.Ephemeral,
        });
      return;
    }

    const importId = Number(importIdRaw);
    const itemId = Number(itemIdRaw);
    if (!Number.isInteger(importId) || !Number.isInteger(itemId)) {
      await safeReply(interaction, {
          content: "Invalid import selection.",
          flags: MessageFlags.Ephemeral,
        });
      return;
    }

    await safeDeferUpdate(interaction);

    const session = await getGameDbCsvImportById(importId);
    if (!session || session.userId !== ownerId) {
      await safeReply(interaction, {
        content: "This import session no longer exists.",
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
      return;
    }

    if (session.status !== "ACTIVE") {
      await safeReply(interaction, {
        content: "This import session is not active.",
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
      return;
    }

    const item = await getGameDbCsvImportItemById(itemId);
    if (!item || item.importId !== session.importId || item.status !== "PENDING") {
      await safeReply(interaction, {
        content: "This import item is no longer pending.",
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
      return;
    }

    try {
      const result = await importGameFromCsv(igdbId);
      await updateGameDbCsvImportItem(itemId, {
        status: "IMPORTED",
        gameDbGameId: result.gameId,
        errorText: null,
      });
      await upsertGameDbCsvTitleMap({
        titleRaw: item.rawGameTitle ?? item.gameTitle,
        titleNorm: normalizeTitleKey(item.gameTitle),
        gameDbGameId: result.gameId,
        status: "MAPPED",
        createdBy: interaction.user.id,
      });
      await safeReply(interaction, {
        content: `Imported ${result.title} as GameDB #${result.gameId}.`,
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
    } catch (err: any) {
      await updateGameDbCsvImportItem(itemId, {
        status: "ERROR",
        errorText: err?.message ?? "Import failed.",
      });
      await safeReply(interaction, {
        content: `Failed to import "${item.gameTitle}". Skipping.`,
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
    }

    await processNextGameDbCsvImportItem(interaction, session);
  }

  @ButtonComponent({
    id: /^gamedb-csv-action:\d+:\d+:\d+:(manual|query|accept|skip|pause)$/,
  })
  async handleGameDbCsvAction(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, importIdRaw, itemIdRaw, action] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, {
          content: "This import prompt is not for you.",
          flags: MessageFlags.Ephemeral,
        });
      return;
    }

    const importId = Number(importIdRaw);
    const itemId = Number(itemIdRaw);
    if (!Number.isInteger(importId) || !Number.isInteger(itemId)) {
      await safeReply(interaction, {
          content: "Invalid import action.",
          flags: MessageFlags.Ephemeral,
        });
      return;
    }

    const session = await getGameDbCsvImportById(importId);
    if (!session || session.userId !== ownerId) {
      await safeReply(interaction, {
        content: "This import session no longer exists.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action === "manual") {
      const modal = new ModalBuilder()
        .setCustomId(`${GAMEDB_CSV_MANUAL_PREFIX}:${ownerId}:${importId}:${itemId}`)
        .setTitle("Manual IGDB Import");
      const input = new TextInputBuilder()
        .setCustomId(GAMEDB_CSV_MANUAL_INPUT_ID)
        .setLabel("IGDB game ID")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      const row = new ActionRowBuilder<TextInputBuilder>().addComponents(input);
      modal.addComponents(row);
      await interaction.showModal(modal);
      return;
    }

    if (action === "query") {
      const modal = new ModalBuilder()
        .setCustomId(`${GAMEDB_CSV_QUERY_PREFIX}:${ownerId}:${importId}:${itemId}`)
        .setTitle("Manual IGDB Search");
      const input = new TextInputBuilder()
        .setCustomId(GAMEDB_CSV_QUERY_INPUT_ID)
        .setLabel("Search query")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      const row = new ActionRowBuilder<TextInputBuilder>().addComponents(input);
      modal.addComponents(row);
      await interaction.showModal(modal);
      return;
    }

    if (action === "accept") {
      const acceptSession = await getGameDbCsvImportById(importId);
      if (!acceptSession || acceptSession.userId !== ownerId) {
        await safeReply(interaction, {
          content: "This import session no longer exists.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (acceptSession.status !== "ACTIVE") {
        await safeReply(interaction, {
          content: "This import session is not active.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const item = await getGameDbCsvImportItemById(itemId);
      if (!item || item.importId !== acceptSession.importId || item.status !== "PENDING") {
        await safeReply(interaction, {
          content: "This import item is no longer pending.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const searchTitle = stripTitleDateSuffix(
        item.rawGameTitle ?? item.gameTitle,
      ).trim();
      if (!searchTitle) {
        await safeReply(interaction, {
          content: "Missing title for IGDB search.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      let results: IGDBGame[] = [];
      try {
        const search = await igdbService.searchGames(searchTitle, 50);
        results = search.results ?? [];
      } catch (err: any) {
        await safeReply(interaction, {
          content: `IGDB search failed: ${err?.message ?? "Unknown error"}`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const sortedGames = results.length
        ? await scoreCsvImportGames(item, results)
        : [];
      const first = sortedGames[0];
      if (!first) {
        await safeReply(interaction, {
          content: "No IGDB matches found for this title.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await safeDeferUpdate(interaction);

      try {
        const result = await importGameFromCsv(first.id);
        await updateGameDbCsvImportItem(itemId, {
          status: "IMPORTED",
          gameDbGameId: result.gameId,
          errorText: null,
        });
        await safeReply(interaction, {
          content: `Imported ${result.title} as GameDB #${result.gameId}.`,
          flags: MessageFlags.Ephemeral,
          __forceFollowUp: true,
        });
      } catch (err: any) {
        await updateGameDbCsvImportItem(itemId, {
          status: "ERROR",
          errorText: err?.message ?? "Import failed.",
        });
        await safeReply(interaction, {
          content: `Failed to import "${item.gameTitle}". Skipping.`,
          flags: MessageFlags.Ephemeral,
          __forceFollowUp: true,
        });
      }

      await processNextGameDbCsvImportItem(interaction, acceptSession);
      return;
    }

    if (action === "pause") {
      await setGameDbCsvImportStatus(importId, "PAUSED");
      await safeUpdate(interaction, {
        content: `CSV import #${importId} paused.`,
        components: [],
      });
      return;
    }

    if (action === "skip") {
      const item = await getGameDbCsvImportItemById(itemId);
      if (!item || item.importId !== session.importId || item.status !== "PENDING") {
        await safeReply(interaction, {
          content: "This import item is no longer pending.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await updateGameDbCsvImportItem(itemId, { status: "SKIPPED" });
      await upsertGameDbCsvTitleMap({
        titleRaw: item.rawGameTitle ?? item.gameTitle,
        titleNorm: normalizeTitleKey(item.gameTitle),
        gameDbGameId: null,
        status: "SKIPPED",
        createdBy: interaction.user.id,
      });
      await safeUpdate(interaction, {
        content: `Skipped "${item.gameTitle}".`,
        components: [],
      });
      await processNextGameDbCsvImportItem(interaction, session);
    }
  }

  @ModalComponent({ id: /^gamedb-csv-manual:\d+:\d+:\d+$/ })
  async handleGameDbCsvManualModal(interaction: ModalSubmitInteraction): Promise<void> {
    const [, ownerId, importIdRaw, itemIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, {
          content: "This import prompt is not for you.",
          flags: MessageFlags.Ephemeral,
        });
      return;
    }

    const importId = Number(importIdRaw);
    const itemId = Number(itemIdRaw);
    if (!Number.isInteger(importId) || !Number.isInteger(itemId)) {
      await safeReply(interaction, {
          content: "Invalid import request.",
          flags: MessageFlags.Ephemeral,
        });
      return;
    }

    const raw = interaction.fields.getTextInputValue(GAMEDB_CSV_MANUAL_INPUT_ID);
    const cleaned = stripModalInput(raw);
    const igdbId = Number(cleaned);
    if (!Number.isInteger(igdbId) || igdbId <= 0) {
      await safeReply(interaction, {
          content: "Please provide a valid IGDB id.",
          flags: MessageFlags.Ephemeral,
        });
      return;
    }

    await safeDeferUpdate(interaction);

    const session = await getGameDbCsvImportById(importId);
    if (!session || session.userId !== ownerId) {
      await safeReply(interaction, {
        content: "This import session no longer exists.",
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
      return;
    }

    if (session.status !== "ACTIVE") {
      await safeReply(interaction, {
        content: "This import session is not active.",
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
      return;
    }

    const item = await getGameDbCsvImportItemById(itemId);
    if (!item || item.importId !== session.importId || item.status !== "PENDING") {
      await safeReply(interaction, {
        content: "This import item is no longer pending.",
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
      return;
    }

    try {
      const result = await importGameFromCsv(igdbId);
      await updateGameDbCsvImportItem(itemId, {
        status: "IMPORTED",
        gameDbGameId: result.gameId,
        errorText: null,
      });
      await upsertGameDbCsvTitleMap({
        titleRaw: item.rawGameTitle ?? item.gameTitle,
        titleNorm: normalizeTitleKey(item.gameTitle),
        gameDbGameId: result.gameId,
        status: "MAPPED",
        createdBy: interaction.user.id,
      });
      await safeReply(interaction, {
        content: `Imported ${result.title} as GameDB #${result.gameId}.`,
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
    } catch (err: any) {
      await updateGameDbCsvImportItem(itemId, {
        status: "ERROR",
        errorText: err?.message ?? "Import failed.",
      });
      await safeReply(interaction, {
        content: `Failed to import "${item.gameTitle}". Skipping.`,
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
    }

    await processNextGameDbCsvImportItem(interaction, session);
  }

  @ModalComponent({ id: /^gamedb-csv-query:\d+:\d+:\d+$/ })
  async handleGameDbCsvQueryModal(interaction: ModalSubmitInteraction): Promise<void> {
    const [, ownerId, importIdRaw, itemIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, {
          content: "This import prompt is not for you.",
          flags: MessageFlags.Ephemeral,
        });
      return;
    }

    const importId = Number(importIdRaw);
    const itemId = Number(itemIdRaw);
    if (!Number.isInteger(importId) || !Number.isInteger(itemId)) {
      await safeReply(interaction, {
          content: "Invalid import request.",
          flags: MessageFlags.Ephemeral,
        });
      return;
    }

    const raw = interaction.fields.getTextInputValue(GAMEDB_CSV_QUERY_INPUT_ID);
    const query = stripModalInput(raw).trim();
    if (!query) {
      await safeReply(interaction, {
          content: "Please provide a search query.",
          flags: MessageFlags.Ephemeral,
        });
      return;
    }

    await safeDeferUpdate(interaction);

    const session = await getGameDbCsvImportById(importId);
    if (!session || session.userId !== ownerId) {
      await safeReply(interaction, {
        content: "This import session no longer exists.",
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
      return;
    }

    if (session.status !== "ACTIVE") {
      await safeReply(interaction, {
        content: "This import session is not active.",
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
      return;
    }

    const item = await getGameDbCsvImportItemById(itemId);
    if (!item || item.importId !== session.importId || item.status !== "PENDING") {
      await safeReply(interaction, {
        content: "This import item is no longer pending.",
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
      return;
    }

    let results: IGDBGame[] = [];
    try {
      const search = await igdbService.searchGames(query, 50);
      results = search.results ?? [];
    } catch (err: any) {
      await safeReply(interaction, {
        content: `IGDB search failed: ${err?.message ?? "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
      return;
    }

    const sortedGames = results.length
      ? await scoreCsvImportGames(item, results)
      : [];
    const options = sortedGames.length
      ? sortedGames.slice(0, GAMEDB_CSV_RESULT_LIMIT).map((game) => {
        const year = game.first_release_date
          ? new Date(game.first_release_date * 1000).getFullYear()
          : "TBD";
        return {
          id: game.id,
          label: `${game.name} (${year})`,
          description: game.summary ? game.summary.slice(0, 95) : "No summary",
        };
      })
      : [];
    const content = buildCsvPromptContent(session, item, options.length > 0);
    const container = buildCsvPromptContainer(
      `${content}\n\nManual IGDB query: ${query}`,
    );
    const components = buildCsvPromptComponents(
      interaction.user.id,
      session.importId,
      item.itemId,
      options,
    );

    await safeReply(interaction, {
      components: [container, ...components],
      flags: buildComponentsV2Flags(true),
      __forceFollowUp: true,
    });
  }
}
