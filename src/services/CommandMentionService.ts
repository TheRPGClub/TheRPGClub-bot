/**
 * Clickable slash command mentions for the bot's own text. Discord renders
 * `</name sub:ID>` as a link that fills in the command, but the IDs are only known once
 * the commands are registered, so the catalog is refreshed after each sync. Until it
 * loads, or for a name it does not know, text keeps its plain `/name`.
 */
import type { Client } from "discord.js";
import {
  buildCommandCatalog,
  findCatalogMention,
  type ICommandCatalog,
} from "../config/previewCommandCatalog.js";
import { TEST_GUILD_ID } from "../config/testMode.js";
import { logError } from "../utilities/LogUtils.js";

let catalog: ICommandCatalog = { commands: [] };

const WORD = "[-_\\p{L}\\p{N}]{1,32}";
const PATH = `${WORD}(?: ${WORD}){0,2}`;
/** `/name`, not inside a URL, a path like `a/b`, or mention markup that is already built. */
const COMMAND_REFERENCE = new RegExp(`(?<![\\w/:.<>-])\\/(${PATH})`, "gu");
/** Code blocks and inline code, captured so `split` keeps them at the odd indexes. */
const CODE_SEGMENT = /(```[\s\S]*?```|`[^`\n]+`)/;
/** Inline code holding nothing but a command path, like `` `/collection add` ``. */
const BARE_COMMAND_CODE = new RegExp(`^\`\\/(${PATH})\`$`, "u");

/**
 * This bot's chat input commands, global and in the test guild, with their IDs. A test
 * guild command wins a name it shares with a global one, since that is the one it runs.
 */
export async function fetchCommandCatalog(client: Client): Promise<ICommandCatalog> {
  if (!client.application) throw new Error("The client application is not ready.");
  const { commands } = client.application;
  const [globalCommands, guildCommands] = await Promise.all([
    commands.fetch(),
    TEST_GUILD_ID ? commands.fetch({ guildId: TEST_GUILD_ID }) : undefined,
  ]);
  return buildCommandCatalog([
    ...globalCommands.values(),
    ...(guildCommands?.values() ?? []),
  ]);
}

/** Reloads the command IDs. A failure is logged and keeps the IDs already loaded. */
export async function refreshCommandMentions(client: Client): Promise<void> {
  try {
    catalog = await fetchCommandCatalog(client);
  } catch (error) {
    logError("CommandMentions.refresh", error);
  }
}

/** The command IDs loaded by the last {@link refreshCommandMentions}. */
export function getCommandMentionCatalog(): ICommandCatalog {
  return catalog;
}

/** Replaces the loaded command IDs. Tests use it in place of a client. */
export function setCommandMentionCatalog(next: ICommandCatalog): void {
  catalog = next;
}

function toWords(path: string): string[] {
  return path.trim().replace(/^\//, "").split(/\s+/);
}

/**
 * The clickable mention for a command path such as `"collection add"`, or null when the
 * ID is unknown or the path is not one Discord can open.
 */
export function findCommandMention(path: string): string | null {
  const words = toWords(path);
  const found = findCatalogMention(catalog, words);
  return found?.wordCount === words.length ? found.mention : null;
}

/** {@link findCommandMention}, falling back to the plain `/collection add`. */
export function commandMention(path: string): string {
  return findCommandMention(path) ?? `/${toWords(path).join(" ")}`;
}

function linkPlainText(text: string): string {
  return text.replace(COMMAND_REFERENCE, (match: string, path: string) => {
    const words = path.split(" ");
    const found = findCatalogMention(catalog, words);
    if (!found) return match;
    return [found.mention, ...words.slice(found.wordCount)].join(" ");
  });
}

function linkCode(segment: string): string {
  const bare = BARE_COMMAND_CODE.exec(segment);
  if (!bare) return segment;
  return findCommandMention(bare[1]) ?? segment;
}

/**
 * `text` with each `/command` reference the catalog knows turned into a mention. Code
 * keeps its syntax for copying, except inline code that holds only a command path.
 */
export function linkCommandMentions(text: string): string {
  if (!catalog.commands.length) return text;
  return text
    .split(CODE_SEGMENT)
    .map((segment, index) => (index % 2 ? linkCode(segment) : linkPlainText(segment)))
    .join("");
}
