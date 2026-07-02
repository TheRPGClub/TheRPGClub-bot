import { ApplicationCommandOptionType, CommandInteraction } from "discord.js";
import { Discord, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import {
  safeDeferReply,
  safeReply,
} from "../../functions/InteractionUtils.js";
import { buildComponentsV2Flags, buildTextReply } from "../../functions/ComponentsV2Utils.js";
import { buildPokemonDetailPayload, buildPokemonListPayload } from "./pokopia-render.service.js";
import type { PokopiaSortField, PokopiaSortOrder } from "./pokopia-data.service.js";
import { autocompletePokopiaPokemon } from "./pokopia-autocomplete.utils.js";

@Discord()
@SlashGroup({ description: "Browse the Pokopia pokedex and habitats", name: "pokopia" })
@SlashGroup("pokopia")
export class PokopiaPokemonCommand {
  @Slash({ description: "Browse the Pokopia pokedex", name: "pokedex" })
  async pokemon(
    @SlashChoice({ name: "Number", value: "number" }, { name: "Name", value: "name" })
    @SlashOption({
      description: "Sort by",
      name: "sort",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    sort: PokopiaSortField | undefined,
    @SlashChoice({ name: "Ascending", value: "asc" }, { name: "Descending", value: "desc" })
    @SlashOption({
      description: "Sort order",
      name: "order",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    order: PokopiaSortOrder | undefined,
    @SlashOption({
      description: "Jump directly to a Pokemon by number or name",
      name: "query",
      required: false,
      type: ApplicationCommandOptionType.String,
      autocomplete: autocompletePokopiaPokemon,
    })
    query: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(true) });

    const resolvedSort = sort ?? "number";
    const resolvedOrder = order ?? "asc";

    if (query) {
      const detailPayload = buildPokemonDetailPayload(
        interaction.user.id, resolvedSort, resolvedOrder, 0, query,
      );
      if (detailPayload) {
        await safeReply(interaction, {
          components: detailPayload.components,
          files: detailPayload.files,
          flags: buildComponentsV2Flags(true),
        });
        return;
      }
      await safeReply(interaction, buildTextReply("No matching Pokemon found.", true));
      return;
    }

    const payload = buildPokemonListPayload(interaction.user.id, resolvedSort, resolvedOrder, 0);

    await safeReply(interaction, {
      components: payload.components,
      files: payload.files,
      flags: buildComponentsV2Flags(true),
    });
  }
}
