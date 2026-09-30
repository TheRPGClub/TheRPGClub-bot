/**
 * Turns the preview bot's command catalog into the clickable mentions a run shows
 * above each slash command step. Resolved once when the run starts and saved with it.
 */
import {
  PREVIEW_COMMANDS_ATTACHMENT_NAME,
  parseCommandCatalog,
  resolveCommandMention,
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
