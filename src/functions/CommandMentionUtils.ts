import type { ApplicationCommand, Collection, CommandInteraction } from "discord.js";
import { chatInputApplicationCommandMention, inlineCode } from "discord.js";

type CommandList = Collection<string, ApplicationCommand<any>>;

function findCommandId(commands: CommandList | undefined, name: string): string | null {
  return commands?.find((command) => command.name === name)?.id ?? null;
}

/**
 * Looks up a registered slash command by name. Test mode registers commands to the test
 * guild and production registers them globally, so both are searched, cache first.
 */
async function resolveCommandId(
  interaction: CommandInteraction,
  name: string,
): Promise<string | null> {
  const guildCommands = interaction.guild?.commands;
  const appCommands = interaction.client.application?.commands;
  const cached = findCommandId(guildCommands?.cache, name) ??
    findCommandId(appCommands?.cache, name);
  if (cached) return cached;

  const fetchedGuild = await guildCommands?.fetch().catch(() => undefined);
  const guildId = findCommandId(fetchedGuild, name);
  if (guildId) return guildId;
  const fetchedApp = await appCommands?.fetch().catch(() => undefined);
  return findCommandId(fetchedApp, name);
}

/**
 * Builds a clickable mention of `/<name> <subcommand>`. Falls back to the command
 * written as inline code when Discord does not report the command's id.
 */
export async function buildCommandMention(
  interaction: CommandInteraction,
  name: string,
  subcommand: string,
): Promise<string> {
  const commandId = await resolveCommandId(interaction, name);
  if (!commandId) return inlineCode(`/${name} ${subcommand}`);
  return chatInputApplicationCommandMention(name, subcommand, commandId);
}
