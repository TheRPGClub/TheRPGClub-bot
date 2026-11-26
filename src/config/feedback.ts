/**
 * The Feedback Board (spec api#498): its Feature key and the kinds of Feedback a member
 * files (RpgClubFeedback::KINDS in the API; GLOSSARY.md "Feedback").
 */
export const FEEDBACK_FEATURE_KEY = "feedback";

/** Custom id prefix for /feedback's kind picker and per-kind modals. */
export const FEEDBACK_CUSTOM_ID_PREFIX = "feedback-";

export const FEEDBACK_KINDS = [
  {
    value: "feature_request",
    label: "Feature Request",
    noun: "feature request",
    description: "Something the bot or website does not do yet",
  },
  {
    value: "suggestion",
    label: "Suggestion",
    noun: "suggestion",
    description: "A change to something the bot or website already does",
  },
  {
    value: "bug_report",
    label: "Bug Report",
    noun: "bug report",
    description: "Something that is broken",
  },
] as const;

export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]["value"];

export function isFeedbackKind(value: unknown): value is FeedbackKind {
  return FEEDBACK_KINDS.some((kind) => kind.value === value);
}

/** The kind's name in a sentence ("bug report"); "feedback" for an unknown kind. */
export function feedbackKindNoun(kind: unknown): string {
  return FEEDBACK_KINDS.find((entry) => entry.value === kind)?.noun ?? "feedback";
}

/** The kind's title-case name ("Bug Report"). */
export function feedbackKindLabel(kind: FeedbackKind): string {
  return FEEDBACK_KINDS.find((entry) => entry.value === kind)?.label ?? "Feedback";
}

/** Where a Bug Report happened (RpgClubFeedback::WHERES in the API). */
export const FEEDBACK_WHERES = [
  { value: "bot", label: "Bot" },
  { value: "website", label: "Website" },
] as const;

export type FeedbackWhere = (typeof FEEDBACK_WHERES)[number]["value"];

export function isFeedbackWhere(value: unknown): value is FeedbackWhere {
  return FEEDBACK_WHERES.some((where) => where.value === value);
}

/** Longest Feedback title an outcome post quotes (the API caps neither title nor reason). */
export const FEEDBACK_NOTICE_TITLE_MAX = 200;
/** Discord's limit on a message's content, which an outcome post must fit. */
export const DISCORD_MESSAGE_CONTENT_MAX = 2000;
