import { type AutocompleteInteraction } from "discord.js";
import Game from "../../classes/Game.js";
import UserGameCollection, {
  type CollectionOwnershipType,
} from "../../classes/UserGameCollection.js";
import { sanitizeUserInput } from "../../functions/InteractionUtils.js";
import { formatGameTitleWithYear } from "../../functions/GameTitleAutocompleteUtils.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";
import { DISCORD_SELECT_OPTIONS_MAX, truncateLabel } from "../../config/textLimits.js";

export const COLLECTION_ENTRY_VALUE_PREFIX = "collection";

export function parseCollectionEntryAutocompleteValue(raw: string): number | null {
  const value = raw.trim();
  const match = /^collection:(\d+)$/i.exec(value);
  if (!match) return null;
  const entryId = Number(match[1]);
  if (!isPositiveInt(entryId)) return null;
  return entryId;
}

export function buildCollectionEntryAutocompleteValue(entryId: number): string {
  return `${COLLECTION_ENTRY_VALUE_PREFIX}:${entryId}`;
}

export function formatCollectionEntryAutocompleteName(entry: {
  title: string;
  platformName: string | null;
  ownershipType: CollectionOwnershipType;
}): string {
  const platform = entry.platformName ?? "Unknown platform";
  return truncateLabel(`${entry.title} | ${platform} | ${entry.ownershipType}`);
}

export async function autocompleteCollectionGameTitle(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const rawQuery = focused?.value ? String(focused.value) : "";
  const query = sanitizeUserInput(rawQuery, { preserveNewlines: false }).trim();
  if (!query) {
    await interaction.respond([]);
    return;
  }

  const results = await Game.searchGamesAutocomplete(query);
  await interaction.respond(
    results.slice(0, DISCORD_SELECT_OPTIONS_MAX).map((game) => ({
      name: truncateLabel(formatGameTitleWithYear(game)),
      value: String(game.id),
    })),
  );
}

export async function autocompleteCollectionEntry(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const rawQuery = focused?.value ? String(focused.value) : "";
  const query = sanitizeUserInput(rawQuery, { preserveNewlines: false });

  const results = await UserGameCollection.autocompleteEntries(
    interaction.user.id,
    query,
    25,
  );

  await interaction.respond(
    results.map((entry) => ({
      name: formatCollectionEntryAutocompleteName(entry),
      value: buildCollectionEntryAutocompleteValue(entry.entryId),
    })),
  );
}
