import {
  GAMEDB_LIST_ACTION_PREFIX,
  GAME_LIST_ADD_PREFIX,
  GAME_LIST_PAGE_PREFIX,
} from "../config/customIdPrefixes.js";
import { parsePositiveId } from "./CustomIdUtils.js";

// Game List custom IDs (spec api#442, bot#1568). Each holds what it acts on, and the
// clicking member is who acts (the API reads for them), so every one still works after a
// bot restart.

/** /list view's Previous and Next: `<prefix>:<list ID>:<page>`. */
export function buildGameListPageId(listId: number, page: number): string {
  return `${GAME_LIST_PAGE_PREFIX}:${listId}:${page}`;
}

export function parseGameListPageId(customId: string): { listId: number; page: number } | null {
  const [prefix, rawList, rawPage, ...rest] = customId.split(":");
  const listId = parsePositiveId(rawList);
  const page = parsePositiveId(rawPage);
  if (prefix !== GAME_LIST_PAGE_PREFIX || rest.length || listId === null || page === null) {
    return null;
  }
  return { listId, page };
}

/** The game view's Add to a Game List button: `gamedb-action:list:<game ID>`. */
export function buildGameDbListActionId(gameId: number): string {
  return `${GAMEDB_LIST_ACTION_PREFIX}${gameId}`;
}

/** The select of the member's lists that button opens: `<prefix>:<game ID>`. */
export function buildGameListAddId(gameId: number): string {
  return `${GAME_LIST_ADD_PREFIX}:${gameId}`;
}

export function parseGameListAddId(customId: string): number | null {
  const [prefix, rawGame, ...rest] = customId.split(":");
  if (prefix !== GAME_LIST_ADD_PREFIX || rest.length) return null;
  return parsePositiveId(rawGame);
}

/** The list ID an autocompleted `list:` option holds, or null when it is not one. */
export const parseGameListOption = parsePositiveId;
