import axios, { type AxiosInstance, type AxiosRequestConfig } from "axios";

/**
 * Singleton axios instance pre-configured for the RPG Club API.
 *
 * - Base URL: RPGCLUB_API_BASE_URL env var
 * - Auth:     Authorization: Bearer <RPGCLUB_BOT_API_TOKEN>
 * - 404 responses are NOT thrown -- callers receive `null` via the
 *   `apiGet` / `apiPost` helpers below. All other error statuses throw.
 */

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
    const response = await getClient().get<T>(path, config);
    console.log('path', path);
    console.log('config', config);
    console.log('response', response);
    return response.data;
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      return null;
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
