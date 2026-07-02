import type { AutocompleteInteraction } from "discord.js";
import { sanitizeUserInput } from "../../functions/InteractionUtils.js";
import { DISCORD_SELECT_OPTIONS_MAX, truncateLabel } from "../../config/textLimits.js";
import { getSortedHabitats, getSortedPokemon } from "./pokopia-data.service.js";

function getQuery(interaction: AutocompleteInteraction): string {
  const focused = interaction.options.getFocused(true);
  const rawQuery = focused?.value ? String(focused.value) : "";
  return sanitizeUserInput(rawQuery, { preserveNewlines: false }).trim().toLowerCase();
}

export async function autocompletePokopiaPokemon(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const query = getQuery(interaction);
  const pokemon = getSortedPokemon("number", "asc");

  const filtered = query
    ? pokemon.filter((p) => `${p.number} ${p.name}`.toLowerCase().includes(query))
    : pokemon;

  await interaction.respond(
    filtered.slice(0, DISCORD_SELECT_OPTIONS_MAX).map((p) => ({
      name: truncateLabel(`${p.number} ${p.name}`),
      value: p.number,
    })),
  );
}

export async function autocompletePokopiaHabitat(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const query = getQuery(interaction);
  const habitats = getSortedHabitats("asc");

  const filtered = query
    ? habitats.filter((h) => h.habitat.toLowerCase().includes(query))
    : habitats;

  await interaction.respond(
    filtered.slice(0, DISCORD_SELECT_OPTIONS_MAX).map((h) => ({
      name: truncateLabel(h.habitat),
      value: h.slug,
    })),
  );
}
