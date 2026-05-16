import { ContainerBuilder, TextDisplayBuilder } from "@discordjs/builders";
import { getUserEmojiString } from "../services/UserEmojiService.js";

export function buildUserHeaderContainer(userId: string, displayName: string): ContainerBuilder {
  const emoji = getUserEmojiString(userId);
  const text = emoji ? `${emoji} ${displayName}` : displayName;
  return new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(text),
  );
}
