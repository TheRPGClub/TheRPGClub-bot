import {
  CODEX_FUN_FACT_PREFIX,
  CODEX_HISTORY_PREFIX,
  CODEX_LORE_PREFIX,
} from "../config/customIdPrefixes.js";
import { parsePositiveId } from "./CustomIdUtils.js";

// Club Codex custom IDs (spec api#397). Each holds what it acts on, and the clicking member
// is who acts, so every button still works after a bot restart.

/**
 * The /codex fun-fact delete question's buttons, each on a Fun Fact ID: `delete` (deletes
 * it) and `keep` (leaves it be). Each custom ID is `<prefix>:<action>:<ID>`.
 */
export const CODEX_FUN_FACT_ACTIONS = ["delete", "keep"] as const;

export type CodexFunFactAction = (typeof CODEX_FUN_FACT_ACTIONS)[number];

export function buildCodexFunFactId(action: CodexFunFactAction, factId: number): string {
  return `${CODEX_FUN_FACT_PREFIX}:${action}:${factId}`;
}

export function parseCodexFunFactId(
  customId: string,
): { action: CodexFunFactAction; factId: number } | null {
  const [prefix, action, raw, ...rest] = customId.split(":");
  const factId = parsePositiveId(raw);
  if (prefix !== CODEX_FUN_FACT_PREFIX || rest.length || factId === null) return null;
  const known = (CODEX_FUN_FACT_ACTIONS as readonly string[]).includes(action ?? "");
  return known ? { action: action as CodexFunFactAction, factId } : null;
}

/** The Club Codex entry ID an autocompleted option holds, or null when it is not one. */
export const parseCodexEntryOption = parsePositiveId;

/** Who a /codex lore read or /codex history reply shows to: the member alone, or the channel. */
export type CodexReplyVisibility = "private" | "public";

const VISIBILITIES: readonly string[] = ["private", "public"];

/** A reading button's owner (a Discord ID) and visibility, or null when either is not one. */
function parseOwnerAndVisibility(
  ownerId: string | undefined,
  visibility: string | undefined,
): { ownerId: string; visibility: CodexReplyVisibility } | null {
  if (!/^\d+$/.test(ownerId ?? "") || !VISIBILITIES.includes(visibility ?? "")) return null;
  return { ownerId: ownerId as string, visibility: visibility as CodexReplyVisibility };
}

/**
 * /codex lore read's buttons: `page` turns to a page in place, and `post` posts the page
 * publicly. Each holds the Lore Entry, the page (from 1), the member who ran the command
 * (the only one the buttons answer) and the reply's visibility, so they work after a
 * restart. Each custom ID is `<prefix>:<action>:<entry ID>:<page>:<owner>:<visibility>`.
 */
export const CODEX_LORE_ACTIONS = ["page", "post"] as const;

export type CodexLoreAction = (typeof CODEX_LORE_ACTIONS)[number];

export interface ICodexLoreTarget {
  action: CodexLoreAction;
  entryId: number;
  page: number;
  ownerId: string;
  visibility: CodexReplyVisibility;
}

export function buildCodexLoreId(target: ICodexLoreTarget): string {
  const { action, entryId, page, ownerId, visibility } = target;
  return `${CODEX_LORE_PREFIX}:${action}:${entryId}:${page}:${ownerId}:${visibility}`;
}

export function parseCodexLoreId(customId: string): ICodexLoreTarget | null {
  const [prefix, action, rawEntry, rawPage, ownerId, visibility, ...rest] = customId.split(":");
  const entryId = parsePositiveId(rawEntry);
  const page = parsePositiveId(rawPage);
  const reader = parseOwnerAndVisibility(ownerId, visibility);
  if (
    prefix !== CODEX_LORE_PREFIX || rest.length || entryId === null || page === null ||
    reader === null || !(CODEX_LORE_ACTIONS as readonly string[]).includes(action ?? "")
  ) {
    return null;
  }
  return { action: action as CodexLoreAction, entryId, page, ...reader };
}

/**
 * /codex history's Newer and Older buttons: the page to show (from 1, newest first), the
 * member who ran the command and the reply's visibility. Each custom ID is
 * `<prefix>:page:<page>:<owner>:<visibility>`.
 */
export interface ICodexHistoryTarget {
  page: number;
  ownerId: string;
  visibility: CodexReplyVisibility;
}

export function buildCodexHistoryId(target: ICodexHistoryTarget): string {
  return `${CODEX_HISTORY_PREFIX}:page:${target.page}:${target.ownerId}:${target.visibility}`;
}

export function parseCodexHistoryId(customId: string): ICodexHistoryTarget | null {
  const [prefix, action, rawPage, ownerId, visibility, ...rest] = customId.split(":");
  const page = parsePositiveId(rawPage);
  const reader = parseOwnerAndVisibility(ownerId, visibility);
  if (
    prefix !== CODEX_HISTORY_PREFIX || action !== "page" || rest.length || page === null ||
    reader === null
  ) {
    return null;
  }
  return { page, ...reader };
}
