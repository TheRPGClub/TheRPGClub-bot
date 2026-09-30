/**
 * The preview bot's slash commands, attached as JSON to its ready announcement. The
 * conductor is a separate application and cannot list another application's commands,
 * so this file is how it learns their IDs to show clickable command mentions. Both
 * processes build and read it only through these.
 */
import { ApplicationCommandOptionType, ApplicationCommandType } from "discord.js";

export const PREVIEW_COMMANDS_ATTACHMENT_NAME = "preview-commands.json";

export interface ICatalogCommand {
  name: string;
  id: string;
  /** Invocable paths under the command: `sub` or `group sub`. Empty for a leaf command. */
  subcommands: string[];
}

export interface ICommandCatalog {
  commands: ICatalogCommand[];
}

/** The fields read from a discord.js `ApplicationCommand`, so tests need no client. */
export interface ICommandOptionLike {
  type: ApplicationCommandOptionType;
  name: string;
  options?: readonly ICommandOptionLike[];
}

export interface IApplicationCommandLike {
  id: string;
  name: string;
  type: ApplicationCommandType;
  options: readonly ICommandOptionLike[];
}

/** Discord's documented rule for command, group, and subcommand names. */
const COMMAND_NAME_PATTERN = /^[-_'\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;
const SNOWFLAKE_PATTERN = /^\d{17,20}$/;
/** Discord caps an application at 100 chat input commands per scope, two scopes here. */
const MAX_CATALOG_COMMANDS = 200;
/** 25 groups of 25 subcommands each, Discord's ceiling for one command. */
const MAX_SUBCOMMAND_PATHS = 625;

function subcommandPaths(options: readonly ICommandOptionLike[]): string[] {
  const paths: string[] = [];
  for (const option of options) {
    if (option.type === ApplicationCommandOptionType.Subcommand) {
      paths.push(option.name);
    } else if (option.type === ApplicationCommandOptionType.SubcommandGroup) {
      for (const sub of option.options ?? []) {
        if (sub.type === ApplicationCommandOptionType.Subcommand) {
          paths.push(`${option.name} ${sub.name}`);
        }
      }
    }
  }
  return paths;
}

/** The chat input commands among `commands`; a later entry wins a repeated name. */
export function buildCommandCatalog(
  commands: Iterable<IApplicationCommandLike>,
): ICommandCatalog {
  const byName = new Map<string, ICatalogCommand>();
  for (const command of commands) {
    if (command.type !== ApplicationCommandType.ChatInput) continue;
    byName.set(command.name, {
      name: command.name,
      id: command.id,
      subcommands: subcommandPaths(command.options),
    });
  }
  return { commands: [...byName.values()] };
}

function isPath(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = value.split(" ");
  return parts.length <= 2 && parts.every((part) => COMMAND_NAME_PATTERN.test(part));
}

function parseCatalogCommand(value: unknown): ICatalogCommand | null {
  if (!value || typeof value !== "object") return null;
  const { name, id, subcommands } = value as Record<string, unknown>;
  if (typeof name !== "string" || !COMMAND_NAME_PATTERN.test(name)) return null;
  if (typeof id !== "string" || !SNOWFLAKE_PATTERN.test(id)) return null;
  if (!Array.isArray(subcommands) || subcommands.length > MAX_SUBCOMMAND_PATHS) return null;
  if (!subcommands.every(isPath)) return null;
  return { name, id, subcommands: [...subcommands] };
}

/**
 * The catalog in `text`, or null when it is not one. Every name and ID is checked
 * against Discord's formats, since each is later written into mention markup; an entry
 * that fails is dropped, so the other commands keep their mentions.
 */
export function parseCommandCatalog(text: string): ICommandCatalog | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const list = (parsed as { commands?: unknown } | null)?.commands;
  if (!Array.isArray(list) || list.length > MAX_CATALOG_COMMANDS) return null;
  const commands: ICatalogCommand[] = [];
  for (const entry of list) {
    const command = parseCatalogCommand(entry);
    if (command) commands.push(command);
  }
  return { commands };
}
