import {
  chatInputApplicationCommandMention,
  inlineCode,
  type ApplicationCommand,
  type Collection,
  type CommandInteraction,
  type Snowflake,
} from "discord.js";
import { logError } from "../utilities/LogUtils.js";

type CommandList = Collection<Snowflake, ApplicationCommand>;

function findRootId(commands: CommandList | undefined, rootName: string): Snowflake | null {
  return commands?.find((command) => command.name === rootName)?.id ?? null;
}

/**
 * The id of a registered root command, checking the interaction's guild before the
 * global list. Test mode registers every command to the test guild, production
 * registers them globally. The caches are read first and fetched only on a miss.
 */
async function resolveRootCommandId(
  interaction: CommandInteraction,
  rootName: string,
): Promise<Snowflake | null> {
  const guildCommands = interaction.guild?.commands;
  const appCommands = interaction.client.application.commands;
  const cached = findRootId(guildCommands?.cache, rootName)
    ?? findRootId(appCommands.cache, rootName);
  if (cached) return cached;
  try {
    const fetchedGuild = guildCommands ? await guildCommands.fetch() : undefined;
    return findRootId(fetchedGuild, rootName)
      ?? findRootId(await appCommands.fetch(), rootName);
  } catch (error) {
    logError("CommandMention.resolve", error);
    return null;
  }
}

/**
 * A clickable mention of a slash command, such as `gotm nominate` or `admin sync`. Falls
 * back to the path as inline code when the command cannot be found, so a reply always
 * names it.
 */
export async function resolveCommandMention(
  interaction: CommandInteraction,
  commandPath: string,
): Promise<string> {
  const [rootName, subcommand, nested] = commandPath.trim().split(/\s+/);
  const id = await resolveRootCommandId(interaction, rootName);
  if (!id) return inlineCode(`/${commandPath}`);
  if (subcommand && nested) {
    return chatInputApplicationCommandMention(rootName, subcommand, nested, id);
  }
  if (subcommand) return chatInputApplicationCommandMention(rootName, subcommand, id);
  return chatInputApplicationCommandMention(rootName, id);
}
