import { GatewayDispatchEvents, type Client } from "discord.js";
import { removeThreadGameLink } from "../classes/Thread.js";
import { IS_TEST_MODE } from "../config/testMode.js";
import { buildApiErrorMessage } from "../utilities/ApiErrorUtils.js";
import { logError } from "../utilities/LogUtils.js";

type RemoveLinks = (threadId: string) => Promise<number>;

const LOG_CONTEXT = "ThreadDeleted.removeGameLinks";

/**
 * Removes every GameDB link for a thread Discord deleted, so the API stops pointing
 * games at a thread that no longer exists.
 *
 * A PR preview in the test guild talks to the production API, so test mode skips the
 * delete. Failures are logged with the full request and response, never thrown, since
 * an event handler has no caller to report to. Returns the number of links removed.
 */
export async function removeDeletedThreadLinks(
  threadId: string,
  testMode: boolean = IS_TEST_MODE,
  removeLinks: RemoveLinks = removeThreadGameLink,
): Promise<number> {
  if (testMode) return 0;
  try {
    return await removeLinks(threadId);
  } catch (error: unknown) {
    const label = `Could not remove GameDB links for deleted thread ${threadId}`;
    logError(LOG_CONTEXT, buildApiErrorMessage(label, error));
    return 0;
  }
}

type ThreadDeletePacket = { id: string };

/**
 * discord.js emits `threadDelete` only for a thread in its channel cache, and an archived
 * thread is not cached after a restart. `client.ws` emits each dispatch before discord.js
 * handles it, so a thread still in the cache here is left to the `threadDelete` handler
 * and only an uncached one is cleaned up from the raw packet.
 */
export function registerUncachedThreadDeleteCleanup(
  client: Client,
  cleanup: (threadId: string) => Promise<number> = removeDeletedThreadLinks,
): void {
  client.ws.on(GatewayDispatchEvents.ThreadDelete, (data: ThreadDeletePacket) => {
    if (client.channels.cache.has(data.id)) return;
    void cleanup(data.id);
  });
}
