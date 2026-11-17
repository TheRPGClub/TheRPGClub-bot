import {
  CHALLENGE_EDIT_PREFIX,
  CHALLENGE_LIST_PREFIX,
  CHALLENGE_RUN_PREFIX,
  CHALLENGE_SHOW_PREFIX,
  CHALLENGE_SLOTS_PREFIX,
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
export const CHALLENGE_RUN_ACTIONS = [
  "start", "abandon", "delete", "keep",
  // A birth-year Run without a Birth Date: the button that asks for it, and its modal.
  "birth", "birth-modal",
] as const;

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
 * A Slots Run's actions (bot#1550), each `<prefix>:<action>:<IDs...>`; the clicking
 * member is who acts:
 * - `decade` (Run ID, decade, `n` new private reply or `u` update): a decade page;
 * - `decades` (Run ID): the select of decades, for a Run of more than 5;
 * - `runs` (Challenge ID): the by-member select opening a member's Run;
 * - `move` and `pick` (Run ID): the buttons that start moving a game or picking past play;
 * - `move-game` and `pick-play` (Run ID): the selects of a game to move or play to pick;
 * - `move-year` (Run ID, game ID) and `pick-year` (Run ID, Game Completion ID): the
 *   selects of the year.
 */
export const CHALLENGE_SLOTS_ACTIONS = [
  "decade", "decades", "runs", "move", "pick", "move-game", "pick-play", "move-year",
  "pick-year",
] as const;

export type ChallengeSlotsAction = (typeof CHALLENGE_SLOTS_ACTIONS)[number];

const SLOTS_ID_COUNTS: Readonly<Record<ChallengeSlotsAction, number>> = {
  "decade": 2,
  "decades": 1,
  "runs": 1,
  "move": 1,
  "pick": 1,
  "move-game": 1,
  "pick-play": 1,
  "move-year": 2,
  "pick-year": 2,
};

export interface IChallengeSlotsTarget {
  action: ChallengeSlotsAction;
  ids: number[];
  /** `decade` only: a new private reply (from a post) or an update of the view. */
  reply?: "new" | "update";
}

export function buildChallengeSlotsId(target: IChallengeSlotsTarget): string {
  const parts: (string | number)[] = [CHALLENGE_SLOTS_PREFIX, target.action, ...target.ids];
  if (target.action === "decade") parts.push(target.reply === "new" ? "n" : "u");
  return parts.join(":");
}

export function parseChallengeSlotsId(customId: string): IChallengeSlotsTarget | null {
  const [prefix, action, ...rest] = customId.split(":");
  if (prefix !== CHALLENGE_SLOTS_PREFIX) return null;
  if (!(CHALLENGE_SLOTS_ACTIONS as readonly string[]).includes(action ?? "")) return null;
  const known = action as ChallengeSlotsAction;
  let reply: IChallengeSlotsTarget["reply"];
  if (known === "decade") {
    const flag = rest.pop();
    if (flag !== "n" && flag !== "u") return null;
    reply = flag === "n" ? "new" : "update";
  }
  const ids = rest.map(Number);
  if (ids.length !== SLOTS_ID_COUNTS[known] || ids.some((id) => !Number.isInteger(id) || id < 1)) {
    return null;
  }
  return reply ? { action: known, ids, reply } : { action: known, ids };
}
