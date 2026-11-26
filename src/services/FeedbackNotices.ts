import { userMention } from "discord.js";
import { BOT_DEV_PING_USER_ID } from "../config/users.js";
import {
  DISCORD_MESSAGE_CONTENT_MAX,
  FEEDBACK_NOTICE_TITLE_MAX,
  feedbackKindNoun,
  isFeedbackKind,
} from "../config/feedback.js";
import { feedbackBoardUrl } from "../config/website.js";
import { truncateWithEllipsis } from "../utilities/ValidationUtils.js";

/**
 * The bot dev channel ping for new Feedback, from /feedback or the website, naming its
 * kind ("has submitted a bug report!"); plain "feedback" for an unknown kind.
 */
export function buildFeedbackSubmittedPing(authorLabel: string, kind: unknown): string {
  const what = isFeedbackKind(kind) ? `a ${feedbackKindNoun(kind)}` : "feedback";
  return `${userMention(BOT_DEV_PING_USER_ID)} ${authorLabel} has submitted ${what}!`;
}

function authorMention(createdBy: string | null): string {
  return createdBy ? userMention(createdBy) : "Unknown user";
}

function noticeTitle(title: string): string {
  return `"${truncateWithEllipsis(title, FEEDBACK_NOTICE_TITLE_MAX)}"`;
}

/** The GameDB updates post telling the author their Feedback was approved. */
export function buildFeedbackApprovedNotice(
  createdBy: string | null,
  kind: unknown,
  issueNumber: number,
  issueUrl: string,
): string {
  return `${authorMention(createdBy)} Your ${feedbackKindNoun(kind)} was accepted and logged ` +
    `as GitHub issue #${issueNumber}: ${issueUrl}`;
}

/**
 * The GameDB updates post telling the author their Feedback was rejected, and why. The
 * title and reason are cut to fit one Discord message.
 */
export function buildFeedbackRejectedNotice(
  createdBy: string | null,
  kind: unknown,
  title: string,
  reason: string,
): string {
  const head = `${authorMention(createdBy)} Your ${feedbackKindNoun(kind)} ` +
    `${noticeTitle(title)} was not accepted. Reason: `;
  return head + truncateWithEllipsis(reason, DISCORD_MESSAGE_CONTENT_MAX - head.length);
}

/**
 * The GameDB updates post telling the author their Feedback was marked a Duplicate, linking
 * the original on the Feedback Board. Authors never upvote their own Feedback, so it is the
 * Duplicate's upvotes, not theirs, that moved.
 */
export function buildFeedbackDuplicateNotice(
  createdBy: string | null,
  kind: unknown,
  title: string,
  originalId: number,
  originalTitle: string,
): string {
  return `${authorMention(createdBy)} Your ${feedbackKindNoun(kind)} ${noticeTitle(title)} ` +
    `was marked a duplicate of ${noticeTitle(originalTitle)}. Its upvotes moved there. ` +
    feedbackBoardUrl(originalId);
}

/** The GameDB updates post telling the author their Feedback is Done (its issue closed). */
export function buildFeedbackDoneNotice(
  createdBy: string | null,
  kind: unknown,
  title: string,
  issueNumber: number,
  issueUrl: string,
): string {
  return `${authorMention(createdBy)} Your ${feedbackKindNoun(kind)} ${noticeTitle(title)} ` +
    `is done! 🎉 GitHub issue #${issueNumber}: ${issueUrl}`;
}
