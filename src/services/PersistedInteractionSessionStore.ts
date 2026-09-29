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
