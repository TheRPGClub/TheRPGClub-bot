// Helper utilities for game completion functionality

import Member from "../../classes/Member.js";
import type { NowPlayingRemoval } from "../../functions/CompletionHelpers.js";
import { parseCustomIdSegments } from "../../utilities/CustomIdUtils.js";
import { COMPLETIONATOR_CHOOSE_PREFIX } from "../../config/customIdPrefixes.js";

function shouldPromptNowPlayingRemoval(
  addedAt: Date | null,
  completedAt: Date | null,
  requireCompletionAfterAdded: boolean,
): boolean {
  if (!addedAt) return true;
  if (!requireCompletionAfterAdded) return true;
  if (!completedAt) return true;
  return completedAt >= addedAt;
}

/**
 * Returns "prompt" when the member should be asked, after the completion saves, whether
 * to drop the game from Now Playing, and false when there is nothing to ask about.
 */
export async function resolveNowPlayingRemoval(
  userId: string,
  gameId: number,
  completedAt: Date | null,
  requireCompletionAfterAdded: boolean,
): Promise<NowPlayingRemoval> {
  const nowPlayingMeta = await Member.getNowPlayingEntryMeta(userId, gameId);
  if (!nowPlayingMeta) {
    return false;
  }
  const shouldPrompt = shouldPromptNowPlayingRemoval(
    nowPlayingMeta.addedAt,
    completedAt,
    requireCompletionAfterAdded,
  );
  return shouldPrompt ? "prompt" : false;
}

export function escapeCsv(field: string): string {
  if (field.includes(",") || field.includes('"') || field.includes("\n")) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

export function getCompletionatorThreadKey(userId: string, importId: number): string {
  return `${userId}:${importId}`;
}

export function getCompletionatorFormKey(importId: number, itemId: number): string {
  return `${importId}:${itemId}`;
}

export function buildCompletionatorChooseId(params: {
  ownerId: string;
  importId: number;
  itemId: number;
  gameId: number;
}): string {
  return `${COMPLETIONATOR_CHOOSE_PREFIX}:${params.ownerId}:${params.importId}:${params.itemId}:${params.gameId}`;
}

export function parseCompletionatorChooseId(customId: string): {
  ownerId: string;
  importId: number;
  itemId: number;
  gameId: number;
} | null {
  if (!customId.startsWith(`${COMPLETIONATOR_CHOOSE_PREFIX}:`)) return null;
  const segs = parseCustomIdSegments(customId, 4);
  if (!segs) return null;
  const [ownerId, importIdRaw, itemIdRaw, gameIdRaw] = segs;
  const importId = Number(importIdRaw);
  const itemId = Number(itemIdRaw);
  const gameId = Number(gameIdRaw);
  if (
    !ownerId ||
    !Number.isInteger(importId) ||
    !Number.isInteger(itemId) ||
    !Number.isInteger(gameId)
  ) {
    return null;
  }
  return {
    ownerId,
    importId,
    itemId,
    gameId,
  };
}
