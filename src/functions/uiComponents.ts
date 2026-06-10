import {
  ActionRowBuilder,
  ButtonStyle,
  ComponentEmojiResolvable,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import {
  ButtonBuilder,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";

export interface IModalTextInputOptions {
  customId: string;
  label: string;
  style?: TextInputStyle;
  required?: boolean;
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
  value?: string;
}

export function buildTextInputRow(
  options: IModalTextInputOptions,
): ActionRowBuilder<TextInputBuilder> {
  const input = new TextInputBuilder()
    .setCustomId(options.customId)
    .setLabel(options.label)
    .setStyle(options.style ?? TextInputStyle.Short)
    .setRequired(options.required ?? true);
  if (options.placeholder != null) input.setPlaceholder(options.placeholder);
  if (options.minLength != null) input.setMinLength(options.minLength);
  if (options.maxLength != null) input.setMaxLength(options.maxLength);
  if (options.value != null) input.setValue(options.value);
  return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
}

type ButtonAction = "add" | "edit" | "delete" | "confirm" | "cancel" | "close";

const ACTION_DEFAULTS: Record<ButtonAction, { label: string; style: ButtonStyle }> = {
  add:     { label: "Add",     style: ButtonStyle.Success   },
  edit:    { label: "Edit",    style: ButtonStyle.Primary   },
  delete:  { label: "Delete",  style: ButtonStyle.Danger    },
  confirm: { label: "Confirm", style: ButtonStyle.Success   },
  cancel:  { label: "Cancel",  style: ButtonStyle.Secondary },
  close:   { label: "Close",   style: ButtonStyle.Secondary },
};

export function buildActionButton(
  action: ButtonAction, customId: string, label?: string): ButtonBuilder;
export function buildActionButton(
  opts: { customId: string; label: string; style: ButtonStyle }): ButtonBuilder;
export function buildActionButton(
  actionOrOpts: ButtonAction | { customId: string; label: string; style: ButtonStyle },
  customId?: string,
  label?: string,
): ButtonBuilder {
  if (typeof actionOrOpts === "string") {
    const d = ACTION_DEFAULTS[actionOrOpts];
    return new ButtonBuilder()
      .setCustomId(customId!)
      .setLabel(label ?? d.label)
      .setStyle(d.style);
  }
  return new ButtonBuilder()
    .setCustomId(actionOrOpts.customId)
    .setLabel(actionOrOpts.label)
    .setStyle(actionOrOpts.style);
}
import {
  getUserEmojiString,
  renderUsernameWithEmoji,
} from "../services/UserEmojiService.js";
import { safeV2TextContent } from "./ComponentsV2Utils.js";
import { formatTableDate } from "./DateFormatUtils.js";
import {
  DISCORD_AUTOCOMPLETE_DESC_MAX,
  DISCORD_SELECT_LABEL_MAX,
  DISCORD_SELECT_OPTIONS_MAX,
} from "../config/textLimits.js";
import { truncateWithEllipsis } from "../utilities/ValidationUtils.js";

export interface ISelectOptionInput {
  label: string;
  value: string;
  description?: string;
  emoji?: ComponentEmojiResolvable;
}

export function buildSelectOptions(
  inputs: ISelectOptionInput[],
  maxOptions = DISCORD_SELECT_OPTIONS_MAX,
): StringSelectMenuOptionBuilder[] {
  return inputs.slice(0, maxOptions).map((item) => {
    const option = new StringSelectMenuOptionBuilder()
      .setLabel(item.label.slice(0, DISCORD_SELECT_LABEL_MAX))
      .setValue(item.value)
      .setDescription((item.description ?? "").slice(0, DISCORD_AUTOCOMPLETE_DESC_MAX));
    if (item.emoji != null) option.setEmoji(item.emoji);
    return option;
  });
}

export interface IJournalSelectEntry {
  gameId: number;
  title: string;
  journalCount: number;
  lastJournalAt: Date | null;
}

export function buildJournalSelectRow(
  selectCustomId: string,
  entries: IJournalSelectEntry[],
): ActionRowBuilder<StringSelectMenuBuilder> | null {
  if (!entries.length) return null;
  const sorted = [...entries].sort((a, b) => a.title.localeCompare(b.title));
  const options = sorted.map((e) => {
    const rawLabel = `${e.title} Game Journal`;
    const label =
      rawLabel.length > DISCORD_SELECT_LABEL_MAX
        ? truncateWithEllipsis(rawLabel, DISCORD_SELECT_LABEL_MAX)
        : rawLabel;
    const countText = e.journalCount === 1 ? "1 entry" : `${e.journalCount} entries`;
    const lastPart = e.lastJournalAt ? ` · Last entry ${formatTableDate(e.lastJournalAt)}` : "";
    const description = `${countText}${lastPart}`.slice(0, DISCORD_SELECT_LABEL_MAX);
    return { label, description, value: String(e.gameId) };
  });
  const select = new StringSelectMenuBuilder()
    .setCustomId(selectCustomId)
    .setPlaceholder("View Game Journals")
    .addOptions(options);
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

export function buildTitleHeaderContainer(title: string): ContainerBuilder {
  return new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(safeV2TextContent(`## ${title}`, 250)),
  );
}

export function buildUserHeaderContainer(
  userId: string,
  displayName: string,
  title?: string,
  buttonCustomId?: string,
): ContainerBuilder {
  if (title) {
    // Button labels do not render custom emoji markup -- use setEmoji() instead.
    const emojiString = getUserEmojiString(userId);
    let button = new ButtonBuilder()
      .setCustomId(buttonCustomId ?? `user-header-label:${userId}`)
      .setLabel(displayName)
      .setStyle(ButtonStyle.Secondary);
    if (emojiString) {
      // setEmoji requires APIMessageComponentEmoji; parse <:name:id> format.
      const match = emojiString.match(/^<:([^:]+):(\d+)>$/);
      if (match) {
        button = button.setEmoji({ name: match[1], id: match[2] });
      }
    }
    const section = new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(safeV2TextContent(`## ${title}`, 250)),
      );
    section.setButtonAccessory(button);
    return new ContainerBuilder().addSectionComponents(section);
  }

  const userText = renderUsernameWithEmoji(userId, displayName);
  return new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(safeV2TextContent(userText, 500)),
  );
}
