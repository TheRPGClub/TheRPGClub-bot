import { apiDelete, apiGet, apiPost } from "./RpgClubApiClient.js";
import { logError } from "../utilities/LogUtils.js";

// Interaction sessions that must survive a bot restart ride on the API's wizard
// session table. Each session gets its own command_key (`<kind>:<id>`), so the
// one-active-row-per (command_key, owner, channel) index never clobbers a
// concurrent session. command_key is capped at 80 characters by the API schema.
const MAX_COMMAND_KEY_LENGTH = 80;
const DM_CHANNEL_KEY = "dm";

export type PersistedSessionLocation = {
  channelId: string | null;
  guildId: string | null;
};

export type PersistedSessionRecord = {
  rowId: string;
  state: unknown;
};

type WizardSessionApiData = {
  session_id: string;
  state_json: string;
};

function buildCommandKey(kind: string, sessionId: string): string {
  const key = `${kind}:${sessionId}`;
  if (key.length > MAX_COMMAND_KEY_LENGTH) {
    throw new Error(`Persisted session key exceeds ${MAX_COMMAND_KEY_LENGTH} chars: ${key}`);
  }
  return key;
}

function parseState(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function save(params: {
  kind: string;
  sessionId: string;
  ownerId: string;
  location: PersistedSessionLocation;
  state: unknown;
}): Promise<string | null> {
  const result = await apiPost<{ data: WizardSessionApiData }>(
    `/api/v1/users/${params.ownerId}/wizard_sessions`,
    {
      data: {
        command_key: buildCommandKey(params.kind, params.sessionId),
        channel_id: params.location.channelId ?? DM_CHANNEL_KEY,
        guild_id: params.location.guildId,
        state_json: JSON.stringify(params.state),
      },
    },
  );
  return result?.data?.session_id ?? null;
}

async function load(params: {
  kind: string;
  sessionId: string;
  ownerId: string;
  channelId: string | null;
}): Promise<PersistedSessionRecord | null> {
  const result = await apiGet<{ data: WizardSessionApiData }>(
    `/api/v1/users/${params.ownerId}/wizard_sessions`,
    {
      params: {
        command_key: buildCommandKey(params.kind, params.sessionId),
        channel_id: params.channelId ?? DM_CHANNEL_KEY,
      },
    },
  );
  if (!result?.data) return null;
  return { rowId: result.data.session_id, state: parseState(result.data.state_json) };
}

async function remove(rowId: string): Promise<void> {
  await apiDelete(`/api/v1/wizard_sessions/${rowId}`);
}

/**
 * Methods live on one object so tests can stub them with `t.mock.method`.
 */
export const persistedSessionStore = { save, load, remove };

/**
 * Saves a session without blocking the caller. The in-memory copy keeps the flow
 * working when the save fails; only restart recovery is lost, so it is logged.
 */
export function persistSessionInBackground(
  params: Parameters<typeof save>[0],
): Promise<string | null> {
  return persistedSessionStore.save(params).catch((err: unknown) => {
    logError(`PersistedInteractionSessionStore.save ${params.kind}`, err);
    return null;
  });
}

/**
 * Deletes a persisted row once its flow finishes. Failures leave an orphan row
 * behind, which is harmless, so they are logged rather than surfaced.
 */
export async function removePersistedSession(
  rowId: Promise<string | null> | string | null | undefined,
): Promise<void> {
  const id = await rowId;
  if (!id) return;
  await persistedSessionStore.remove(id).catch((err: unknown) => {
    logError("PersistedInteractionSessionStore.remove", err);
  });
}

export type ResumableSessionLookup = {
  ownerId: string;
  channelId: string | null;
};

export type ResumableSessionRegistry<S> = {
  get: (sessionId: string) => S | undefined;
  /** Stores a session in memory only; it does not survive a restart. */
  setInMemory: (sessionId: string, session: S) => void;
  /** Stores a session and persists `state` so it can be restored after a restart. */
  create: (params: {
    sessionId: string;
    session: S;
    ownerId: string;
    location: PersistedSessionLocation;
    state: unknown;
  }) => void;
  /**
   * Returns the in-memory session, or restores it from the API. Concurrent calls for
   * one id share a single API read. API errors propagate so the caller can show the
   * request and response.
   */
  resolve: (sessionId: string, lookup: ResumableSessionLookup) => Promise<S | undefined>;
  /** True for the first caller only, so a double click runs the session's action once. */
  claim: (sessionId: string) => boolean;
  /** Forgets the session and deletes its persisted row. */
  finish: (sessionId: string) => void;
};

/**
 * In-memory interaction sessions backed by a persisted copy for restart recovery.
 * `sessions` is passed in so callers can keep their existing (or global) map.
 */
export function createResumableSessionRegistry<S>(options: {
  kind: string;
  sessions: Map<string, S>;
  fromState: (state: unknown, lookup: ResumableSessionLookup) => S | null;
}): ResumableSessionRegistry<S> {
  const { kind, sessions } = options;
  const rowIds = new Map<string, Promise<string | null>>();
  const restoring = new Map<string, Promise<S | undefined>>();
  const claimed = new Set<string>();

  async function restore(
    sessionId: string,
    lookup: ResumableSessionLookup,
  ): Promise<S | undefined> {
    const record = await persistedSessionStore.load({ kind, sessionId, ...lookup });
    if (!record) return undefined;
    const session = options.fromState(record.state, lookup);
    if (!session) return undefined;
    sessions.set(sessionId, session);
    rowIds.set(sessionId, Promise.resolve(record.rowId));
    return session;
  }

  return {
    get: (sessionId) => sessions.get(sessionId),
    setInMemory: (sessionId, session) => {
      sessions.set(sessionId, session);
    },
    create: ({ sessionId, session, ownerId, location, state }) => {
      sessions.set(sessionId, session);
      rowIds.set(
        sessionId,
        persistSessionInBackground({ kind, sessionId, ownerId, location, state }),
      );
    },
    resolve: (sessionId, lookup) => {
      const cached = sessions.get(sessionId);
      if (cached) return Promise.resolve(cached);
      const pending = restoring.get(sessionId);
      if (pending) return pending;
      const restored = restore(sessionId, lookup).finally(() => {
        restoring.delete(sessionId);
      });
      restoring.set(sessionId, restored);
      return restored;
    },
    claim: (sessionId) => {
      if (claimed.has(sessionId)) return false;
      claimed.add(sessionId);
      return true;
    },
    finish: (sessionId) => {
      sessions.delete(sessionId);
      void removePersistedSession(rowIds.get(sessionId));
      rowIds.delete(sessionId);
      claimed.delete(sessionId);
    },
  };
}
