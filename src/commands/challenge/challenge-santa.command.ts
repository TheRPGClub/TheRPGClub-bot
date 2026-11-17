import {
  ApplicationCommandOptionType,
  MessageFlags,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type CommandInteraction,
} from "discord.js";
import { ButtonComponent, Discord, Slash, SlashGroup, SlashOption } from "discordx";
import {
  safeDeferReply,
  safeDeferUpdate,
  safeEditReply,
  safeRespond,
  sanitizeUserInput,
} from "../../functions/InteractionUtils.js";
import { parseChallengeSantaId } from "../../functions/ChallengeCustomIds.js";
import { CHALLENGE_SANTA_PREFIX } from "../../config/customIdPrefixes.js";
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
import { logError } from "../../utilities/LogUtils.js";
import { challengeErrorReply, parseChallengeOption } from "./challenge-interaction.utils.js";

// /challenge santa join and leave (spec api#376, bot#1551), the first nested subcommand
// group, and the Secret Santa buttons: Sign up on the #challenges posts, Leave on the
// join reply, and the question before leaving after the draw. Every custom ID holds its
// Edition ID and the clicking member is who acts, so the buttons work after a restart.

type SantaInteraction = CommandInteraction | ButtonInteraction;

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
@SlashGroup({ name: "santa", description: "Secret Santa: sign up or leave", root: "challenge" })
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
