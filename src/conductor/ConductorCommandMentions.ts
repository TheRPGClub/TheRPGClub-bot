/**
 * Turns the preview bot's command catalog into the clickable mentions a run shows
 * above each slash command step. Resolved once when the run starts and saved with it.
 */
import {
  PREVIEW_COMMANDS_ATTACHMENT_NAME,
  findCatalogMention,
  parseCommandCatalog,
  type ICommandCatalog,
} from "../config/previewCommandCatalog.js";
import type { ITestStep } from "./TestPlanParser.js";

/** Where to download the catalog an announcement carries, if it carries one. */
export function catalogAttachmentUrl(
  attachments: readonly { name: string; url: string }[],
): string | null {
  return attachments.find((entry) => entry.name === PREVIEW_COMMANDS_ATTACHMENT_NAME)?.url
    ?? null;
}

/**
 * The clickable mention for a slash command step, or null for anything else. The first
 * line's leading words are matched exactly against the catalog, and the markup is built
 * only from catalog entries, never from the step text. A command with subcommands gets a
 * mention only when the step names one, since Discord cannot open its bare name.
 */
export function resolveCommandMention(
  catalog: ICommandCatalog,
  stepCommand: string,
): string | null {
  const firstLine = stepCommand.trimStart().split("\n", 1)[0];
  if (!firstLine.startsWith("/")) return null;
  return findCatalogMention(catalog, firstLine.slice(1).split(/\s+/))?.mention ?? null;
}

/**
 * The mention for each step whose command the catalog knows, by step number. A catalog
 * that does not parse gives none, so every step keeps only its code block.
 */
export function resolveStepMentions(
  catalogText: string,
  steps: readonly ITestStep[],
): Record<number, string> {
  const catalog = parseCommandCatalog(catalogText);
  const mentions: Record<number, string> = {};
  if (!catalog) return mentions;
  for (const step of steps) {
    const mention = resolveCommandMention(catalog, step.command);
    if (mention) mentions[step.number] = mention;
  }
  return mentions;
}
