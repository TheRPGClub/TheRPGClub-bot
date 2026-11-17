import {
  CHALLENGE_EDIT_PREFIX,
  CHALLENGE_LIST_PREFIX,
  CHALLENGE_SHOW_PREFIX,
  CHALLENGE_WIZARD_PREFIX,
} from "../config/customIdPrefixes.js";

// The custom IDs of every /challenge component. Each carries all it needs (a Challenge ID
// and page, or a wizard session ID), so a click still works after a restart.

export type ChallengeShowView = "game" | "member";

export interface IChallengeShowTarget {
  challengeId: number;
  view: ChallengeShowView;
  /** 1-based. */
  page: number;
  /** "new" answers with a new private reply (from a post); "update" edits the view. */
  reply: "new" | "update";
}

export function buildChallengeShowId(target: IChallengeShowTarget): string {
  return [
    CHALLENGE_SHOW_PREFIX,
    target.challengeId,
    target.view === "game" ? "g" : "m",
    target.page,
    target.reply === "new" ? "n" : "u",
  ].join(":");
}

export function parseChallengeShowId(customId: string): IChallengeShowTarget | null {
  const match = new RegExp(`^${CHALLENGE_SHOW_PREFIX}:(\\d+):([gm]):(\\d+):([nu])$`)
    .exec(customId);
  if (!match) return null;
  const challengeId = Number(match[1]);
  const page = Number(match[3]);
  if (challengeId < 1 || page < 1) return null;
  return {
    challengeId,
    view: match[2] === "g" ? "game" : "member",
    page,
    reply: match[4] === "n" ? "new" : "update",
  };
}

/** The /challenge list filter: Open now, Closed now, or every Challenge. */
export type ChallengeListFilter = "open" | "closed" | "all";

export function buildChallengeListId(filter: ChallengeListFilter, page: number): string {
  return `${CHALLENGE_LIST_PREFIX}:${filter}:${page}`;
}

export function parseChallengeListId(
  customId: string,
): { filter: ChallengeListFilter; page: number } | null {
  const match = new RegExp(`^${CHALLENGE_LIST_PREFIX}:(open|closed|all):(\\d+)$`)
    .exec(customId);
  if (!match || Number(match[2]) < 1) return null;
  return { filter: match[1] as ChallengeListFilter, page: Number(match[2]) };
}

/** The wizard's actions; each custom ID is `<prefix>:<action>:<session ID>`. */
export const CHALLENGE_WIZARD_ACTIONS = [
  // Buttons that open a modal.
  "basics", "settings", "include",
  // Modals.
  "basics-modal", "settings-modal", "include-modal",
  // Selects.
  "sources", "exclude", "include-pick",
  // Buttons.
  "preview", "page-prev", "page-next", "save", "cancel",
] as const;

export type ChallengeWizardAction = (typeof CHALLENGE_WIZARD_ACTIONS)[number];

export function buildChallengeWizardId(action: ChallengeWizardAction, sessionId: string): string {
  return `${CHALLENGE_WIZARD_PREFIX}:${action}:${sessionId}`;
}

export function parseChallengeWizardId(
  customId: string,
): { action: ChallengeWizardAction; sessionId: string } | null {
  const [prefix, action, sessionId, ...rest] = customId.split(":");
  if (prefix !== CHALLENGE_WIZARD_PREFIX || !sessionId || rest.length) return null;
  const known = (CHALLENGE_WIZARD_ACTIONS as readonly string[]).includes(action ?? "");
  return known ? { action: action as ChallengeWizardAction, sessionId } : null;
}

/** The edit panel's actions; each custom ID is `<prefix>:<action>:<Challenge ID>`. */
export const CHALLENGE_EDIT_ACTIONS = [
  "details", "details-modal", "rules", "hide", "unhide", "host", "host-club",
] as const;

export type ChallengeEditAction = (typeof CHALLENGE_EDIT_ACTIONS)[number];

export function buildChallengeEditId(action: ChallengeEditAction, challengeId: number): string {
  return `${CHALLENGE_EDIT_PREFIX}:${action}:${challengeId}`;
}

export function parseChallengeEditId(
  customId: string,
): { action: ChallengeEditAction; challengeId: number } | null {
  const [prefix, action, id, ...rest] = customId.split(":");
  const challengeId = Number(id);
  if (prefix !== CHALLENGE_EDIT_PREFIX || rest.length || !Number.isInteger(challengeId)) {
    return null;
  }
  const known = (CHALLENGE_EDIT_ACTIONS as readonly string[]).includes(action ?? "");
  return known && challengeId > 0
    ? { action: action as ChallengeEditAction, challengeId }
    : null;
}
