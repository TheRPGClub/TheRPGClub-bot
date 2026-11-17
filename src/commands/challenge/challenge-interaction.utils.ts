import {
  PermissionsBitField,
  type AutocompleteInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import {
  memberHasPermission,
  safeRespond,
  sanitizeUserInput,
  type AnyRepliable,
} from "../../functions/InteractionUtils.js";
import { buildErrorReply } from "../../functions/ComponentsV2Utils.js";
import GameSearchService from "../../classes/GameSearchService.js";
import {
  DISCORD_AUTOCOMPLETE_CHOICES_MAX,
  truncateLabel,
} from "../../config/textLimits.js";
import { CHALLENGE_API } from "../../services/ChallengeApi.js";
import type { IIncludeChoice } from "../../services/ChallengeWizard.js";
import { logError } from "../../utilities/LogUtils.js";

// Discord-side helpers the /challenge commands share.

/** Challenges read for the autocomplete, newest first. */
const AUTOCOMPLETE_READ = 100;

/**
 * Autocomplete for a `challenge:` option: the Challenges the member may see whose name
 * holds what they typed, with the Challenge ID as the value.
 */
export async function autocompleteChallenge(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const query = sanitizeUserInput(String(focused?.value ?? ""), { preserveNewlines: false })
    .trim()
    .toLowerCase();
  try {
    const page = await CHALLENGE_API.listChallenges({
      actingUserId: interaction.user.id,
      page: 1,
      per: AUTOCOMPLETE_READ,
    });
    const matches = page.items.filter((c) => !query || c.name.toLowerCase().includes(query));
    await safeRespond(interaction, matches.slice(0, DISCORD_AUTOCOMPLETE_CHOICES_MAX).map((c) => ({
      name: truncateLabel(`${c.name}${c.open ? "" : " (Closed)"}`),
      value: String(c.id),
    })));
  } catch (err: unknown) {
    logError("ChallengeCommand.autocomplete", err);
    await safeRespond(interaction, []);
  }
}

/** The Challenge ID an autocompleted option holds, or null when it is not one. */
export function parseChallengeOption(raw: string): number | null {
  const id = Number(raw.trim());
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Whether Discord shows the member as staff who may hide and hand over Challenges. */
export function canModerate(interaction: AnyRepliable): boolean {
  return memberHasPermission(interaction, PermissionsBitField.Flags.ManageMessages) ||
    memberHasPermission(interaction, PermissionsBitField.Flags.Administrator);
}

/** A modal's answers by input ID: text as typed, radio groups as their value or null. */
export function readModalFields(
  interaction: ModalSubmitInteraction,
  radioIds: readonly string[] = [],
): Record<string, string | null> {
  const fields: Record<string, string | null> = {};
  for (const [id, data] of interaction.fields.fields) {
    if (radioIds.includes(id)) {
      fields[id] = interaction.fields.getRadioGroup(id) ?? null;
    } else if ("value" in data && typeof data.value === "string") {
      fields[id] = data.value;
    }
  }
  return fields;
}

/** GameDB titles for "Include a game", as the wizard offers them. */
export async function searchIncludeGames(query: string): Promise<IIncludeChoice[]> {
  const results = await GameSearchService.searchGamesAutocomplete(query);
  return results.map((game) => ({
    id: game.id,
    title: game.title,
    year: game.initialReleaseDate ? game.initialReleaseDate.getUTCFullYear() : null,
  }));
}

/**
 * An error that replaces an acked reply (an edit, so no Ephemeral flag: the reply keeps
 * its own), or, with `followUp`, a new private message.
 */
export function challengeErrorReply(
  content: string,
  followUp = false,
): ReturnType<typeof buildErrorReply> {
  return buildErrorReply(content, followUp);
}
