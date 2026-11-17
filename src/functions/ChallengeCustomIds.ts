import {
  CHALLENGE_EDIT_PREFIX,
  CHALLENGE_LIST_PREFIX,
  CHALLENGE_RUN_PREFIX,
  CHALLENGE_SANTA_PICK_PREFIX,
  CHALLENGE_SANTA_PREFIX,
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

/**
 * A member's Run actions: `start` takes a Challenge ID (the post's Start a Run button);
 * `abandon`, `delete` and `keep` take a Run ID (confirming, or keeping it after all).
 * Each custom ID is `<prefix>:<action>:<ID>`; the clicking member is who acts.
 */
export const CHALLENGE_RUN_ACTIONS = ["start", "abandon", "delete", "keep"] as const;

export type ChallengeRunAction = (typeof CHALLENGE_RUN_ACTIONS)[number];

export function buildChallengeRunId(action: ChallengeRunAction, id: number): string {
  return `${CHALLENGE_RUN_PREFIX}:${action}:${id}`;
}

export function parseChallengeRunId(
  customId: string,
): { action: ChallengeRunAction; id: number } | null {
  const [prefix, action, raw, ...rest] = customId.split(":");
  const id = Number(raw);
  if (prefix !== CHALLENGE_RUN_PREFIX || rest.length || !Number.isInteger(id) || id < 1) {
    return null;
  }
  const known = (CHALLENGE_RUN_ACTIONS as readonly string[]).includes(action ?? "");
  return known ? { action: action as ChallengeRunAction, id } : null;
}

/**
 * Secret Santa sign-up actions, each on an Edition ID: `join` (the posts' Sign up button),
 * `leave` (asks first once the draw is done), `withdraw` (leaving after the draw, confirmed)
 * and `stay` (keeping the place after all). Each custom ID is `<prefix>:<action>:<ID>`; the
 * clicking member is who acts.
 */
export const CHALLENGE_SANTA_ACTIONS = ["join", "leave", "withdraw", "stay"] as const;

export type ChallengeSantaAction = (typeof CHALLENGE_SANTA_ACTIONS)[number];

export function buildChallengeSantaId(action: ChallengeSantaAction, editionId: number): string {
  return `${CHALLENGE_SANTA_PREFIX}:${action}:${editionId}`;
}

export function parseChallengeSantaId(
  customId: string,
): { action: ChallengeSantaAction; editionId: number } | null {
  const [prefix, action, raw, ...rest] = customId.split(":");
  const editionId = Number(raw);
  if (
    prefix !== CHALLENGE_SANTA_PREFIX || rest.length ||
    !Number.isInteger(editionId) || editionId < 1
  ) {
    return null;
  }
  const known = (CHALLENGE_SANTA_ACTIONS as readonly string[]).includes(action ?? "");
  return known ? { action: action as ChallengeSantaAction, editionId } : null;
}

/**
 * A Santa's pick, on an Edition: `open` (the reminder DM's Pick now: a new private reply),
 * `page` (another page, or the whole list again), `search` (opens the search modal),
 * `search-modal` (its submit) and `choose` (the select: records the pick). Each custom ID
 * is `<prefix>:<action>:<Edition ID>:<page>[:<search>]`, the search last so it may hold
 * colons; the clicking member is the Santa.
 */
export const SANTA_PICK_ACTIONS = ["open", "page", "search", "search-modal", "choose"] as const;

export type SantaPickAction = (typeof SANTA_PICK_ACTIONS)[number];

export interface ISantaPickTarget {
  action: SantaPickAction;
  editionId: number;
  /** 1-based; 0 only on a disabled Previous button. */
  page: number;
  /** The backlog search, "" for the whole list. */
  query: string;
}

/** Search words kept in a custom ID, so it stays within Discord's 100 characters. */
export const SANTA_PICK_QUERY_MAX = 40;

export function buildSantaPickId(
  action: SantaPickAction,
  editionId: number,
  page = 1,
  query = "",
): string {
  const parts = [CHALLENGE_SANTA_PICK_PREFIX, action, editionId, page];
  const search = query.slice(0, SANTA_PICK_QUERY_MAX);
  return (search ? [...parts, search] : parts).join(":");
}

export function parseSantaPickId(customId: string): ISantaPickTarget | null {
  const [prefix, action, rawEdition, rawPage, ...rest] = customId.split(":");
  const editionId = Number(rawEdition);
  const page = Number(rawPage);
  if (
    prefix !== CHALLENGE_SANTA_PICK_PREFIX ||
    !Number.isInteger(editionId) || editionId < 1 || !Number.isInteger(page) || page < 1
  ) {
    return null;
  }
  const known = (SANTA_PICK_ACTIONS as readonly string[]).includes(action ?? "");
  return known
    ? { action: action as SantaPickAction, editionId, page, query: rest.join(":") }
    : null;
}
