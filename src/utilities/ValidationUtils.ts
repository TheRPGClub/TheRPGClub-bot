export function isPositiveInt(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

/** Throws with the given label if value is not a positive integer. */
export function requirePositiveInt(value: unknown, label = "ID"): number {
  if (!isPositiveInt(value)) throw new Error(`Invalid ${label}.`);
  return value as number;
}
