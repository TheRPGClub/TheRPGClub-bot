import { chatInputApplicationCommandMention, type CommandInteraction } from "discord.js";

async function fetchCommandId(
  interaction: CommandInteraction,
  commandName: string,
  guildId: string | undefined,
): Promise<string | null> {
  try {
    const commands = await interaction.client.application.commands.fetch({ guildId });
    return commands.find((command) => command.name === commandName)?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * The registered ID of a sibling slash command. The invoking command's scope decides
 * where to look first: test mode registers guild commands, production registers global
 * ones. A guild command can point at a global one (the guild-scoped
 * `/generate-vote-image` alias names `/admin`), so a guild miss falls back to global.
 */
async function findCommandId(
  interaction: CommandInteraction,
  commandName: string,
): Promise<string | null> {
  const guildId = interaction.commandGuildId ?? undefined;
  const id = await fetchCommandId(interaction, commandName, guildId);
  if (id || !guildId) return id;
  return fetchCommandId(interaction, commandName, undefined);
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
