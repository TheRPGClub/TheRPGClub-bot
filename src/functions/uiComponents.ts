import { ButtonStyle } from "discord.js";
import {
  ButtonBuilder,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import { renderUsernameWithEmoji } from "../services/UserEmojiService.js";

export function buildUserHeaderContainer(
  userId: string,
  displayName: string,
  title?: string,
): ContainerBuilder {
  const userText = renderUsernameWithEmoji(userId, displayName);

  if (title) {
    const section = new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`))
      .setButtonAccessory(
        new ButtonBuilder()
          .setCustomId(`user-header-label:${userId}`)
          .setLabel(userText)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
      );
    return new ContainerBuilder().addSectionComponents(section);
  }

  return new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(userText),
  );
}
