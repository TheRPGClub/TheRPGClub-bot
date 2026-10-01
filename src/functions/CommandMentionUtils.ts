import { chatInputApplicationCommandMention, type CommandInteraction } from "discord.js";

/**
 * The registered ID of a sibling slash command. The invoking command's scope decides
 * where to look: test mode registers guild commands, production registers global ones.
 */
async function findCommandId(
  interaction: CommandInteraction,
  commandName: string,
): Promise<string | null> {
  try {
    const commands = await interaction.client.application.commands.fetch({
      guildId: interaction.commandGuildId ?? undefined,
    });
    return commands.find((command) => command.name === commandName)?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * A clickable mention of `/commandName [subcommand]`, or the command as inline code when
 * its registration cannot be found.
 */
export async function buildCommandMention(
  interaction: CommandInteraction,
  commandName: string,
  subcommand?: string,
): Promise<string> {
  const id = await findCommandId(interaction, commandName);
  if (!id) {
    return `\`/${subcommand ? `${commandName} ${subcommand}` : commandName}\``;
  }
  return subcommand
    ? chatInputApplicationCommandMention(commandName, subcommand, id)
    : chatInputApplicationCommandMention(commandName, id);
}
