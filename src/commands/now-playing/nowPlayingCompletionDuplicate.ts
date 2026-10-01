import {
  buildOwnedSessionId,
  createResumableSessionRegistry,
  parseOwnedSessionOwnerId,
  type PersistedSessionLocation,
} from "../../services/PersistedInteractionSessionStore.js";
import type { NowPlayingCompletionPlatformSession } from "./nowPlayingTypes.js";
import {
  platformSessionFromJson,
  platformSessionToJson,
} from "./nowPlayingCompletionSessions.js";

/**
 * A Now Playing completion waiting on the duplicate warning. `sessionId` is the
 * completion wizard's id, which the finished flow uses to return to the list.
 */
export type NowPlayingPendingCompletion = Omit<NowPlayingCompletionPlatformSession, "platforms">;

const NP_DUPLICATE_SESSION_PREFIX = "npdup";

const pendingCompletions = new Map<string, NowPlayingPendingCompletion>();

// The pending completion is a platform session without its platform list, so it reuses
// that codec and stores an empty list.
function toJson(pending: NowPlayingPendingCompletion): unknown {
  return platformSessionToJson({ ...pending, platforms: [] });
}

function fromJson(state: unknown): NowPlayingPendingCompletion | null {
  const session = platformSessionFromJson(state);
  if (!session) return null;
  const { platforms: _platforms, ...pending } = session;
  return pending;
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
