import { ButtonStyle } from "discord.js";
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

export function buildUserHeaderContainer(
  userId: string,
  displayName: string,
  title?: string,
): ContainerBuilder {
  if (title) {
    // Button labels do not render custom emoji markup -- use setEmoji() instead.
    const emojiString = getUserEmojiString(userId);
    let button = new ButtonBuilder()
      .setCustomId(`user-header-label:${userId}`)
      .setLabel(displayName)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true);
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
