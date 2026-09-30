import { Events, RESTEvents, type Client, type RateLimitData } from "discord.js";
import { logError, logInfo, logWarn } from "../utilities/LogUtils.js";

const LOG_CONTEXT: string = "ClientObservability";

// Logs gateway reconnects and REST rate limits, which are otherwise silent, so an
// outage can be traced from the logs. `onInvalidated` runs when Discord
// invalidates the session: discord.js will not reconnect on its own after that,
// so the caller shuts the process down and the process manager restarts it.
export function registerClientObservability(client: Client, onInvalidated: () => void): void {
  client.on(Events.ShardError, (error: Error, shardId: number) => {
    logError(`${LOG_CONTEXT}.shardError`, { shardId, error });
  });

  client.on(Events.ShardDisconnect, (event, shardId: number) => {
    logError(`${LOG_CONTEXT}.shardDisconnect`, {
      shardId,
      code: event.code,
      reason: event.reason,
    });
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
    onInvalidated();
  });

  client.rest.on(RESTEvents.RateLimited, (info: RateLimitData) => {
    logWarn(`${LOG_CONTEXT}.rateLimited`, {
      method: info.method,
      route: info.route,
      url: info.url,
      limit: info.limit,
      retryAfterMs: info.retryAfter,
      global: info.global,
      scope: info.scope,
    });
  });
}
