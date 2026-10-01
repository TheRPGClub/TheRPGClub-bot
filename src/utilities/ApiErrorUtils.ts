import axios, { type AxiosError } from "axios";

import { DEV_ROLE_ID } from "../config/roles.js";
import { jsonCodeBlock } from "./CodeBlockUtils.js";

/** Mention appended to every user-facing request/response failure block. */
export const DEV_PING = `<@&${DEV_ROLE_ID}>`;

export interface IErrorMessageOptions {
  /**
   * Append DEV_PING. Defaults to true. The conductor turns it off: its DMs and the test
   * guild have no dev role, so the mention renders as `@unknown-role`.
   */
  devPing?: boolean;
}

function pingSuffix(options: IErrorMessageOptions | undefined): string {
  return options?.devPing === false ? "" : `\n${DEV_PING}`;
}

// Query parameters whose values never belong in a Discord reply, such as the Twitch
// token request's client_secret.
const SECRET_QUERY_PARAM = /([?&][^=&#]*(?:secret|token|password|api_?key)[^=&#]*=)[^&#]*/gi;

/** Replace the value of every secret-looking query parameter in a URL. */
export function redactUrlSecrets(url: string): string {
  return url.replace(SECRET_QUERY_PARAM, "$1REDACTED");
}

const DATA_URI = /^data:[^;,]+(?:;base64)?,/;

/** Swap inline file payloads (base64 data URIs, e.g. an event cover) for their size. */
function redactDataUris(value: unknown): unknown {
  if (typeof value === "string") {
    const prefix = DATA_URI.exec(value)?.[0];
    return prefix ? `${prefix}<${value.length - prefix.length} chars>` : value;
  }
  if (Array.isArray(value)) return value.map(redactDataUris);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactDataUris(item)]),
    );
  }
  return value;
}

export function formatApiError(
  method: string,
  url: string,
  requestBody: unknown,
  status: number | undefined,
  responseBody: unknown,
  options?: IErrorMessageOptions,
): string {
  const req = JSON.stringify(
    {
      method: method.toUpperCase(),
      url: redactUrlSecrets(url),
      body: redactDataUris(requestBody ?? null),
    },
    null, 2,
  );
  const res = JSON.stringify({ status: status ?? null, body: responseBody ?? null }, null, 2);
  return (
    `Request:\n${jsonCodeBlock(req)}\n` +
    `Response:\n${jsonCodeBlock(res)}${pingSuffix(options)}`
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

function isDiscordRestError(
  err: unknown,
): err is IDiscordRestError & { method: string; url: string } {
  const restError = err as IDiscordRestError;
  return typeof restError?.url === "string" && typeof restError?.method === "string";
}

/** Format a discord.js REST failure with the same request/response detail as API errors. */
export function buildDiscordErrorMessage(
  label: string,
  err: unknown,
  options?: IErrorMessageOptions,
): string {
  if (!isDiscordRestError(err)) {
    const msg = err instanceof Error ? err.message : String(err);
    return `${label}: ${msg}${pingSuffix(options)}`;
  }
  return `${label}\n${formatApiError(
    err.method,
    err.url,
    err.requestBody?.json ?? null,
    err.status,
    err.rawError ?? null,
    options,
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

function formatAxiosError(err: AxiosError, options?: IErrorMessageOptions): string {
  return formatApiError(
    err.config?.method ?? "?",
    err.config?.url ?? "?",
    tryParseJson(err.config?.data as string | null | undefined),
    err.response?.status,
    decodeBinaryBody(err.response?.data),
    options,
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
export function buildApiErrorMessage(
  label: string,
  err: unknown,
  options?: IErrorMessageOptions,
): string {
  if (err instanceof UserFacingError) return `${label}: ${err.message}`;
  if (axios.isAxiosError(err)) {
    return `${label}\n${formatAxiosError(err, options)}`;
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (err instanceof Error && axios.isAxiosError(err.cause)) {
    return `${label}: ${msg}\n${formatAxiosError(err.cause, options)}`;
  }
  return `${label}: ${msg}${pingSuffix(options)}`;
}

/**
 * Picks the formatter for an error of unknown origin: API errors (axios, or wrapped in a
 * cause) get buildApiErrorMessage, and everything else, including discord.js REST
 * failures, gets buildDiscordErrorMessage.
 */
export function buildAnyErrorMessage(
  label: string,
  err: unknown,
  options?: IErrorMessageOptions,
): string {
  return isApiError(err)
    ? buildApiErrorMessage(label, err, options)
    : buildDiscordErrorMessage(label, err, options);
}

function isApiError(err: unknown): boolean {
  return err instanceof UserFacingError ||
    axios.isAxiosError(err) ||
    (err instanceof Error && axios.isAxiosError(err.cause));
}

/**
 * For a catch block around API or Discord calls that also throw our own validation
 * errors. An API failure gets buildApiErrorMessage's request/response blocks and a
 * discord.js REST failure gets buildDiscordErrorMessage's; any other error is a
 * validation message for the user, shown after the label with no dev ping.
 */
export function buildCaughtErrorMessage(
  label: string,
  err: unknown,
  options?: IErrorMessageOptions,
): string {
  if (isApiError(err)) return buildApiErrorMessage(label, err, options);
  if (isDiscordRestError(err)) return buildDiscordErrorMessage(label, err, options);
  return buildApiErrorMessage(label, err, { ...options, devPing: false });
}
