import {
  Events,
  GatewayCloseCodes,
  RESTEvents,
  type Client,
  type CloseEvent,
  type RateLimitData,
} from "discord.js";
import { logError, logInfo, logWarn } from "../utilities/LogUtils.js";

const LOG_CONTEXT: string = "ClientObservability";

// Logs gateway reconnects and REST rate limits, which are otherwise silent, so an
// outage can be traced from the logs. `onUnrecoverable` runs once when the gateway
// session cannot come back on its own, so the caller can shut the process down and
// let the process manager restart it. discord.js 14.27 no longer emits `invalidated`;
// a shard that will not reconnect surfaces as `shardDisconnect` (an unrecoverable
// close code), so both trigger the shutdown.
export function registerClientObservability(
  client: Client,
  onUnrecoverable: () => void,
): void {
  let shutdownRequested = false;
  const requestShutdown = (): void => {
    if (shutdownRequested) return;
    shutdownRequested = true;
    onUnrecoverable();
  };

  client.on(Events.ShardError, (error: Error, shardId: number) => {
    logError(`${LOG_CONTEXT}.shardError`, { shardId, error });
  });

  client.on(Events.ShardDisconnect, (event: CloseEvent, shardId: number) => {
    // CloseEvent.reason is a deprecated placeholder; the close code carries the cause.
    logError(`${LOG_CONTEXT}.shardDisconnect`, {
      shardId,
      code: event.code,
      codeName: GatewayCloseCodes[event.code] ?? null,
      action: "shutting down for restart",
    });
    requestShutdown();
  });

  client.on(Events.ShardReconnecting, (shardId: number) => {
    logWarn(`${LOG_CONTEXT}.shardReconnecting`, { shardId });
  });

  client.on(Events.ShardResume, (shardId: number, replayedEvents: number) => {
    logInfo(`${LOG_CONTEXT}.shardResume`, { shardId, replayedEvents });
  });

  client.on(Events.Warn, (message: string) => {
    logWarn(`${LOG_CONTEXT}.warn`, message);
  });

  client.on(Events.Invalidated, () => {
    logError(`${LOG_CONTEXT}.invalidated`, "Session invalidated; shutting down for restart");
    requestShutdown();
  });

  // `route` is the sanitized bucket route; `url` is left out because interaction
  // webhook URLs embed the interaction token.
  client.rest.on(RESTEvents.RateLimited, (info: RateLimitData) => {
    logWarn(`${LOG_CONTEXT}.rateLimited`, {
      method: info.method,
      route: info.route,
      limit: info.limit,
      retryAfterMs: info.retryAfter,
      global: info.global,
      scope: info.scope,
    });
  });
}
