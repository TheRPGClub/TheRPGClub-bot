import type { ChatInputCommandInteraction, Interaction } from "discord.js";

import { buildErrorReply } from "./ComponentsV2Utils.js";
import { safeFollowUpIfSettled } from "./InteractionUtils.js";
import { buildAnyErrorMessage } from "../utilities/ApiErrorUtils.js";
import { logError } from "../utilities/LogUtils.js";

export function getSlashCommandPath(interaction: ChatInputCommandInteraction): string {
  const commandPath: string[] = [interaction.commandName];
  const subcommandGroup = interaction.options.getSubcommandGroup(false);
  const subcommand = interaction.options.getSubcommand(false);
  if (subcommandGroup) commandPath.push(subcommandGroup);
  if (subcommand) commandPath.push(subcommand);
  return commandPath.join(" ");
}

/** Names the command or component an interaction came from, for logs and error replies. */
export function describeInteraction(interaction: Interaction): string {
  if (interaction.isAutocomplete()) return `/${interaction.commandName} autocomplete`;
  if (interaction.isChatInputCommand()) return `/${getSlashCommandPath(interaction)}`;
  if (interaction.isCommand()) return interaction.commandName;
  return interaction.customId;
}

/**
 * Last-resort handler for an error a command or component handler did not catch. It logs
 * the failure with its source and, when the user has not been answered yet, replies
 * ephemerally so they see the error instead of "This interaction failed". A deferred
 * interaction gets a follow-up, which never overwrites a message a component deferUpdate
 * left in place.
 */
export async function handleInteractionError(
  interaction: Interaction,
  err: unknown,
): Promise<void> {
  const source: string = describeInteraction(interaction);
  logError(`[Interaction] ${source} failed`, err);
  if (!interaction.isRepliable() || interaction.replied) return;

  const message: string = buildAnyErrorMessage(`Something went wrong running ${source}`, err);
  try {
    await safeFollowUpIfSettled(interaction, buildErrorReply(message, true));
  } catch (replyErr: unknown) {
    logError(`[Interaction] ${source} error reply failed`, replyErr);
  }
}
