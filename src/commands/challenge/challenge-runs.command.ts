import {
  ApplicationCommandOptionType,
  MessageFlags,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type CommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import {
  ButtonComponent,
  Discord,
  ModalComponent,
  Slash,
  SlashGroup,
  SlashOption,
} from "discordx";
import {
  safeDeferModalSubmit,
  safeDeferReply,
  safeDeferUpdate,
  safeEditReply,
  safeRespond,
  sanitizeUserInput,
} from "../../functions/InteractionUtils.js";
import { parseChallengeRunId } from "../../functions/ChallengeCustomIds.js";
import { CHALLENGE_RUN_PREFIX } from "../../config/customIdPrefixes.js";
import { CHALLENGE_API } from "../../services/ChallengeApi.js";
import { challengeTextView } from "../../services/ChallengeBrowse.js";
import { buildMyRunsView } from "../../services/ChallengeMyRuns.js";
import { safeIgnore } from "../../utilities/AsyncUtils.js";
import {
  abandonRunReply,
  BIRTH_DATE_FIELD,
  birthDateStartReply,
  buildBirthDateModal,
  confirmRunChange,
  deleteRunReply,
  runChoices,
  startRunReply,
  type ChallengeRunResult,
} from "../../services/ChallengeRuns.js";
import { buildApiErrorMessage } from "../../utilities/ApiErrorUtils.js";
import { logError } from "../../utilities/LogUtils.js";
import {
  autocompleteChallenge,
  challengeErrorReply,
  parseChallengeOption,
} from "./challenge-interaction.utils.js";

// /challenge start, abandon, delete-run and my-runs, and the Run buttons: Start a Run on a
// #challenges post, and the abandon and delete confirmations (spec api#376, bot#1547).
// Every custom ID holds its Challenge or Run ID, and the clicking member is who acts, so
// the buttons work after a restart.

type RunInteraction = CommandInteraction | ButtonInteraction | ModalSubmitInteraction;

/** Runs read for the run: autocomplete, newest first. */
const AUTOCOMPLETE_READ = 100;

async function showResult(interaction: RunInteraction, result: ChallengeRunResult):
  Promise<void> {
  await safeEditReply(
    interaction,
    "view" in result ? result.view : challengeErrorReply(result.error),
  );
}

function autocompleteRuns(action: "abandon" | "delete") {
  return async (interaction: AutocompleteInteraction): Promise<void> => {
    const focused = interaction.options.getFocused(true);
    const query = sanitizeUserInput(String(focused?.value ?? ""), { preserveNewlines: false });
    try {
      const page = await CHALLENGE_API.listMemberRuns(
        interaction.user.id,
        interaction.user.id,
        1,
        AUTOCOMPLETE_READ,
      );
      await safeRespond(interaction, runChoices(page.items, action, query));
    } catch (err: unknown) {
      logError("ChallengeRunsCommand.autocomplete", err);
      await safeRespond(interaction, []);
    }
  };
}

@Discord()
@SlashGroup("challenge")
export class ChallengeRunsCommand {
  @Slash({ name: "start", description: "Start a Run of a Challenge" })
  async start(
    @SlashOption({
      name: "challenge",
      description: "The Challenge",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteChallenge,
    })
    challengeRaw: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const challengeId = parseChallengeOption(challengeRaw);
    if (!challengeId) {
      await safeEditReply(interaction, challengeTextView("Pick a Challenge from the list."));
      return;
    }
    await showResult(
      interaction,
      await startRunReply({ challengeId, actingUserId: interaction.user.id }),
    );
  }

  @Slash({ name: "abandon", description: "Abandon one of your Active Runs" })
  async abandon(
    @SlashOption({
      name: "run",
      description: "Your Active Run",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteRuns("abandon"),
    })
    runRaw: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await this.confirm("abandon", runRaw, interaction);
  }

  @Slash({ name: "delete-run", description: "Delete one of your Runs that has ended" })
  async deleteRun(
    @SlashOption({
      name: "run",
      description: "Your Finished, Expired or Abandoned Run",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteRuns("delete"),
    })
    runRaw: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await this.confirm("delete", runRaw, interaction);
  }

  @Slash({ name: "my-runs", description: "What's next for your Runs" })
  async myRuns(
    @SlashOption({
      name: "past",
      description: "Show your Runs that have ended instead",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    past: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    try {
      await safeEditReply(
        interaction,
        await buildMyRunsView({ actingUserId: interaction.user.id, past: past ?? false }),
      );
    } catch (err: unknown) {
      logError("ChallengeRunsCommand.myRuns", err);
      await safeEditReply(
        interaction,
        challengeErrorReply(buildApiErrorMessage("Could not read your Runs.", err)),
      );
    }
  }

  @ButtonComponent({ id: new RegExp(`^${CHALLENGE_RUN_PREFIX}:`) })
  async runButton(interaction: ButtonInteraction): Promise<void> {
    const target = parseChallengeRunId(interaction.customId);
    if (target?.action === "birth") {
      // A birth-year Run without a Birth Date: ask for it, then start (bot#1550).
      safeIgnore(interaction.showModal(buildBirthDateModal(target.id)));
      return;
    }
    if (target?.action === "start") {
      // From a #challenges post: a private reply of its own.
      await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
      await showResult(
        interaction,
        await startRunReply({ challengeId: target.id, actingUserId: interaction.user.id }),
      );
      return;
    }
    if (!(await safeDeferUpdate(interaction))) return;
    if (!target) {
      await safeEditReply(interaction, challengeTextView("This button is out of date."));
      return;
    }
    const input = { runId: target.id, actingUserId: interaction.user.id };
    switch (target.action) {
      case "abandon":
        await showResult(interaction, await abandonRunReply(input));
        return;
      case "delete":
        await showResult(interaction, await deleteRunReply(input));
        return;
      case "keep":
        await safeEditReply(interaction, challengeTextView("Kept the Run as it is."));
        return;
      default:
        await safeEditReply(interaction, challengeTextView("This button is out of date."));
    }
  }

  @ModalComponent({ id: new RegExp(`^${CHALLENGE_RUN_PREFIX}:birth-modal:`) })
  async birthDateModal(interaction: ModalSubmitInteraction): Promise<void> {
    if (!(await safeDeferModalSubmit(interaction))) return;
    const target = parseChallengeRunId(interaction.customId);
    if (target?.action !== "birth-modal") {
      await safeEditReply(interaction, challengeTextView("This form is out of date."));
      return;
    }
    const birthDate = sanitizeUserInput(
      interaction.fields.getTextInputValue(BIRTH_DATE_FIELD),
      { preserveNewlines: false },
    );
    await showResult(interaction, await birthDateStartReply({
      challengeId: target.id,
      birthDate,
      actingUserId: interaction.user.id,
    }));
  }

  private async confirm(
    action: "abandon" | "delete",
    runRaw: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const runId = parseChallengeOption(runRaw);
    if (!runId) {
      await safeEditReply(interaction, challengeTextView("Pick a Run from the list."));
      return;
    }
    await showResult(
      interaction,
      await confirmRunChange({ action, runId, actingUserId: interaction.user.id }),
    );
  }
}
