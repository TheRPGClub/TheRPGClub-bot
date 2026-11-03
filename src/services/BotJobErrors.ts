import axios from "axios";
import { DiscordAPIError, HTTPError, RateLimitError } from "discord.js";
import { isTransientApiError } from "./RpgClubApiClient.js";
import { describeRequestError } from "../utilities/ApiErrorUtils.js";

/**
 * A handler's failure in one named step of a several-step job. It says the step and why,
 * and declares itself temporary or not: the dispatcher classes it by that flag, so a
 * temporary one is still left for the lease while a retry would repeat nothing.
 */
export class BotJobStepError extends Error {
  readonly temporary: boolean;

  constructor(message: string, cause: unknown, temporary: boolean) {
    // An API (axios) cause is formatted by the dispatcher with its full request and
    // response; anything else (a discord.js failure: its request line and response, never
    // its body) goes in the message.
    super(axios.isAxiosError(cause) ? message : `${message}: ${describeRequestError(cause)}`, {
      cause,
    });
    this.name = "BotJobStepError";
    this.temporary = temporary;
  }
}

/**
 * A failure the next attempt may not repeat: the API unreachable or restarting, or Discord
 * answering 5xx or rate limited. Only the thrown error is classed, never its cause: a
 * handler wraps an error on purpose when a retry would repeat a side effect.
 */
export function isTemporaryJobError(err: unknown): boolean {
  if (err instanceof BotJobStepError) return err.temporary;
  if (isTransientApiError(err)) return true;
  if (err instanceof RateLimitError) return true;
  if (err instanceof DiscordAPIError || err instanceof HTTPError) {
    return err.status >= 500 || err.status === 429;
  }
  return false;
}

/** Wraps a step's failure, keeping it temporary when the error itself is. */
export function stepFailed(step: string, err: unknown): BotJobStepError {
  return new BotJobStepError(`${step} failed`, err, isTemporaryJobError(err));
}
