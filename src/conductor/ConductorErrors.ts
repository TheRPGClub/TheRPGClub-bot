import axios from "axios";
import {
  buildApiErrorMessage,
  buildDiscordErrorMessage,
  type IErrorMessageOptions,
} from "../utilities/ApiErrorUtils.js";

/**
 * The conductor's DMs and the test guild have no dev role to mention. Every conductor
 * error reply goes through these; an uncaught error is only logged by main.ts, since the
 * conductor runs as its own process, outside the main bot's handleInteractionError.
 */
const CONDUCTOR_ERROR_OPTIONS: IErrorMessageOptions = { devPing: false };

export function conductorApiError(label: string, err: unknown): string {
  return buildApiErrorMessage(label, err, CONDUCTOR_ERROR_OPTIONS);
}

export function conductorDiscordError(label: string, err: unknown): string {
  return buildDiscordErrorMessage(label, err, CONDUCTOR_ERROR_OPTIONS);
}

/** Picks the formatter for a failure that may come from either Discord or an HTTP download. */
export function conductorAnyError(label: string, err: unknown): string {
  const isApiError = axios.isAxiosError(err) ||
    (err instanceof Error && axios.isAxiosError(err.cause));
  return isApiError ? conductorApiError(label, err) : conductorDiscordError(label, err);
}
