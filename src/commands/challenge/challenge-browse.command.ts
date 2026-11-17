import {
  ApplicationCommandOptionType,
  MessageFlags,
  type ButtonInteraction,
  type CommandInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import {
  ButtonComponent,
  Discord,
  SelectMenuComponent,
  Slash,
  SlashChoice,
  SlashGroup,
  SlashOption,
} from "discordx";
import {
  safeDeferReply,
  safeDeferUpdate,
  safeEditReply,
} from "../../functions/InteractionUtils.js";
import {
  parseChallengeListId,
  parseChallengeShowId,
  type ChallengeListFilter,
  type ChallengeShowView,
} from "../../functions/ChallengeCustomIds.js";
import {
  CHALLENGE_LIST_PREFIX,
  CHALLENGE_SHOW_PREFIX,
} from "../../config/customIdPrefixes.js";
import {
  buildChallengeListView,
  buildChallengeShowView,
  CHALLENGE_LIST_SHOW_ID,
  challengeTextView,
  type IChallengeView,
} from "../../services/ChallengeBrowse.js";
import { buildApiErrorMessage } from "../../utilities/ApiErrorUtils.js";
import { logError } from "../../utilities/LogUtils.js";
import {
  autocompleteChallenge,
  challengeErrorReply,
  parseChallengeOption,
} from "./challenge-interaction.utils.js";

// /challenge list and /challenge show, and their buttons and select (spec api#376).

type BrowseInteraction =
  | CommandInteraction
  | ButtonInteraction
  | StringSelectMenuInteraction;

/** Builds a view and puts it in the acked reply, or the API error with its request. */
async function showBuilt(
  interaction: BrowseInteraction,
  build: () => Promise<IChallengeView>,
  failure: string,
): Promise<void> {
  try {
    await safeEditReply(interaction, await build());
  } catch (err: unknown) {
    logError("ChallengeBrowse", err);
    await safeEditReply(interaction, challengeErrorReply(buildApiErrorMessage(failure, err)));
  }
}

@Discord()
@SlashGroup("challenge")
export class ChallengeBrowseCommand {
  @Slash({ name: "list", description: "List the club's Challenges" })
  async list(
    @SlashChoice(
      { name: "Every Challenge", value: "all" },
      { name: "Open now", value: "open" },
      { name: "Closed now", value: "closed" },
    )
    @SlashOption({
      name: "show",
      description: "Which Challenges to list (every Challenge by default)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    filter: ChallengeListFilter | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    await showBuilt(
      interaction,
      () => buildChallengeListView({
        actingUserId: interaction.user.id,
        filter: filter ?? "all",
        page: 1,
      }),
      "Could not list the Challenges.",
    );
  }

  @Slash({ name: "show", description: "Show a Challenge, its Pool and its Runs" })
  async show(
    @SlashOption({
      name: "challenge",
      description: "The Challenge",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteChallenge,
    })
    challengeRaw: string,
    @SlashChoice(
      { name: "By game", value: "game" },
      { name: "By member", value: "member" },
    )
    @SlashOption({
      name: "view",
      description: "Who Cleared each game, or each member's Run (by game by default)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    view: ChallengeShowView | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const challengeId = parseChallengeOption(challengeRaw);
    if (!challengeId) {
      await safeEditReply(interaction, challengeTextView("Pick a Challenge from the list."));
      return;
    }
    await showBuilt(
      interaction,
      () => buildChallengeShowView({
        challengeId,
        view: view ?? "game",
        page: 1,
        actingUserId: interaction.user.id,
      }),
      "Could not show the Challenge.",
    );
  }

  @ButtonComponent({ id: new RegExp(`^${CHALLENGE_SHOW_PREFIX}:`) })
  async showPage(interaction: ButtonInteraction): Promise<void> {
    const target = parseChallengeShowId(interaction.customId);
    if (target?.reply === "new") {
      // From a #challenges post: a private reply of its own.
      await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    } else if (!(await safeDeferUpdate(interaction))) {
      return;
    }
    if (!target) {
      await safeEditReply(interaction, challengeTextView("This button is out of date."));
      return;
    }
    await showBuilt(
      interaction,
      () => buildChallengeShowView({ ...target, actingUserId: interaction.user.id }),
      "Could not show the Challenge.",
    );
  }

  @ButtonComponent({ id: new RegExp(`^${CHALLENGE_LIST_PREFIX}:(open|closed|all):`) })
  async listPage(interaction: ButtonInteraction): Promise<void> {
    if (!(await safeDeferUpdate(interaction))) return;
    const target = parseChallengeListId(interaction.customId);
    if (!target) {
      await safeEditReply(interaction, challengeTextView("This button is out of date."));
      return;
    }
    await showBuilt(
      interaction,
      () => buildChallengeListView({ actingUserId: interaction.user.id, ...target }),
      "Could not list the Challenges.",
    );
  }

  @SelectMenuComponent({ id: CHALLENGE_LIST_SHOW_ID })
  async listShow(interaction: StringSelectMenuInteraction): Promise<void> {
    if (!(await safeDeferUpdate(interaction))) return;
    const challengeId = parseChallengeOption(interaction.values[0] ?? "");
    if (!challengeId) {
      await safeEditReply(interaction, challengeTextView("Pick a Challenge from the list."));
      return;
    }
    await showBuilt(
      interaction,
      () => buildChallengeShowView({
        challengeId,
        view: "game",
        page: 1,
        actingUserId: interaction.user.id,
      }),
      "Could not show the Challenge.",
    );
  }
}
