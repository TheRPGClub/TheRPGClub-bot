import { userMention } from "discord.js";
import { BOT_DEV_PING_USER_ID } from "../config/users.js";
import {
  DISCORD_MESSAGE_CONTENT_MAX,
  FEEDBACK_NOTICE_TITLE_MAX,
} from "../config/feedback.js";
import { truncateWithEllipsis } from "../utilities/ValidationUtils.js";

/** The bot dev channel ping for new Feedback, from /feedback or the website. */
export function buildFeedbackSubmittedPing(authorLabel: string): string {
  return `${userMention(BOT_DEV_PING_USER_ID)} ${authorLabel} has submitted a suggestion!`;
}

function authorMention(createdBy: string | null): string {
  return createdBy ? userMention(createdBy) : "Unknown user";
}

/** The GameDB updates post telling the author their Feedback was approved. */
export function buildFeedbackApprovedNotice(
  createdBy: string | null,
  issueNumber: number,
  issueUrl: string,
): string {
  return `${authorMention(createdBy)} Your suggestion was accepted and logged as GitHub issue ` +
    `#${issueNumber}: ${issueUrl}`;
}

/**
 * The GameDB updates post telling the author their Feedback was rejected, and why. The
 * title and reason are cut to fit one Discord message.
 */
export function buildFeedbackRejectedNotice(
  createdBy: string | null,
  title: string,
  reason: string,
): string {
  const head = `${authorMention(createdBy)} Your suggestion ` +
    `"${truncateWithEllipsis(title, FEEDBACK_NOTICE_TITLE_MAX)}" was not accepted. Reason: `;
  return head + truncateWithEllipsis(reason, DISCORD_MESSAGE_CONTENT_MAX - head.length);
}
