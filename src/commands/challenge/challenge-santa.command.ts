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
  safeRespond,
  sanitizeUserInput,
} from "../../functions/InteractionUtils.js";
import {
  parseChallengeSantaId,
  parseSantaPickId,
} from "../../functions/ChallengeCustomIds.js";
import {
  CHALLENGE_SANTA_PICK_PREFIX,
  CHALLENGE_SANTA_PREFIX,
} from "../../config/customIdPrefixes.js";
import {
  DISCORD_AUTOCOMPLETE_CHOICES_MAX,
  truncateLabel,
} from "../../config/textLimits.js";
import { CHALLENGE_API } from "../../services/ChallengeApi.js";
import { challengeTextView } from "../../services/ChallengeBrowse.js";
import type { ChallengeRunResult } from "../../services/ChallengeRuns.js";
import {
  santaJoinReply,
  santaLeaveReply,
  santaWithdrawReply,
} from "../../services/ChallengeSignup.js";
import {
  buildSantaSearchModal,
  SANTA_SEARCH_FIELD,
  santaChooseReply,
  santaPickReply,
} from "../../services/ChallengeSantaPick.js";
import { safeIgnore } from "../../utilities/AsyncUtils.js";
import { logError } from "../../utilities/LogUtils.js";
import {
  challengeErrorReply,
  parseChallengeOption,
  readModalFields,
} from "./challenge-interaction.utils.js";

// /challenge santa join, leave and pick (spec api#376, bot#1551 and bot#1552), the first
// nested subcommand group, and the Secret Santa components: Sign up on the #challenges
// posts, Leave on the join reply, the question before leaving after the draw, and the
// Santa's pick (Pick now in the reminder DM, its pages, search and select). Every custom
// ID holds its Edition ID and the clicking member is who acts, so they work after a
// restart.

type SantaInteraction =
  | CommandInteraction
  | ButtonInteraction
  | StringSelectMenuInteraction
  | ModalSubmitInteraction;

/** Challenges read for the autocomplete, newest first. */
const AUTOCOMPLETE_READ = 100;

async function showResult(interaction: SantaInteraction, result: ChallengeRunResult):
  Promise<void> {
  await safeEditReply(
    interaction,
    "view" in result ? result.view : challengeErrorReply(result.error),
  );
}

/** Autocomplete for `challenge:`: the Secret Santas (Assignment Challenges) by name. */
async function autocompleteSanta(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const query = sanitizeUserInput(String(focused?.value ?? ""), { preserveNewlines: false })
    .trim()
    .toLowerCase();
  try {
    const page = await CHALLENGE_API.listChallenges({
      actingUserId: interaction.user.id,
      challengeFormat: "assignment",
      page: 1,
      per: AUTOCOMPLETE_READ,
    });
    const matches = page.items.filter((c) => !query || c.name.toLowerCase().includes(query));
    await safeRespond(interaction, matches.slice(0, DISCORD_AUTOCOMPLETE_CHOICES_MAX).map((c) => {
      const edition = c.assignment?.edition;
      return {
        name: truncateLabel(edition ? `${c.name} ${edition.year}` : c.name),
        value: String(c.id),
      };
    }));
  } catch (err: unknown) {
    logError("ChallengeSantaCommand.autocomplete", err);
    await safeRespond(interaction, []);
  }
}

/** The named Challenge, null for "find it", or undefined when the value isn't one. */
function challengeTarget(raw: string | undefined): number | null | undefined {
  if (raw === undefined || !raw.trim()) return null;
  return parseChallengeOption(raw) ?? undefined;
}

@Discord()
@SlashGroup({
  name: "santa",
  description: "Secret Santa: sign up, leave or pick",
  root: "challenge",
})
@SlashGroup("santa", "challenge")
export class ChallengeSantaCommand {
  @Slash({ name: "join", description: "Sign up for Secret Santa" })
  async join(
    @SlashOption({
      name: "challenge",
      description: "The Secret Santa, when there is more than one",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: autocompleteSanta,
    })
    challengeRaw: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await this.run("join", challengeRaw, interaction);
  }

  @Slash({ name: "leave", description: "Leave Secret Santa" })
  async leave(
    @SlashOption({
      name: "challenge",
      description: "The Secret Santa, when there is more than one",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: autocompleteSanta,
    })
    challengeRaw: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await this.run("leave", challengeRaw, interaction);
  }

  @Slash({ name: "pick", description: "Pick a game for the member you're Santa for" })
  async pick(
    @SlashOption({
      name: "challenge",
      description: "The Secret Santa, when there is more than one",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: autocompleteSanta,
    })
    challengeRaw: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    // Private: nobody but the Santa may see the recipient's list or the pick.
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const challengeId = challengeTarget(challengeRaw);
    if (challengeId === undefined) {
      await safeEditReply(interaction, challengeTextView("Pick a Secret Santa from the list."));
      return;
    }
    await showResult(
      interaction,
      await santaPickReply({ challengeId, actingUserId: interaction.user.id }),
    );
  }

  @ButtonComponent({ id: new RegExp(`^${CHALLENGE_SANTA_PICK_PREFIX}:`) })
  async pickButton(interaction: ButtonInteraction): Promise<void> {
    const target = parseSantaPickId(interaction.customId);
    if (target?.action === "search") {
      safeIgnore(interaction.showModal(buildSantaSearchModal(target.editionId, target.query)));
      return;
    }
    if (target?.action === "open") {
      // From the reminder DM: a private reply of its own.
      await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
      await showResult(interaction, await santaPickReply({
        editionId: target.editionId,
        actingUserId: interaction.user.id,
      }));
      return;
    }
    if (!(await safeDeferUpdate(interaction))) return;
    if (target?.action !== "page") {
      await safeEditReply(interaction, challengeTextView("This button is out of date."));
      return;
    }
    await showResult(interaction, await santaPickReply({
      editionId: target.editionId,
      actingUserId: interaction.user.id,
      page: target.page,
      query: target.query,
    }));
  }

  @SelectMenuComponent({ id: new RegExp(`^${CHALLENGE_SANTA_PICK_PREFIX}:choose:`) })
  async pickSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    if (!(await safeDeferUpdate(interaction))) return;
    const target = parseSantaPickId(interaction.customId);
    const gameId = Number(interaction.values[0]);
    if (!target || !Number.isInteger(gameId) || gameId < 1) {
      await safeEditReply(interaction, challengeTextView("This list is out of date."));
      return;
    }
    await showResult(interaction, await santaChooseReply({
      editionId: target.editionId,
      actingUserId: interaction.user.id,
      gameId,
      page: target.page,
      query: target.query,
    }));
  }

  @ModalComponent({ id: new RegExp(`^${CHALLENGE_SANTA_PICK_PREFIX}:search-modal:`) })
  async pickSearch(interaction: ModalSubmitInteraction): Promise<void> {
    if (!(await safeDeferModalSubmit(interaction))) return;
    const target = parseSantaPickId(interaction.customId);
    if (!target) {
      await safeEditReply(interaction, challengeTextView("This search is out of date."));
      return;
    }
    const query = sanitizeUserInput(readModalFields(interaction)[SANTA_SEARCH_FIELD] ?? "", {
      preserveNewlines: false,
    }).trim();
    await showResult(interaction, await santaPickReply({
      editionId: target.editionId,
      actingUserId: interaction.user.id,
      query,
    }));
  }

  @ButtonComponent({ id: new RegExp(`^${CHALLENGE_SANTA_PREFIX}:`) })
  async santaButton(interaction: ButtonInteraction): Promise<void> {
    const target = parseChallengeSantaId(interaction.customId);
    if (target?.action === "join") {
      // From a #challenges post: a private reply of its own.
      await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
      await showResult(
        interaction,
        await santaJoinReply({ editionId: target.editionId, actingUserId: interaction.user.id }),
      );
      return;
    }
    if (!(await safeDeferUpdate(interaction))) return;
    if (!target) {
      await safeEditReply(interaction, challengeTextView("This button is out of date."));
      return;
    }
    const input = { editionId: target.editionId, actingUserId: interaction.user.id };
    switch (target.action) {
      case "leave":
        await showResult(interaction, await santaLeaveReply(input));
        return;
      case "withdraw":
        await showResult(interaction, await santaWithdrawReply(input));
        return;
      case "stay":
        await safeEditReply(interaction, challengeTextView("You're still in. Nothing changed."));
        return;
    }
  }

  private async run(
    action: "join" | "leave",
    challengeRaw: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const challengeId = challengeTarget(challengeRaw);
    if (challengeId === undefined) {
      await safeEditReply(interaction, challengeTextView("Pick a Secret Santa from the list."));
      return;
    }
    const target = { challengeId, actingUserId: interaction.user.id };
    await showResult(
      interaction,
      action === "join" ? await santaJoinReply(target) : await santaLeaveReply(target),
    );
  }
}
