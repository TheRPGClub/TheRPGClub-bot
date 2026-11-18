import { MessageFlags } from "discord.js";
import { buildErrorReply } from "../../functions/ComponentsV2Utils.js";
import {
  safeEditReply,
  safeFollowUpIfSettled,
  safeReply,
  type AnyRepliable,
} from "../../functions/InteractionUtils.js";
import type { CodexReadResult } from "../../services/CodexReading.js";
import type { ICodexView } from "../../services/CodexFunFacts.js";
import { logError } from "../../utilities/LogUtils.js";

// Shared by /codex lore read and /codex history (bot#1563): where a reading result goes.
// A page goes where it was asked to; a notice or an error is only ever for the member.

/** The member's own copy of a notice or an error. */
function privately(result: Exclude<CodexReadResult, { page: ICodexView }>): object {
  if ("error" in result) return buildErrorReply(result.error, true);
  return { ...result.notice, flags: result.notice.flags | MessageFlags.Ephemeral };
}

/** A view only the member sees, as a reply of its own (a button they may not use, say). */
export async function replyPrivately(
  interaction: AnyRepliable,
  view: ICodexView,
): Promise<void> {
  await safeReply(interaction, { ...view, flags: view.flags | MessageFlags.Ephemeral });
}

/**
 * Fills a deferred slash command reply. A public reply that turned out to be a notice or
 * an error is deleted, and the member gets it privately instead.
 */
export async function showCommandResult(
  interaction: AnyRepliable,
  result: CodexReadResult,
  isPublic: boolean,
): Promise<void> {
  if ("page" in result) {
    await safeEditReply(interaction, result.page);
    return;
  }
  if (!isPublic) {
    await safeEditReply(interaction, "error" in result ? privately(result) : result.notice);
    return;
  }
  try {
    await interaction.deleteReply();
  } catch (err: unknown) {
    logError("CodexReading.showCommandResult", err);
  }
  await safeFollowUpIfSettled(interaction, privately(result));
}

/**
 * A page button, after a deferred update: a page replaces the message it was on (or, to
 * post it, goes to the channel as a new message); a notice or an error goes to the member.
 */
export async function showButtonResult(
  interaction: AnyRepliable,
  result: CodexReadResult,
  postAsNew: boolean,
): Promise<void> {
  if (!("page" in result)) {
    await safeFollowUpIfSettled(interaction, privately(result));
  } else if (postAsNew) {
    await safeFollowUpIfSettled(interaction, result.page);
  } else {
    await safeEditReply(interaction, result.page);
  }
}
