import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from "discord.js";
import {
  ContainerBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import { type IMemberNowPlayingEntry } from "../../classes/Member.js";
import {
  buildActionButton,
  buildButtonRow,
  buildSelectRow,
} from "../../functions/uiComponents.js";
import { safeV2TextContent } from "../../functions/ComponentsV2Utils.js";
import {
  formatEntryTitleWithPlatform,
  parseNowPlayingPlatformStateToken,
  parseNowPlayingSortStateToken,
} from "../../functions/NowPlayingUtils.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";
import {
  DISCORD_SELECT_OPTIONS_MAX,
  truncateLabel,
} from "../../config/textLimits.js";
import { NOW_PLAYING_HELP_PREFIX } from "../now-playing-help.js";
import {
  NOW_PLAYING_SORT_SLOT_PREFIX,
  NOW_PLAYING_SORT_SAVE_PREFIX,
  NOW_PLAYING_SORT_RESET_PREFIX,
  NOW_PLAYING_EDIT_PLATFORM_SLOT_PREFIX,
  NOW_PLAYING_EDIT_PLATFORM_SAVE_PREFIX,
  NOW_PLAYING_EDIT_PLATFORM_RESET_PREFIX,
  NOW_PLAYING_REMOVE_SELECT_PREFIX,
} from "./nowPlayingIds.js";
import {
  buildNowPlayingListLines,
  trimTextDisplayContent,
} from "./nowPlayingListRenderer.js";

export function buildNowPlayingRemoveComponents(
  entries: IMemberNowPlayingEntry[],
  ownerId: string,
  _thumbnailsByGameId: Map<number, string>,
): Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>> {
  void _thumbnailsByGameId;
  const container = new ContainerBuilder();
  const textLines = [
    "## Now Playing Remove",
    "Select a game below to remove it from your list.",
    "",
    ...buildNowPlayingListLines(entries, null),
  ];
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      safeV2TextContent(trimTextDisplayContent(textLines.join("\n")), 3500),
    ),
  );

  const selectOptions = entries
    .filter((entry) => isPositiveInt(entry.gameId))
    .slice(0, DISCORD_SELECT_OPTIONS_MAX)
    .map((entry) => ({
      label: truncateLabel(formatEntryTitleWithPlatform(entry)),
      value: String(entry.gameId),
    }));
  const removeSelect = new StringSelectMenuBuilder()
    .setCustomId(`${NOW_PLAYING_REMOVE_SELECT_PREFIX}:${ownerId}`)
    .setPlaceholder("Select a game to remove")
    .addOptions(selectOptions);
  const selectRow = buildSelectRow(removeSelect);

  const doneRow = buildButtonRow(
    buildActionButton("confirm", `nowplaying-remove-done:${ownerId}`, "Done"),
    buildActionButton({ customId: `${NOW_PLAYING_HELP_PREFIX}:remove:${ownerId}`, label: "?", style: ButtonStyle.Secondary }),
  );
  return [container, selectRow, doneRow];
}

export function buildNowPlayingEditPlatformComponents(
  entries: IMemberNowPlayingEntry[],
  ownerId: string,
  platformOptions: Array<Array<{ label: string; value: string; platformId: number }>>,
  stateToken: string,
  validationMessage: string | null = null,
): Array<ContainerBuilder | ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>> {
  const parsedState = parseNowPlayingPlatformStateToken(stateToken, entries.length) ??
    Array.from({ length: entries.length }, () => -1);
  const container = new ContainerBuilder();
  const introLines = [
    "## Now Playing Edit Platform",
    "Pick one platform per game, then press Save.",
  ];
  if (validationMessage) {
    introLines.push(`-# ${validationMessage}`);
  }
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      safeV2TextContent(introLines.join("\n"), 1000),
    ),
  );

  const rows: Array<ActionRowBuilder<StringSelectMenuBuilder>> = [];
  for (let slotIndex = 0; slotIndex < entries.length; slotIndex += 1) {
    const entry = entries[slotIndex];
    const options = platformOptions[slotIndex] ?? [];
    if (!options.length) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          safeV2TextContent(`-# ${entry.title.slice(0, 80)}: No platform choices available.`, 1000),
        ),
      );
      continue;
    }
    const selectedIndex = parsedState[slotIndex];
    const currentPlatformName =
      selectedIndex >= 0 ? (options[selectedIndex]?.label ?? null) : null;
    const placeholder = currentPlatformName
      ? truncateLabel(`${entry.title.slice(0, 50)} - ${currentPlatformName}`)
      : truncateLabel(entry.title);
    const select = new StringSelectMenuBuilder()
      .setCustomId(`${NOW_PLAYING_EDIT_PLATFORM_SLOT_PREFIX}:${ownerId}:${slotIndex}:${stateToken}`)
      .setPlaceholder(placeholder)
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(options.map((option, optionIndex) => ({
        label: optionIndex === selectedIndex
          ? truncateLabel(`${entry.title.slice(0, 50)} - ${option.label}`)
          : option.label,
        value: option.value,
        default: selectedIndex === optionIndex,
      })));
    rows.push(buildSelectRow(select));
  }
  const components: Array<
    ContainerBuilder | ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>
  > = [
    container,
    ...rows,
  ];

  const actionRow = buildButtonRow(
    buildActionButton(
      "confirm",
      `${NOW_PLAYING_EDIT_PLATFORM_SAVE_PREFIX}:${ownerId}:${stateToken}`,
      "Save",
    ),
    buildActionButton({ customId: `${NOW_PLAYING_EDIT_PLATFORM_RESET_PREFIX}:${ownerId}`, label: "Reset to current platforms", style: ButtonStyle.Secondary }),
    buildActionButton("cancel", `nowplaying-list-cancel:${ownerId}`),
    buildActionButton({ customId: `${NOW_PLAYING_HELP_PREFIX}:platform:${ownerId}`, label: "?", style: ButtonStyle.Secondary }),
  );
  components.push(actionRow);
  return components;
}

export function buildNowPlayingSortComponents(
  entries: IMemberNowPlayingEntry[],
  ownerId: string,
  stateToken: string,
  validationMessage: string | null = null,
): Array<ContainerBuilder | ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>> {
  const parsedState = parseNowPlayingSortStateToken(stateToken, entries.length) ??
    Array.from({ length: entries.length }, () => -1);
  const container = new ContainerBuilder();
  const introLines = [
    "## Sort Your Now Playing List",
    "Pick one title for each position, then press Save.",
  ];
  if (validationMessage) {
    introLines.push(`-# ${validationMessage}`);
  }
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      safeV2TextContent(introLines.join("\n"), 1000),
    ),
  );

  const rows: Array<ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>> = [];
  for (let slotIndex = 0; slotIndex < entries.length; slotIndex += 1) {
    const selectedIndex = parsedState[slotIndex] ?? -1;
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`${NOW_PLAYING_SORT_SLOT_PREFIX}:${ownerId}:${slotIndex}:${stateToken}`)
      .setPlaceholder(`Position ${slotIndex + 1}`)
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(entries.map((entry, entryIndex) => ({
        label: truncateLabel(formatEntryTitleWithPlatform(entry)),
        value: String(entryIndex),
        default: selectedIndex === entryIndex,
      })));
    rows.push(buildSelectRow(menu));
  }

  const actionRow = buildButtonRow(
    buildActionButton(
      "confirm",
      `${NOW_PLAYING_SORT_SAVE_PREFIX}:${ownerId}:${stateToken}`,
      "Save",
    ),
    buildActionButton({ customId: `${NOW_PLAYING_SORT_RESET_PREFIX}:${ownerId}`, label: "Reset to current order", style: ButtonStyle.Secondary }),
    buildActionButton("cancel", `nowplaying-list-cancel:${ownerId}`),
    buildActionButton({ customId: `${NOW_PLAYING_HELP_PREFIX}:sort:${ownerId}`, label: "?", style: ButtonStyle.Secondary }),
  );
  rows.push(actionRow);
  return [container, ...rows];
}
