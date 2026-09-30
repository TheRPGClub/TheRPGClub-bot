import type { ApplicationCommand, Collection, CommandInteraction } from "discord.js";
import { chatInputApplicationCommandMention, inlineCode } from "discord.js";
import { IS_TEST_MODE } from "../config/testMode.js";

type CommandList = Collection<string, ApplicationCommand<any>>;
type CommandManager = { cache: CommandList; fetch: () => Promise<CommandList> };

/**
 * Looks up a registered slash command by name. Test mode registers commands to the test
 * guild and production registers them globally, so only that one list is searched.
 */
async function resolveCommandId(
  interaction: CommandInteraction,
  name: string,
): Promise<string | null> {
  const manager = (IS_TEST_MODE
    ? interaction.guild?.commands
    : interaction.client.application?.commands) as CommandManager | undefined;
  if (!manager) return null;
  const byName = (commands: CommandList | undefined) =>
    commands?.find((command) => command.name === name)?.id ?? null;
  return byName(manager.cache) ?? byName(await manager.fetch().catch(() => undefined));
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
