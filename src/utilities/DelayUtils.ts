export const AUDIT_STEP_DELAY_MS = 1000;
export const IGDB_RATE_LIMIT_DELAY_MS = 250;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
