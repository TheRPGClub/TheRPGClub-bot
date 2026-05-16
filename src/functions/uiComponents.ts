import { ButtonStyle } from "discord.js";
import {
  ButtonBuilder,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import { getUserEmojiString } from "../services/UserEmojiService.js";

export function buildUserHeaderContainer(
  userId: string,
  displayName: string,
  title?: string,
): ContainerBuilder {
  const emoji = getUserEmojiString(userId);
  const userText = emoji ? `${emoji} ${displayName}` : displayName;

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
