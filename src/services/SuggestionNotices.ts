import { userMention } from "discord.js";
import { BOT_DEV_PING_USER_ID } from "../config/users.js";

/** The bot dev channel ping for a new Suggestion, from /suggestion or the website. */
export function buildSuggestionSubmittedPing(authorLabel: string): string {
  return `${userMention(BOT_DEV_PING_USER_ID)} ${authorLabel} has submitted a suggestion!`;
}

function authorMention(createdBy: string | null): string {
  return createdBy ? userMention(createdBy) : "Unknown user";
}

/** The GameDB updates post telling the author their Suggestion was approved. */
export function buildSuggestionApprovedNotice(
  createdBy: string | null,
  issueNumber: number,
  issueUrl: string,
): string {
  return `${authorMention(createdBy)} Your suggestion was accepted and logged as GitHub issue ` +
    `#${issueNumber}: ${issueUrl}`;
}

/** The GameDB updates post telling the author their Suggestion was rejected, and why. */
export function buildSuggestionRejectedNotice(
  createdBy: string | null,
  title: string,
  reason: string,
): string {
  return `${authorMention(createdBy)} Your suggestion "${title}" was not accepted. ` +
    `Reason: ${reason}`;
}
