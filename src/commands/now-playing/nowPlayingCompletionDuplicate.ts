import {
  buildOwnedSessionId,
  createResumableSessionRegistry,
  parseOwnedSessionOwnerId,
  type PersistedSessionLocation,
} from "../../services/PersistedInteractionSessionStore.js";
import { COMPLETION_TYPES, type CompletionType } from "../profile.command.js";
import type { NowPlayingCompletionPlatformSession } from "./nowPlayingTypes.js";

/**
 * A Now Playing completion waiting on the duplicate warning. `sessionId` is the
 * completion wizard's id, which the finished flow uses to return to the list.
 */
export type NowPlayingPendingCompletion = Omit<NowPlayingCompletionPlatformSession, "platforms">;

const NP_DUPLICATE_SESSION_PREFIX = "npdup";

const pendingCompletions = new Map<string, NowPlayingPendingCompletion>();

function toJson(pending: NowPlayingPendingCompletion): Record<string, unknown> {
  return {
    ...pending,
    completedAt: pending.completedAt ? pending.completedAt.toISOString() : null,
  };
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

function fromJson(state: unknown): NowPlayingPendingCompletion | null {
  if (!state || typeof state !== "object") return null;
  const raw = state as Record<string, unknown>;
  const completedAt = typeof raw.completedAt === "string" ? new Date(raw.completedAt) : null;
  if (
    typeof raw.sessionId !== "string" ||
    typeof raw.userId !== "string" ||
    typeof raw.gameId !== "number" ||
    !COMPLETION_TYPES.includes(raw.completionType as CompletionType) ||
    (completedAt !== null && Number.isNaN(completedAt.getTime())) ||
    !isNullableNumber(raw.finalPlaytimeHours) ||
    !(raw.note === null || typeof raw.note === "string") ||
    typeof raw.removeFromNowPlaying !== "boolean" ||
    typeof raw.announce !== "boolean" ||
    typeof raw.returnToList !== "boolean"
  ) {
    return null;
  }
  return {
    sessionId: raw.sessionId,
    userId: raw.userId,
    gameId: raw.gameId,
    completionType: raw.completionType as CompletionType,
    completedAt,
    finalPlaytimeHours: raw.finalPlaytimeHours,
    note: raw.note,
    removeFromNowPlaying: raw.removeFromNowPlaying,
    announce: raw.announce,
    returnToList: raw.returnToList,
  };
}

export const nowPlayingDuplicateRegistry =
  createResumableSessionRegistry<NowPlayingPendingCompletion>({
    kind: "np-complete-dup",
    sessions: pendingCompletions,
    fromState: (state) => fromJson(state),
  });

/** Persists a pending completion and returns the id its warning buttons carry. */
export function createNowPlayingDuplicateSession(
  pending: NowPlayingPendingCompletion,
  location: PersistedSessionLocation,
): string {
  const sessionId = buildOwnedSessionId(NP_DUPLICATE_SESSION_PREFIX, pending.userId);
  nowPlayingDuplicateRegistry.create({
    sessionId,
    session: pending,
    ownerId: pending.userId,
    location,
    state: toJson(pending),
  });
  return sessionId;
}

/** Returns the owner id built into a duplicate session id. */
export function parseNowPlayingDuplicateOwnerId(sessionId: string): string | null {
  return parseOwnedSessionOwnerId(NP_DUPLICATE_SESSION_PREFIX, sessionId);
}
