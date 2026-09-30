import { ActionRowBuilder, StringSelectMenuBuilder } from "discord.js";
import { buildSelectOptions, buildSelectRow } from "./uiComponents.js";

export interface IStartPlayingOption {
  entryId: number;
  label: string;
  platformName: string | null;
}

/**
 * "Start playing" picker for the backlog and collection lists. Option values are API entry
 * ids and the custom id carries the owner, so the picker keeps working after a restart.
 */
export function buildStartPlayingSelectRow(
  customId: string,
  options: IStartPlayingOption[],
): ActionRowBuilder<StringSelectMenuBuilder> {
  const select = new StringSelectMenuBuilder()
    // eslint-disable-next-line local/custom-id-has-matching-handler
    .setCustomId(customId)
    .setPlaceholder("Start playing a game from this page")
    .addOptions(buildSelectOptions(options.map((option) => ({
      label: option.label,
      value: String(option.entryId),
      description: option.platformName ?? "No platform",
    }))));
  return buildSelectRow(select);
}
