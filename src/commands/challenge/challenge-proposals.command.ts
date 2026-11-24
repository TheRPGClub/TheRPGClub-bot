import {
  ApplicationCommandOptionType,
  MessageFlags,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type CommandInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import {
  ButtonComponent,
  Discord,
  ModalComponent,
  SelectMenuComponent,
  Slash,
  SlashGroup,
  SlashOption,
} from "discordx";
import {
  safeDeferModalSubmit,
  safeDeferReply,
  safeDeferUpdate,
  safeEditReply,
  safeFollowUpIfSettled,
  type AnyRepliable,
} from "../../functions/InteractionUtils.js";
import {
  parseChallengeProposalId,
  type IChallengeProposalTarget,
} from "../../functions/ChallengeCustomIds.js";
import { CHALLENGE_PROPOSAL_PREFIX } from "../../config/customIdPrefixes.js";
import { parsePositiveId } from "../../functions/CustomIdUtils.js";
import { challengeTextView, type IChallengeView } from "../../services/ChallengeBrowse.js";
import {
  addAcceptedToList,
  buildProposalsView,
  buildProposeNoteModal,
  buildProposePickView,
  buildProposeSearchModal,
  decideProposal,
  PROPOSAL_FIELDS,
  PROPOSAL_NOTE_MAX,
  proposeReply,
  resolveListNotice,
  type IProposalResult,
} from "../../services/ChallengeProposals.js";
import { buildShowView } from "../../services/ChallengeSlotsShow.js";
import { buildApiErrorMessage } from "../../utilities/ApiErrorUtils.js";
import { safeIgnore } from "../../utilities/AsyncUtils.js";
import { logError } from "../../utilities/LogUtils.js";
import { autocompleteGameDbViewTitle } from "../gamedb/gamedb-utils.js";
import {
  autocompletePoolChallenge,
  challengeErrorReply,
  parseChallengeOption,
  readModalFields,
  searchIncludeGames,
} from "./challenge-interaction.utils.js";

// /challenge propose and /challenge proposals (spec api#442, bot#1569), with the Pool's
// Propose a game button and list notices on /challenge show. Every component's custom ID
// holds the Challenge, the proposal or game, and the place shown, and each click reads the
// Challenge again for whoever clicks, so it all works after a restart.

const LOG_CONTEXT = "ChallengeProposalsCommand";
const OUT_OF_DATE = "This button is out of date.";

/** `challenge:` and `game:` share /challenge propose; each gets its own choices. */
async function autocompletePropose(interaction: AutocompleteInteraction): Promise<void> {
  if (interaction.options.getFocused(true).name === "game") {
    await autocompleteGameDbViewTitle(interaction);
    return;
  }
  await autocompletePoolChallenge(interaction);
}

/** Puts a built view in the acked reply, or the API error behind it. */
async function showBuilt(
  interaction: AnyRepliable,
  build: () => Promise<IChallengeView>,
  failure: string,
): Promise<void> {
  try {
    await safeEditReply(interaction, await build());
  } catch (err: unknown) {
    logError(LOG_CONTEXT, err);
    await safeFollowUpIfSettled(
      interaction,
      challengeErrorReply(buildApiErrorMessage(failure, err), true),
    );
  }
}

/** Shows an action's result: its view in place, and its refusal as a private message. */
async function showResult(
  interaction: AnyRepliable,
  build: () => Promise<IProposalResult>,
  failure: string,
): Promise<void> {
  try {
    const result = await build();
    await safeEditReply(interaction, result.view);
    if (result.error) {
      await safeFollowUpIfSettled(interaction, challengeErrorReply(result.error, true));
    }
  } catch (err: unknown) {
    logError(LOG_CONTEXT, err);
    await safeFollowUpIfSettled(
      interaction,
      challengeErrorReply(buildApiErrorMessage(failure, err), true),
    );
  }
}

function targetOf(customId: string): IChallengeProposalTarget | null {
  return parseChallengeProposalId(customId);
}

@Discord()
@SlashGroup("challenge")
export class ChallengeProposalsCommand {
  @Slash({ name: "propose", description: "Propose a game for a Pool Challenge" })
  async propose(
    @SlashOption({
      name: "challenge",
      description: "The Pool Challenge",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompletePropose,
    })
    challengeRaw: string,
    @SlashOption({
      name: "game",
      description: "The game to propose",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompletePropose,
    })
    gameRaw: string,
    @SlashOption({
      name: "note",
      description: "Why it belongs in the Pool, for whoever decides",
      type: ApplicationCommandOptionType.String,
      required: false,
      maxLength: PROPOSAL_NOTE_MAX,
    })
    note: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const challengeId = parseChallengeOption(challengeRaw);
    const gameId = parsePositiveId(gameRaw);
    if (!challengeId || !gameId) {
      await safeEditReply(interaction, challengeTextView(challengeId
        ? "Pick a game from the list."
        : "Pick a Challenge from the list."));
      return;
    }
    await showResult(
      interaction,
      () => proposeReply({
        challengeId,
        gameId,
        note: note ?? null,
        actingUserId: interaction.user.id,
      }),
      "Could not send the proposal.",
    );
  }

  @Slash({
    name: "proposals",
    description: "Decide a Pool Challenge's proposals (or see your own)",
  })
  async proposals(
    @SlashOption({
      name: "challenge",
      description: "The Pool Challenge",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompletePoolChallenge,
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
    await showBuilt(
      interaction,
      () => buildProposalsView({ challengeId, position: 1, actingUserId: interaction.user.id }),
      "Could not read the Pool Proposals.",
    );
  }

  @ButtonComponent({ id: new RegExp(`^${CHALLENGE_PROPOSAL_PREFIX}:`) })
  async button(interaction: ButtonInteraction): Promise<void> {
    const target = targetOf(interaction.customId);
    if (target?.action === "propose") {
      // Opens at once: the modal needs nothing but the Challenge ID.
      safeIgnore(interaction.showModal(buildProposeSearchModal(target.ids[0]!)));
      return;
    }
    if (target?.action === "view" && target.reply === "new") {
      // From a DM: a private reply of its own.
      await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    } else if (!(await safeDeferUpdate(interaction))) {
      return;
    }
    if (!target) {
      await safeEditReply(interaction, challengeTextView(OUT_OF_DATE));
      return;
    }
    await this.runButton(interaction, target);
  }

  private async runButton(
    interaction: ButtonInteraction,
    target: IChallengeProposalTarget,
  ): Promise<void> {
    const actingUserId = interaction.user.id;
    const [challengeId, second, third] = target.ids as [number, number, number?];
    switch (target.action) {
      case "view":
        await showBuilt(
          interaction,
          () => buildProposalsView({ challengeId, position: second, actingUserId }),
          "Could not read the Pool Proposals.",
        );
        return;
      case "core":
      case "optional":
      case "decline":
        await showResult(
          interaction,
          () => decideProposal({
            challengeId,
            proposalId: second,
            decision: target.action as "core" | "optional" | "decline",
            position: third ?? 1,
            actingUserId,
          }),
          "Could not decide the proposal.",
        );
        return;
      case "list-add":
        await showResult(
          interaction,
          () => addAcceptedToList({
            challengeId,
            gameId: second,
            position: third ?? 1,
            actingUserId,
          }),
          "Could not add the game to the list.",
        );
        return;
      case "list-skip":
        await showBuilt(
          interaction,
          () => buildProposalsView({
            challengeId,
            position: second,
            actingUserId,
            notice: ["Kept the list as it is."],
          }),
          "Could not read the Pool Proposals.",
        );
        return;
      case "notice-remove":
      case "notice-keep":
        await this.resolveNotice(interaction, challengeId, second, target.action);
        return;
      default:
        await safeEditReply(interaction, challengeTextView(OUT_OF_DATE));
    }
  }

  /** Clears a list notice, then shows the Challenge again (its notices read anew). */
  private async resolveNotice(
    interaction: ButtonInteraction,
    challengeId: number,
    noticeId: number,
    action: "notice-remove" | "notice-keep",
  ): Promise<void> {
    const actingUserId = interaction.user.id;
    const result = await resolveListNotice({
      challengeId,
      noticeId,
      resolution: action === "notice-remove" ? "remove" : "keep",
      actingUserId,
    });
    await showBuilt(
      interaction,
      () => buildShowView({ challengeId, view: "game", page: 1, actingUserId }),
      "Could not show the Challenge.",
    );
    await safeFollowUpIfSettled(interaction, "error" in result
      ? challengeErrorReply(result.error, true)
      : { ...challengeTextView(result.notice), flags: MessageFlags.IsComponentsV2 |
        MessageFlags.Ephemeral });
  }

  @SelectMenuComponent({ id: new RegExp(`^${CHALLENGE_PROPOSAL_PREFIX}:pick:`) })
  async pick(interaction: StringSelectMenuInteraction): Promise<void> {
    const target = targetOf(interaction.customId);
    const gameId = parsePositiveId(interaction.values[0] ?? "");
    const option = interaction.component.options.find((o) => o.value === interaction.values[0]);
    if (!target || !gameId || !option) {
      if (await safeDeferUpdate(interaction)) {
        await safeEditReply(interaction, challengeTextView(OUT_OF_DATE));
      }
      return;
    }
    safeIgnore(interaction.showModal(
      buildProposeNoteModal(target.ids[0]!, gameId, option.label),
    ));
  }

  @ModalComponent({ id: new RegExp(`^${CHALLENGE_PROPOSAL_PREFIX}:search-modal:`) })
  async searchModal(interaction: ModalSubmitInteraction): Promise<void> {
    // A reply of its own, so the Challenge view it came from stays.
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const target = targetOf(interaction.customId);
    if (!target) {
      await safeEditReply(interaction, challengeTextView(OUT_OF_DATE));
      return;
    }
    const query = readModalFields(interaction)[PROPOSAL_FIELDS.query] ?? "";
    await showBuilt(
      interaction,
      async () => buildProposePickView(
        target.ids[0]!,
        query,
        query.trim() ? await searchIncludeGames(query.trim()) : [],
      ),
      "Could not search the GameDB.",
    );
  }

  @ModalComponent({ id: new RegExp(`^${CHALLENGE_PROPOSAL_PREFIX}:note-modal:`) })
  async noteModal(interaction: ModalSubmitInteraction): Promise<void> {
    if (!(await safeDeferModalSubmit(interaction))) return;
    const target = targetOf(interaction.customId);
    if (!target) {
      await safeEditReply(interaction, challengeTextView(OUT_OF_DATE));
      return;
    }
    const note = readModalFields(interaction)[PROPOSAL_FIELDS.note] ?? null;
    await showResult(
      interaction,
      () => proposeReply({
        challengeId: target.ids[0]!,
        gameId: target.ids[1]!,
        note,
        actingUserId: interaction.user.id,
      }),
      "Could not send the proposal.",
    );
  }
}
