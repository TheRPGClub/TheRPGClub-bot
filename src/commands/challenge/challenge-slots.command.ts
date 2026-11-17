import {
  ApplicationCommandOptionType,
  MessageFlags,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type CommandInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import {
  ButtonComponent,
  Discord,
  SelectMenuComponent,
  Slash,
  SlashGroup,
  SlashOption,
} from "discordx";
import {
  safeDeferReply,
  safeDeferUpdate,
  safeEditReply,
  safeRespond,
  sanitizeUserInput,
} from "../../functions/InteractionUtils.js";
import { parseChallengeSlotsId } from "../../functions/ChallengeCustomIds.js";
import { CHALLENGE_SLOTS_PREFIX } from "../../config/customIdPrefixes.js";
import { CHALLENGE_API } from "../../services/ChallengeApi.js";
import { challengeTextView, type IChallengeView } from "../../services/ChallengeBrowse.js";
import {
  clearedGameChoices,
  fittingOpenYears,
  movePickerView,
  moveYearPickerView,
  pastPickReply,
  pastPlayChoices,
  pastPlayPickerView,
  pastPlayYearPickerView,
  slotMoveReply,
  slotsRunChoices,
  yearChoices,
  type ChallengeSlotResult,
} from "../../services/ChallengeSlotActions.js";
import { buildSlotsRunView } from "../../services/ChallengeSlotsShow.js";
import { buildApiErrorMessage } from "../../utilities/ApiErrorUtils.js";
import { logError } from "../../utilities/LogUtils.js";
import { challengeErrorReply, parseChallengeOption } from "./challenge-interaction.utils.js";
import { CHALLENGE_AUTOCOMPLETE_READ } from "../../config/challenges.js";

// /challenge slot-move and past-pick, and a Slots Run's components: its decade pages, the
// by-member select of Runs, and the Move a game and Pick past play steps (spec api#376,
// bot#1550). Every custom ID holds its Run (and game, Game Completion or decade), and the
// clicking member is who acts, so each works after a restart.

type SlotsInteraction = CommandInteraction | ButtonInteraction | StringSelectMenuInteraction;

const LOG_CONTEXT = "ChallengeSlotsCommand";

async function showResult(interaction: SlotsInteraction, result: ChallengeSlotResult):
  Promise<void> {
  await safeEditReply(
    interaction,
    "view" in result ? result.view : challengeErrorReply(result.error),
  );
}

async function showBuilt(
  interaction: SlotsInteraction,
  build: () => Promise<IChallengeView>,
): Promise<void> {
  try {
    await safeEditReply(interaction, await build());
  } catch (err: unknown) {
    logError(LOG_CONTEXT, err);
    await safeEditReply(
      interaction,
      challengeErrorReply(buildApiErrorMessage("Could not show the Run.", err)),
    );
  }
}

function focusedQuery(interaction: AutocompleteInteraction): string {
  const focused = interaction.options.getFocused(true);
  return sanitizeUserInput(String(focused?.value ?? ""), { preserveNewlines: false });
}

/** The ID an earlier option of the autocompleting command holds, or null. */
function optionId(interaction: AutocompleteInteraction, name: string): number | null {
  return parseChallengeOption(interaction.options.getString(name) ?? "");
}

async function respondSafely(
  interaction: AutocompleteInteraction,
  choices: () => Promise<{ name: string; value: string }[]>,
): Promise<void> {
  try {
    await safeRespond(interaction, await choices());
  } catch (err: unknown) {
    logError(`${LOG_CONTEXT}.autocomplete`, err);
    await safeRespond(interaction, []);
  }
}

async function autocompleteRun(interaction: AutocompleteInteraction): Promise<void> {
  await respondSafely(interaction, async () => {
    const page = await CHALLENGE_API.listMemberRuns(
      interaction.user.id,
      interaction.user.id,
      1,
      CHALLENGE_AUTOCOMPLETE_READ,
      "active",
    );
    return slotsRunChoices(page.items, focusedQuery(interaction));
  });
}

async function autocompleteClearedGame(interaction: AutocompleteInteraction): Promise<void> {
  await respondSafely(interaction, async () => {
    const runId = optionId(interaction, "run");
    const run = runId ? await CHALLENGE_API.getRun(runId, interaction.user.id) : null;
    return run ? clearedGameChoices(run, focusedQuery(interaction)) : [];
  });
}

async function autocompleteMoveYear(interaction: AutocompleteInteraction): Promise<void> {
  await respondSafely(interaction, async () => {
    const runId = optionId(interaction, "run");
    const gameId = optionId(interaction, "game");
    const run = runId ? await CHALLENGE_API.getRun(runId, interaction.user.id) : null;
    if (!run || !gameId) return [];
    const entry = (run.entries ?? []).find((e) => e.game_id === gameId);
    const years = fittingOpenYears(run, entry);
    return yearChoices(years, focusedQuery(interaction));
  });
}

async function autocompletePastPlay(interaction: AutocompleteInteraction): Promise<void> {
  await respondSafely(interaction, async () => {
    const runId = optionId(interaction, "run");
    if (!runId) return [];
    const plays = await CHALLENGE_API.pastPlay(
      runId,
      interaction.user.id,
      focusedQuery(interaction),
    );
    return pastPlayChoices(plays);
  });
}

async function autocompletePickYear(interaction: AutocompleteInteraction): Promise<void> {
  await respondSafely(interaction, async () => {
    const runId = optionId(interaction, "run");
    const completionId = optionId(interaction, "game");
    if (!runId || !completionId) return [];
    const plays = await CHALLENGE_API.pastPlay(runId, interaction.user.id);
    const play = plays.find((p) => p.completion_id === completionId);
    return play ? yearChoices(play.open_years, focusedQuery(interaction)) : [];
  });
}

/** The three numbers a slot-move or past-pick needs, or a reply saying which is missing. */
function readIds(runRaw: string, gameRaw: string, yearRaw: string):
  { runId: number; id: number; year: number } | string {
  const runId = parseChallengeOption(runRaw);
  const id = parseChallengeOption(gameRaw);
  const year = parseChallengeOption(yearRaw);
  if (!runId) return "Pick one of your Active Slots Runs from the list.";
  if (!id) return "Pick a game from the list.";
  if (!year) return "Pick a year from the list, or type it, such as 1995.";
  return { runId, id, year };
}

@Discord()
@SlashGroup("challenge")
export class ChallengeSlotsCommand {
  @Slash({ name: "slot-move", description: "Move a Cleared game to another year of your Run" })
  async slotMove(
    @SlashOption({
      name: "run",
      description: "Your Active Slots Run",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteRun,
    })
    runRaw: string,
    @SlashOption({
      name: "game",
      description: "A game Cleared on the Run",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteClearedGame,
    })
    gameRaw: string,
    @SlashOption({
      name: "year",
      description: "An open year the game came out in",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteMoveYear,
    })
    yearRaw: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const ids = readIds(runRaw, gameRaw, yearRaw);
    if (typeof ids === "string") {
      await safeEditReply(interaction, challengeTextView(ids));
      return;
    }
    await showResult(interaction, await slotMoveReply({
      runId: ids.runId,
      gameId: ids.id,
      year: ids.year,
      actingUserId: interaction.user.id,
    }));
  }

  @Slash({ name: "past-pick", description: "Pick an earlier Game Completion for an open year" })
  async pastPick(
    @SlashOption({
      name: "run",
      description: "Your Active Slots Run (its Challenge must count past play)",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteRun,
    })
    runRaw: string,
    @SlashOption({
      name: "game",
      description: "A Game Completion from before the Run that fits an open year",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompletePastPlay,
    })
    gameRaw: string,
    @SlashOption({
      name: "year",
      description: "The open year it fills",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompletePickYear,
    })
    yearRaw: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const ids = readIds(runRaw, gameRaw, yearRaw);
    if (typeof ids === "string") {
      await safeEditReply(interaction, challengeTextView(ids));
      return;
    }
    await showResult(interaction, await pastPickReply({
      runId: ids.runId,
      completionId: ids.id,
      year: ids.year,
      actingUserId: interaction.user.id,
    }));
  }

  @ButtonComponent({ id: new RegExp(`^${CHALLENGE_SLOTS_PREFIX}:(decade|move|pick):`) })
  async slotsButton(interaction: ButtonInteraction): Promise<void> {
    const target = parseChallengeSlotsId(interaction.customId);
    // A decade page from a post, and the Move and Pick steps, are private replies of
    // their own, so the message they came from stays as it was.
    const fresh = target?.action !== "decade" || target.reply === "new";
    if (fresh) {
      await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    } else if (!(await safeDeferUpdate(interaction))) {
      return;
    }
    if (!target) {
      await safeEditReply(interaction, challengeTextView("This button is out of date."));
      return;
    }
    const actingUserId = interaction.user.id;
    const [runId = 0, decade] = target.ids;
    switch (target.action) {
      case "move":
        await showResult(interaction, await movePickerView({ runId, actingUserId }));
        return;
      case "pick":
        await showResult(interaction, await pastPlayPickerView({ runId, actingUserId }));
        return;
      default:
        await showBuilt(interaction, () => buildSlotsRunView({ runId, decade, actingUserId }));
    }
  }

  @SelectMenuComponent({
    id: new RegExp(
      `^${CHALLENGE_SLOTS_PREFIX}:(decades|runs|move-game|pick-play|move-year|pick-year):`,
    ),
  })
  async slotsSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    if (!(await safeDeferUpdate(interaction))) return;
    const target = parseChallengeSlotsId(interaction.customId);
    const picked = parseChallengeOption(interaction.values[0] ?? "");
    if (!target || !picked) {
      await safeEditReply(interaction, challengeTextView("This menu is out of date."));
      return;
    }
    const actingUserId = interaction.user.id;
    const [first = 0, second = 0] = target.ids;
    switch (target.action) {
      case "decades":
        await showBuilt(
          interaction,
          () => buildSlotsRunView({ runId: first, decade: picked, actingUserId }),
        );
        return;
      case "runs":
        await showBuilt(interaction, () => buildSlotsRunView({ runId: picked, actingUserId }));
        return;
      case "move-game":
        await showResult(
          interaction,
          await moveYearPickerView({ runId: first, gameId: picked, actingUserId }),
        );
        return;
      case "pick-play":
        await showResult(
          interaction,
          await pastPlayYearPickerView({ runId: first, completionId: picked, actingUserId }),
        );
        return;
      case "move-year":
        await showResult(interaction, await slotMoveReply({
          runId: first,
          gameId: second,
          year: picked,
          actingUserId,
        }));
        return;
      case "pick-year":
        await showResult(interaction, await pastPickReply({
          runId: first,
          completionId: second,
          year: picked,
          actingUserId,
        }));
        return;
      default:
        await safeEditReply(interaction, challengeTextView("This menu is out of date."));
    }
  }
}
