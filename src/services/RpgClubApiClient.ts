import axios, { type AxiosInstance, type AxiosRequestConfig } from "axios";

import { withRetry } from "../utilities/RetryUtils.js";

/**
 * Singleton axios instance pre-configured for the RPG Club API.
 *
 * - Base URL: RPGCLUB_API_BASE_URL env var
 * - Auth:     Authorization: Bearer <RPGCLUB_BOT_API_TOKEN>
 * - 404 responses are NOT thrown -- callers receive `null` via the
 *   `apiGet` / `apiPost` helpers below. All other error statuses throw.
 * - Requests time out after REQUEST_TIMEOUT_MS. GETs additionally retry
 *   transient failures (see `isTransientApiError`); writes never retry
 *   automatically since they are not guaranteed idempotent.
 */

// Axios defaults to no timeout, so a wedged API (e.g. the 2026-07-22 Neon
// outage) left every bot call hanging until the Fly proxy gave up (~37s).
const REQUEST_TIMEOUT_MS = 10_000;

const GET_RETRY_ATTEMPTS = 3;
const GET_RETRY_BASE_DELAY_MS = 1_000;

/**
 * Failures worth retrying: no response at all (network error or timeout) or a
 * gateway-flavored status the API returns while restarting behind Fly's proxy.
 */
export function isTransientApiError(err: unknown): boolean {
  if (!axios.isAxiosError(err)) {
    return false;
  }
  if (!err.response) {
    return true;
  }
  return [502, 503, 504].includes(err.response.status);
}

function createClient(): AxiosInstance {
  const baseURL = process.env.RPGCLUB_API_BASE_URL;
  const token = process.env.RPGCLUB_BOT_API_TOKEN;

  if (!baseURL) {
    throw new Error("RPGCLUB_API_BASE_URL is not configured.");
  }
  if (!token) {
    throw new Error("RPGCLUB_BOT_API_TOKEN is not configured.");
  }

  return axios.create({
    baseURL,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
}

// Lazy singleton -- only created when first used so missing env vars
// fail at call time rather than module load time.
let _client: AxiosInstance | null = null;

function getClient(): AxiosInstance {
  if (!_client) {
    _client = createClient();
  }
  return _client;
}

/**
 * GET a resource. Returns the parsed response body, or `null` on 404.
 * Throws for all other non-2xx responses.
 */
export async function apiGet<T>(
  path: string,
  config?: AxiosRequestConfig,
): Promise<T | null> {
  try {
    const response = await withRetry(() => getClient().get<T>(path, config), {
      attempts: GET_RETRY_ATTEMPTS,
      baseDelayMs: GET_RETRY_BASE_DELAY_MS,
      isRetryable: isTransientApiError,
      context: `RpgClubApiClient.apiGet ${path}`,
    });
    return response.data;
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      return null;
    }
    throw err;
  }
}

export type ApiGetRawMeta = {
  rawData: unknown;
  status: number;
  url: string;
  /** Request headers actually sent (Authorization value is masked). */
  requestHeaders: Record<string, string>;
  /** Response headers returned by the server. */
  responseHeaders: Record<string, string>;
  /** Non-null when the request produced an HTTP or network error. */
  errorMessage: string | null;
};

function maskHeaders(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = String(k);
    const val = String(v ?? "");
    out[key] = key.toLowerCase() === "authorization" ? "Bearer ***" : val;
  }
  return out;
}

/**
 * GET a resource and return full response metadata alongside the parsed body.
 * Unlike `apiGet`, HTTP errors (4xx/5xx) are returned as values rather than
 * thrown -- check `errorMessage` and `status` to detect them. Only non-Axios
 * errors (e.g. network failure before a response arrives) still throw.
 */
export async function apiGetRaw<T>(
  path: string,
  config?: AxiosRequestConfig,
): Promise<ApiGetRawMeta> {
  const baseURL = process.env.RPGCLUB_API_BASE_URL ?? "";
  const url = `${baseURL}${path}`;
  try {
    const response = await getClient().get<T>(path, config);
    return {
      rawData: response.data,
      status: response.status,
      url,
      requestHeaders: maskHeaders(
        (response.config.headers ?? {}) as Record<string, unknown>,
      ),
      responseHeaders: response.headers as Record<string, string>,
      errorMessage: null,
    };
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      return {
        rawData: err.response?.data ?? null,
        status: err.response?.status ?? 0,
        url,
        requestHeaders: maskHeaders(
          (err.config?.headers ?? {}) as Record<string, unknown>,
        ),
        responseHeaders: (err.response?.headers ?? {}) as Record<string, string>,
        errorMessage: err.message,
      };
    }
    throw err;
  }
}

/**
 * POST to a resource. Returns the parsed response body, or `null` on 404.
 * Throws for all other non-2xx responses.
 */
export async function apiPost<T>(
  path: string,
  body?: unknown,
  config?: AxiosRequestConfig,
): Promise<T | null> {
  try {
    const response = await getClient().post<T>(path, body, config);
    return response.data;
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      return null;
    }
    throw err;
  }
}

/**
 * PATCH a resource. Returns the parsed response body, or `null` on 404.
 * Throws for all other non-2xx responses.
 */
export async function apiPatch<T>(
  path: string,
  body?: unknown,
  config?: AxiosRequestConfig,
): Promise<T | null> {
  try {
    const response = await getClient().patch<T>(path, body, config);
    return response.data;
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      return null;
    }
    throw err;
  }
}

/**
 * POST to a resource with multipart/form-data. Returns the parsed response body,
 * or `null` on 404. Throws for all other non-2xx responses.
 */
export async function apiPostForm<T>(
  path: string,
  form: FormData,
): Promise<T | null> {
  try {
    const response = await getClient().post<T>(path, form, {
      headers: { "Content-Type": undefined },
    });
    return response.data;
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      return null;
    }
    throw err;
  }
}

/**
 * DELETE a resource. Returns the parsed response body, or `null` on 404.
 * Throws for all other non-2xx responses.
 */
export async function apiDelete<T>(
  path: string,
  config?: AxiosRequestConfig,
): Promise<T | null> {
  try {
    const response = await getClient().delete<T>(path, config);
    return response.data;
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      return null;
    }
    throw err;
  }
}
