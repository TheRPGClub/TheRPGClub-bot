import axios, { type AxiosError } from "axios";

import { DEV_ROLE_ID } from "../config/roles.js";

/** Mention appended to every user-facing request/response failure block. */
export const DEV_PING = `<@&${DEV_ROLE_ID}>`;

// Query parameters whose values never belong in a Discord reply, such as the Twitch
// token request's client_secret.
const SECRET_QUERY_PARAM = /([?&][^=&#]*(?:secret|token|password|api_?key)[^=&#]*=)[^&#]*/gi;

/** Replace the value of every secret-looking query parameter in a URL. */
export function redactUrlSecrets(url: string): string {
  return url.replace(SECRET_QUERY_PARAM, "$1REDACTED");
}

export function formatApiError(
  method: string,
  url: string,
  requestBody: unknown,
  status: number | undefined,
  responseBody: unknown,
): string {
  const req = JSON.stringify(
    { method: method.toUpperCase(), url: redactUrlSecrets(url), body: requestBody ?? null },
    null, 2,
  );
  const res = JSON.stringify({ status: status ?? null, body: responseBody ?? null }, null, 2);
  return (
    `Request:\n\`\`\`json\n${req}\n\`\`\`\n` +
    `Response:\n\`\`\`json\n${res}\n\`\`\`\n${DEV_PING}`
  );
}

const BINARY_BODY_MAX_CHARS = 500;

/** Decode a binary response body (arraybuffer requests) into a short readable string. */
export function decodeBinaryBody(data: unknown): unknown {
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8").slice(0, BINARY_BODY_MAX_CHARS);
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8").slice(0, BINARY_BODY_MAX_CHARS);
  }
  return data;
}

export function tryParseJson(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

interface IDiscordRestError {
  method?: string;
  url?: string;
  status?: number;
  rawError?: unknown;
  requestBody?: { json?: unknown };
}

/** Format a discord.js REST failure with the same request/response detail as API errors. */
export function buildDiscordErrorMessage(label: string, err: unknown): string {
  const restError = err as IDiscordRestError;
  if (typeof restError?.url !== "string" || typeof restError?.method !== "string") {
    const msg = err instanceof Error ? err.message : String(err);
    return `${label}: ${msg}\n${DEV_PING}`;
  }
  return `${label}\n${formatApiError(
    restError.method,
    restError.url,
    restError.requestBody?.json ?? null,
    restError.status,
    restError.rawError ?? null,
  )}`;
}

/**
 * Why a request failed, for result lines and replies. A discord.js REST failure is
 * one line, the request line and Discord's response, e.g.
 * `POST /channels/1/messages -> 403 {"message":"Missing Access","code":50001}`, since
 * buildDiscordErrorMessage's request body (a whole message) would crowd out the reason.
 * An API (axios) failure gets the full request and response blocks. Anything else
 * gives its message.
 */
export function describeRequestError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    return `${err.message}\n${formatAxiosError(err)}`;
  }
  const restError = err as IDiscordRestError;
  if (typeof restError?.method === "string" && typeof restError?.url === "string") {
    const path = restError.url.replace(/^https?:\/\/[^/]+\/api\/v\d+/, "");
    return `${restError.method.toUpperCase()} ${path} -> ${String(restError.status ?? "?")} ` +
      JSON.stringify(restError.rawError ?? null);
  }
  return err instanceof Error ? err.message : String(err);
}

function formatAxiosError(err: AxiosError): string {
  return formatApiError(
    err.config?.method ?? "?",
    err.config?.url ?? "?",
    tryParseJson(err.config?.data as string | null | undefined),
    err.response?.status,
    decodeBinaryBody(err.response?.data),
  );
}

/**
 * A failure the user caused and can fix, such as adding a duplicate entry. Its `cause`
 * keeps the API error for logs, but the reply shows only the message, with no
 * request/response JSON and no dev ping.
 */
export class UserFacingError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "UserFacingError";
  }
}

/**
 * Renders request/response JSON for an `AxiosError`, or for an `Error` whose
 * `cause` is one (a friendly message wrapping the API failure).
 */
export function buildApiErrorMessage(label: string, err: unknown): string {
  if (err instanceof UserFacingError) return `${label}: ${err.message}`;
  if (axios.isAxiosError(err)) {
    return `${label}\n${formatAxiosError(err)}`;
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (err instanceof Error && axios.isAxiosError(err.cause)) {
    return `${label}: ${msg}\n${formatAxiosError(err.cause)}`;
  }
  return `${label}: ${msg}\n${DEV_PING}`;
}

/**
 * Picks the formatter for an error of unknown origin: API errors (axios, or wrapped in a
 * cause) get buildApiErrorMessage, and everything else, including discord.js REST
 * failures, gets buildDiscordErrorMessage.
 */
export function buildAnyErrorMessage(label: string, err: unknown): string {
  const isApiError: boolean = err instanceof UserFacingError ||
    axios.isAxiosError(err) ||
    (err instanceof Error && axios.isAxiosError(err.cause));
  return isApiError ? buildApiErrorMessage(label, err) : buildDiscordErrorMessage(label, err);
}
