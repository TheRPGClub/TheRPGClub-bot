import { ApplicationCommandOptionType, CommandInteraction } from "discord.js";
import { Discord, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import { safeDeferReply, safeReply } from "../../functions/InteractionUtils.js";
import { buildComponentsV2Flags, buildTextReply } from "../../functions/ComponentsV2Utils.js";
import { buildHabitatDetailPayload, buildHabitatListPayload } from "./pokopia-render.service.js";
import type { PokopiaSortOrder } from "./pokopia-data.service.js";
import { autocompletePokopiaHabitat } from "./pokopia-autocomplete.utils.js";

@Discord()
@SlashGroup("pokopia")
export class PokopiaHabitatCommand {
  @Slash({ description: "Browse Pokopia habitats", name: "habitat" })
  async habitat(
    @SlashChoice({ name: "Ascending", value: "asc" }, { name: "Descending", value: "desc" })
    @SlashOption({
      description: "Sort order (by name)",
      name: "order",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    order: PokopiaSortOrder | undefined,
    @SlashOption({
      description: "Jump directly to a habitat by name",
      name: "query",
      required: false,
      type: ApplicationCommandOptionType.String,
      autocomplete: autocompletePokopiaHabitat,
    })
    query: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(true) });

    const resolvedOrder = order ?? "asc";

    if (query) {
      const detailPayload = buildHabitatDetailPayload(
        interaction.user.id, resolvedOrder, 0, query,
      );
      if (detailPayload) {
        await safeReply(interaction, {
          components: detailPayload.components,
          files: detailPayload.files,
          flags: buildComponentsV2Flags(true),
        });
        return;
      }
      await safeReply(interaction, buildTextReply("No matching habitat found.", true));
      return;
    }

    const payload = buildHabitatListPayload(interaction.user.id, resolvedOrder, 0);

    await safeReply(interaction, {
      components: payload.components,
      files: payload.files,
      flags: buildComponentsV2Flags(true),
    });
  }
}
