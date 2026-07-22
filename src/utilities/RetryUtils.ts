import { logWarn } from "./LogUtils.js";

export type WithRetryOptions = {
  /** Total attempts including the first try. Use Infinity to retry until success. */
  attempts: number;
  /** Delay before the first retry. Doubles on each subsequent retry. */
  baseDelayMs: number;
  /** Upper bound for the backoff delay. Defaults to 60s. */
  maxDelayMs?: number;
  /**
   * Return false to rethrow immediately instead of retrying.
   * When omitted, every failure is retried.
   */
  isRetryable?: (err: unknown) => boolean;
  /** Log context for the per-retry warning, e.g. "RpgClubApiClient.apiGet /api/v1/foo". */
  context: string;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Run `fn`, retrying failures with capped exponential backoff. Each retry is
 * logged through `logWarn`; the final failure (attempts exhausted or a
 * non-retryable error) is rethrown to the caller.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: WithRetryOptions,
): Promise<T> {
  const { attempts, baseDelayMs, maxDelayMs = 60_000, isRetryable, context } = options;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts || (isRetryable && !isRetryable(err))) {
        throw err;
      }
      const nextDelayMs = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      logWarn(context, {
        attempt,
        nextDelayMs,
        error: errorMessage(err),
      });
      await delay(nextDelayMs);
    }
  }
}
