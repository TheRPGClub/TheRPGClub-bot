import type {
  ResumableSessionLookup,
  ResumableSessionRegistry,
} from "../services/PersistedInteractionSessionStore.js";
import { buildApiErrorMessage } from "../utilities/ApiErrorUtils.js";
import { logError } from "../utilities/LogUtils.js";
import { buildErrorReply, buildTextReply } from "./ComponentsV2Utils.js";
import { type AnyRepliable, safeFollowUpIfSettled } from "./InteractionUtils.js";

/**
 * Resolves a resumable session for an interaction that is already acked, restoring it
 * from the API after a restart. When the session is gone or cannot be read, posts an
 * ephemeral follow-up saying why (with the full request and response for API errors)
 * and returns undefined.
 */
export async function resolveSessionOrReply<S>(
  registry: ResumableSessionRegistry<S>,
  interaction: AnyRepliable,
  sessionId: string,
  lookup: ResumableSessionLookup,
  messages: { expired: string; restoreFailed: string; logContext: string },
): Promise<S | undefined> {
  let session: S | undefined;
  try {
    session = await registry.resolve(sessionId, lookup);
  } catch (err: unknown) {
    logError(messages.logContext, err);
    await safeFollowUpIfSettled(
      interaction,
      buildErrorReply(buildApiErrorMessage(messages.restoreFailed, err), true),
    );
    return undefined;
  }
  if (!session) {
    await safeFollowUpIfSettled(interaction, buildTextReply(messages.expired, true));
  }
  return session;
}
