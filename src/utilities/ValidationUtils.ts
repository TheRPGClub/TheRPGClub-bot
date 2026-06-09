export function isPositiveInt(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

/** Throws with the given label if value is not a positive integer. */
export function requirePositiveInt(value: unknown, label = "ID"): number {
  if (!isPositiveInt(value)) throw new Error(`Invalid ${label}.`);
  return value as number;
}

/** Returns the parsed page number, or null if not a valid positive integer. */
export function parsePageNumber(raw: string | null | undefined): number | null {
  const n = parseInt(raw ?? "", 10);
  return Number.isNaN(n) || n < 1 ? null : n;
}

/** Returns true if value is a valid non-negative playtime in hours. */
export function isValidPlaytimeHours(value: unknown): value is number {
  return typeof value === "number" && !Number.isNaN(value) && value >= 0;
}

export function truncateWithEllipsis(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, Math.max(0, maxLength - 3)) + "...";
}
