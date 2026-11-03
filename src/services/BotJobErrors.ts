import { DiscordAPIError, HTTPError, RateLimitError } from "discord.js";
import { isTransientApiError } from "./RpgClubApiClient.js";

/**
 * A failure the next attempt may not repeat: the API unreachable or restarting, or Discord
 * answering 5xx or rate limited. Only the thrown error is classed, never its cause: a
 * handler wraps an error on purpose when a retry would repeat a side effect.
 */
export function isTemporaryJobError(err: unknown): boolean {
  if (isTransientApiError(err)) return true;
  if (err instanceof RateLimitError) return true;
  if (err instanceof DiscordAPIError || err instanceof HTTPError) {
    return err.status >= 500 || err.status === 429;
  }
  return false;
}
