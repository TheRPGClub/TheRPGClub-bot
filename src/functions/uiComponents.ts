import { ContainerBuilder, TextDisplayBuilder } from "@discordjs/builders";
import { getUserEmojiString } from "../services/UserEmojiService.js";

export function buildUserHeaderContainer(
  userId: string,
  displayName: string,
  title?: string,
): ContainerBuilder {
  const emoji = getUserEmojiString(userId);
  const userText = emoji ? `${emoji} ${displayName}` : displayName;
  const container = new ContainerBuilder();
  if (title) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`));
  }
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(userText));
  return container;
}
