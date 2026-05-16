import { ContainerBuilder, SectionBuilder, TextDisplayBuilder } from "@discordjs/builders";
import { getUserEmojiString } from "../services/UserEmojiService.js";

export function buildUserHeaderContainer(
  userId: string,
  displayName: string,
  title = "DEFAULT TITLE VALUE",
): ContainerBuilder {
  const emoji = getUserEmojiString(userId);
  const userText = emoji ? `${emoji} ${displayName}` : displayName;

  const titleSection = new SectionBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(title),
  );
  const userSection = new SectionBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(userText),
  );

  return new ContainerBuilder().addSectionComponents(titleSection, userSection);
}
