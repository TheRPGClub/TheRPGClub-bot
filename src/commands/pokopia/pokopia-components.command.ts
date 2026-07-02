import type { ButtonInteraction, StringSelectMenuInteraction } from "discord.js";
import { ButtonComponent, Discord, SelectMenuComponent } from "discordx";
import {
  replyIfNotOwner,
  safeReply,
  safeUpdate,
} from "../../functions/InteractionUtils.js";
import { buildComponentsV2Flags, buildTextReply } from "../../functions/ComponentsV2Utils.js";
import { safeIgnore } from "../../utilities/AsyncUtils.js";
import {
  POKOPIA_BACK_PREFIX,
  POKOPIA_LIST_NAV_PREFIX,
  POKOPIA_SELECT_PREFIX,
} from "../../config/customIdPrefixes.js";
import {
  parsePokopiaBackId,
  parsePokopiaListNavId,
  parsePokopiaSelectId,
} from "./pokopia-customid.utils.js";
import {
  buildHabitatDetailPayload,
  buildHabitatListPayload,
  buildPokemonDetailPayload,
  buildPokemonListPayload,
} from "./pokopia-render.service.js";

const INVALID_CONTROL_MESSAGE = "This Pokopia view control is invalid.";
const NOT_YOUR_VIEW_MESSAGE = "This Pokopia view is not for you.";

@Discord()
export class PokopiaComponentsCommand {
  @ButtonComponent({
    id: new RegExp(`^${POKOPIA_LIST_NAV_PREFIX}:[ph]:[^:]+:[an]:[du]:\\d+:(prev|next)$`),
  })
  async onPokopiaListNav(interaction: ButtonInteraction): Promise<void> {
    const parsed = parsePokopiaListNavId(interaction.customId);
    if (!parsed) {
      safeIgnore(safeReply(interaction, buildTextReply(INVALID_CONTROL_MESSAGE, true)));
      return;
    }
    if (await replyIfNotOwner(interaction, parsed.ownerId, NOT_YOUR_VIEW_MESSAGE)) return;

    const nextPage = parsed.direction === "next" ? parsed.page + 1 : Math.max(parsed.page - 1, 0);
    const payload = parsed.kind === "pokemon"
      ? buildPokemonListPayload(parsed.ownerId, parsed.sort, parsed.order, nextPage)
      : buildHabitatListPayload(parsed.ownerId, parsed.order, nextPage);

    await safeUpdate(interaction, {
      components: payload.components,
      files: payload.files,
      flags: buildComponentsV2Flags(false),
    });
  }

  @SelectMenuComponent({
    id: new RegExp(`^${POKOPIA_SELECT_PREFIX}:[ph]:[^:]+:[an]:[du]:\\d+$`),
  })
  async onPokopiaSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const parsed = parsePokopiaSelectId(interaction.customId);
    if (!parsed) {
      safeIgnore(safeReply(interaction, buildTextReply(INVALID_CONTROL_MESSAGE, true)));
      return;
    }
    if (await replyIfNotOwner(interaction, parsed.ownerId, NOT_YOUR_VIEW_MESSAGE)) return;

    const selectedValue = interaction.values[0];
    const payload = parsed.kind === "pokemon"
      ? buildPokemonDetailPayload(
        parsed.ownerId, parsed.sort, parsed.order, parsed.page, selectedValue,
      )
      : buildHabitatDetailPayload(parsed.ownerId, parsed.order, parsed.page, selectedValue);

    if (!payload) {
      safeIgnore(safeReply(interaction, buildTextReply(INVALID_CONTROL_MESSAGE, true)));
      return;
    }

    await safeUpdate(interaction, {
      components: payload.components,
      files: payload.files,
      flags: buildComponentsV2Flags(false),
    });
  }

  @ButtonComponent({
    id: new RegExp(`^${POKOPIA_BACK_PREFIX}:[ph]:[^:]+:[an]:[du]:\\d+$`),
  })
  async onPokopiaBack(interaction: ButtonInteraction): Promise<void> {
    const parsed = parsePokopiaBackId(interaction.customId);
    if (!parsed) {
      safeIgnore(safeReply(interaction, buildTextReply(INVALID_CONTROL_MESSAGE, true)));
      return;
    }
    if (await replyIfNotOwner(interaction, parsed.ownerId, NOT_YOUR_VIEW_MESSAGE)) return;

    const payload = parsed.kind === "pokemon"
      ? buildPokemonListPayload(parsed.ownerId, parsed.sort, parsed.order, parsed.page)
      : buildHabitatListPayload(parsed.ownerId, parsed.order, parsed.page);

    await safeUpdate(interaction, {
      components: payload.components,
      files: payload.files,
      flags: buildComponentsV2Flags(false),
    });
  }
}
