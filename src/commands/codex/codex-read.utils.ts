import { MessageFlags, type ButtonInteraction } from "discord.js";
import { codexView } from "../../functions/CodexViews.js";
import {
  buildErrorReply,
  type IComponentsV2View,
} from "../../functions/ComponentsV2Utils.js";
import {
  replaceWithPrivateReply,
  safeDeferUpdate,
  safeEditReply,
  safeFollowUpIfSettled,
  safeReply,
  type AnyRepliable,
} from "../../functions/InteractionUtils.js";
import { pageTurnRefusal, type CodexReadResult } from "../../services/CodexReading.js";

// Shared by /codex lore read and /codex history (bot#1563): where a reading result goes.
// A page goes where it was asked to; a notice or an error is only ever for the member.

/** The member's own copy of a notice or an error. */
function privately(result: Exclude<CodexReadResult, { page: IComponentsV2View }>): object {
  if ("error" in result) return buildErrorReply(result.error, true);
  return { ...result.notice, flags: result.notice.flags | MessageFlags.Ephemeral };
}

/** A view only the member sees, as a reply of its own (a button they may not use, say). */
async function replyPrivately(
  interaction: AnyRepliable,
  view: IComponentsV2View,
): Promise<void> {
  await safeReply(interaction, { ...view, flags: view.flags | MessageFlags.Ephemeral });
}

/**
 * A page button's first steps: its parsed `target`, once the update is deferred. Null, with
 * the member answered privately, when the button is out of date or isn't theirs to press
 * (or when the defer failed).
 */
export async function openPageButton<T extends { ownerId: string }>(
  interaction: ButtonInteraction,
  target: T | null,
): Promise<T | null> {
  if (!target) {
    await replyPrivately(interaction, codexView("This button is out of date."));
    return null;
  }
  const refusal = pageTurnRefusal(target, interaction.user.id);
  if (refusal) {
    await replyPrivately(interaction, refusal);
    return null;
  }
  return (await safeDeferUpdate(interaction)) ? target : null;
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
  } else if (!isPublic) {
    await safeEditReply(interaction, "error" in result ? privately(result) : result.notice);
  } else {
    await replaceWithPrivateReply(interaction, privately(result));
  }
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
