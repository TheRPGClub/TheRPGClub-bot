import { type AutocompleteInteraction } from "discord.js";
import UserGameBacklog from "../../classes/UserGameBacklog.js";
import { sanitizeUserInput } from "../../functions/InteractionUtils.js";
import { DISCORD_SELECT_OPTIONS_MAX, truncateLabel } from "../../config/textLimits.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";
import { formatGameTitleWithYear } from "../../functions/GameTitleAutocompleteUtils.js";
import GameSearchService from "../../classes/GameSearchService.js";

export const BACKLOG_ENTRY_VALUE_PREFIX = "backlog";

export function parseBacklogEntryAutocompleteValue(raw: string): number | null {
  const value = raw.trim();
  const match = /^backlog:(\d+)$/i.exec(value);
  if (!match) return null;
  const entryId = Number(match[1]);
  if (!isPositiveInt(entryId)) return null;
  return entryId;
}

export function buildBacklogEntryAutocompleteValue(entryId: number): string {
  if (!isPositiveInt(entryId)) {
    throw new Error(`Cannot build backlog autocomplete value from invalid id: ${entryId}`);
  }
  return `${BACKLOG_ENTRY_VALUE_PREFIX}:${entryId}`;
}

export async function autocompleteBacklogGameTitle(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const rawQuery = focused?.value ? String(focused.value) : "";
  const query = sanitizeUserInput(rawQuery, { preserveNewlines: false }).trim();
  if (!query) {
    await interaction.respond([]);
    return;
  }

  const results = await GameSearchService.searchGamesAutocomplete(query);
  await interaction.respond(
    results.slice(0, DISCORD_SELECT_OPTIONS_MAX).map((game) => ({
      name: truncateLabel(formatGameTitleWithYear(game)),
      value: String(game.id),
    })),
  );
}

export async function autocompleteBacklogEntry(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const rawQuery = focused?.value ? String(focused.value) : "";
  const query = sanitizeUserInput(rawQuery, { preserveNewlines: false }).trim().toLowerCase();

  const entries = await UserGameBacklog.listForUser(interaction.user.id, 100);

  const filtered = query
    ? entries.filter(
      (e) =>
        e.title.toLowerCase().includes(query) ||
        (e.platformName?.toLowerCase().includes(query) ?? false),
    )
    : entries;

  await interaction.respond(
    filtered
      .filter((entry) => isPositiveInt(entry.entryId))
      .slice(0, DISCORD_SELECT_OPTIONS_MAX)
      .map((entry) => {
        const platform = entry.platformName ?? "No platform";
        const label = truncateLabel(`${entry.title} | ${platform}`);
        return {
          name: label,
          value: buildBacklogEntryAutocompleteValue(entry.entryId),
        };
      }),
  );
}
