import { ActionRowBuilder, ButtonStyle, StringSelectMenuBuilder } from "discord.js";
import {
  ButtonBuilder,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import {
  getUserEmojiString,
  renderUsernameWithEmoji,
} from "../services/UserEmojiService.js";
import { formatTableDate } from "../commands/profile.command.js";

export interface JournalSelectEntry {
  gameId: number;
  title: string;
  journalCount: number;
  lastJournalAt: Date | null;
}

export function buildJournalSelectRow(
  selectCustomId: string,
  entries: JournalSelectEntry[],
): ActionRowBuilder<StringSelectMenuBuilder> | null {
  if (!entries.length) return null;
  const options = entries.map((e) => {
    const rawLabel = `${e.title} Game Journal`;
    const label = rawLabel.length > 100 ? `${rawLabel.slice(0, 97)}...` : rawLabel;
    const countText = e.journalCount === 1 ? "1 entry" : `${e.journalCount} entries`;
    const lastPart = e.lastJournalAt ? ` · Last entry ${formatTableDate(e.lastJournalAt)}` : "";
    const description = `${countText}${lastPart}`.slice(0, 100);
    return { label, description, value: String(e.gameId) };
  });
  const select = new StringSelectMenuBuilder()
    .setCustomId(selectCustomId)
    .setPlaceholder("View Game Journals")
    .addOptions(options);
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
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
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`))
      .setButtonAccessory(button);
    return new ContainerBuilder().addSectionComponents(section);
  }

  const userText = renderUsernameWithEmoji(userId, displayName);
  return new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(userText),
  );
}
