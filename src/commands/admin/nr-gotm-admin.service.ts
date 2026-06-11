import type { CommandInteraction } from "discord.js";
import { ButtonStyle } from "discord.js";
import { withErrorReply, safeReply } from "../../functions/InteractionUtils.js";
import { buildTextReply } from "../../functions/ComponentsV2Utils.js";
import NrGotm, {
  type INrGotmEntry,
  type INrGotmGame,
  updateNrGotmGameFieldInDatabase,
  type NrGotmDatabaseEditableField,
  insertNrGotmRoundInDatabase,
} from "../../classes/NrGotm.js";
import Game from "../../classes/Game.js";
import { getThreadsByGameId } from "../../classes/Thread.js";
import { buildNrGotmEntryEmbed } from "../../functions/GotmEntryEmbeds.js";
import {
  promptUserForInput,
  promptUserForChoice,
  buildNumberChoiceOptions,
  addCancelOption,
} from "./admin-prompt.utils.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";

export async function handleAddNrGotm(interaction: CommandInteraction): Promise<void> {
  const allEntries = await withErrorReply(
    interaction, async () => NrGotm.all(), "Error loading existing NR-GOTM data", false,
  );
  if (allEntries === undefined) return;

  const nextRound =
    allEntries.length > 0 ? Math.max(...allEntries.map((e) => e.round)) + 1 : 1;

  await safeReply(
    interaction,
    buildTextReply(`Preparing to create NR-GOTM round ${nextRound}.`, false),
  );

  const monthYearRaw = await promptUserForInput(
    interaction,
    `Enter the month/year label for NR-GOTM round ${nextRound} (for example: "March 2024"). Type \`cancel\` to abort.`,
  );
  if (monthYearRaw === null) {
    return;
  }
  const monthYear = monthYearRaw.trim();
  if (!monthYear) {
    await safeReply(
      interaction,
      buildTextReply("Month/year label cannot be empty. Creation cancelled.", false),
    );
    return;
  }

  const gameCountRaw = await promptUserForChoice(
    interaction,
    "How many games are in this NR-GOTM round?",
    addCancelOption(buildNumberChoiceOptions(1, 5)),
  );
  if (gameCountRaw === null) {
    return;
  }

  const gameCount = Number(gameCountRaw);
  if (!Number.isInteger(gameCount) || gameCount < 1 || gameCount > 5) {
    await safeReply(
      interaction,
      buildTextReply(`Invalid game count "${gameCountRaw}". Creation cancelled.`, false),
    );
    return;
  }

  const games: INrGotmGame[] = [];

  for (let i = 0; i < gameCount; i++) {
    const n = i + 1;

    const gamedbRaw = await promptUserForInput(
      interaction,
      `Enter the GameDB id for NR-GOTM game #${n} (use /gamedb add first if needed).`,
    );
    if (gamedbRaw === null) return;
    const gamedbId = Number(gamedbRaw.trim());
    if (!isPositiveInt(gamedbId)) {
      await safeReply(
        interaction,
        buildTextReply("Invalid GameDB id. Creation cancelled.", false),
      );
      return;
    }
    const gameMeta = await Game.getGameById(gamedbId);
    if (!gameMeta) {
      await safeReply(
        interaction,
        buildTextReply(`GameDB id ${gamedbId} not found. Use /gamedb add first.`, false),
      );
      return;
    }

    const threadId = (await getThreadsByGameId(gamedbId))[0] ?? null;

    games.push({
      title: gameMeta.title,
      threadId,
      redditUrl: null,
      gamedbGameId: gamedbId,
    });
  }

  await withErrorReply(interaction, async () => {
    const insertedIds = await insertNrGotmRoundInDatabase(nextRound, monthYear, games);
    const gamesWithIds = games.map((g, idx) => ({ ...g, id: insertedIds[idx] ?? null }));
    const newEntry = NrGotm.addRound(nextRound, monthYear, gamesWithIds);
    const embedAssets = await buildNrGotmEntryEmbed(
      newEntry,
      interaction.guildId ?? undefined,
      interaction.client as any,
    );

    const createReply = buildTextReply(`Created NR-GOTM round ${nextRound}.`, false);
    await safeReply(interaction, {
      ...createReply,
      components: [...createReply.components, embedAssets.container],
      files: embedAssets.files?.length ? embedAssets.files : undefined,
    });
  }, `Failed to create NR-GOTM round ${nextRound}`, false);
}

export async function handleEditNrGotm(
  interaction: CommandInteraction,
  round: number,
): Promise<void> {
  const roundNumber = Number(round);
  if (!Number.isFinite(roundNumber)) {
    await safeReply(interaction, buildTextReply("Invalid NR-GOTM round number.", false));
    return;
  }

  const entries = await withErrorReply(
    interaction, async () => NrGotm.getByRound(roundNumber), "Error loading NR-GOTM data", false,
  );
  if (entries === undefined) return;

  if (!entries.length) {
    await safeReply(
      interaction,
      buildTextReply(`No NR-GOTM entry found for round ${roundNumber}.`, false),
    );
    return;
  }

  const entry = entries[0];

  const embedAssets = await buildNrGotmEntryEmbed(
    entry,
    interaction.guildId ?? undefined,
    interaction.client as any,
  );

  const editReply = buildTextReply(`Editing NR-GOTM round ${roundNumber}.`, false);
  await safeReply(interaction, {
    ...editReply,
    components: [...editReply.components, embedAssets.container],
    files: embedAssets.files?.length ? embedAssets.files : undefined,
  });

  const totalGames = entry.gameOfTheMonth.length;
  let gameIndex = 0;

  if (totalGames > 1) {
    const gameAnswer = await promptUserForChoice(
      interaction,
      `Which game number (1-${totalGames}) do you want to edit?`,
      addCancelOption(buildNumberChoiceOptions(1, totalGames)),
    );
    if (gameAnswer === null) {
      return;
    }

    const idx = Number(gameAnswer);
    if (!Number.isInteger(idx) || idx < 1 || idx > totalGames) {
      await safeReply(
        interaction,
        buildTextReply(`Invalid game number "${gameAnswer}". Edit cancelled.`, false),
      );
      return;
    }
    gameIndex = idx - 1;
  }

  const fieldAnswerRaw = await promptUserForChoice(
    interaction,
    "Which field do you want to edit?",
    addCancelOption([
      { label: "GameDB", value: "gamedb", style: ButtonStyle.Primary },
      { label: "Reddit", value: "reddit" },
    ]),
  );
  if (fieldAnswerRaw === null) {
    return;
  }

  const fieldAnswer = fieldAnswerRaw.toLowerCase();
  let field: NrGotmDatabaseEditableField | null = null;
  let nullableField = false;

  if (fieldAnswer === "gamedb") {
    field = "gamedbGameId";
  } else if (fieldAnswer === "reddit") {
    field = "redditUrl";
    nullableField = true;
  } else {
    await safeReply(
      interaction,
      buildTextReply(`Unknown field "${fieldAnswerRaw}". Edit cancelled.`, false),
    );
    return;
  }

  const valuePrompt = nullableField
    ? `Enter the new value for ${fieldAnswer} (or type \`none\` / \`null\` to clear it).`
    : `Enter the new value for ${fieldAnswer} (GameDB id required).`;

  const valueAnswerRaw = await promptUserForInput(interaction, valuePrompt, 5 * 60_000);
  if (valueAnswerRaw === null) {
    return;
  }

  const valueTrimmed = valueAnswerRaw.trim();
  let newValue: string | number | null = valueTrimmed;

  if (nullableField && /^none|null$/i.test(valueTrimmed)) {
    newValue = null;
  } else if (field === "gamedbGameId") {
    const parsed = Number(valueTrimmed);
    if (!isPositiveInt(parsed)) {
      await safeReply(
        interaction,
        buildTextReply("Please provide a valid numeric GameDB id.", false),
      );
      return;
    }
    const game = await Game.getGameById(parsed);
    if (!game) {
      await safeReply(
        interaction,
        buildTextReply(
          `GameDB id ${parsed} was not found. Use /gamedb add first if needed.`,
          false,
        ),
      );
      return;
    }
    newValue = parsed;
  }

  await withErrorReply(interaction, async () => {
    await updateNrGotmGameFieldInDatabase({
      rowId: entry.gameOfTheMonth?.[gameIndex]?.id ?? null,
      round: roundNumber,
      gameIndex,
      field: field!,
      value: newValue,
    });

    let updatedEntry: INrGotmEntry | null = null;
    if (field === "gamedbGameId") {
      updatedEntry = NrGotm.updateGamedbIdByRound(roundNumber, newValue as number, gameIndex);
    } else if (field === "redditUrl") {
      updatedEntry = NrGotm.updateRedditUrlByRound(
        roundNumber, newValue as string | null, gameIndex);
    }

    const entryToShow = updatedEntry ?? entry;
    const updatedAssets = await buildNrGotmEntryEmbed(
      entryToShow,
      interaction.guildId ?? undefined,
      interaction.client as any,
    );

    const updatedReply = buildTextReply(
      `NR-GOTM round ${roundNumber} updated successfully.`, false,
    );
    await safeReply(interaction, {
      ...updatedReply,
      components: [...updatedReply.components, updatedAssets.container],
      files: updatedAssets.files?.length ? updatedAssets.files : undefined,
    });
  }, `Failed to update NR-GOTM round ${roundNumber}`, false);
}
