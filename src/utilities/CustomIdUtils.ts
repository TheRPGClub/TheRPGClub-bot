/**
 * Splits a colon-delimited custom ID and returns the segments after the prefix.
 * Returns null if the segment count does not match expectedCount.
 */
export function parseCustomIdSegments(
  customId: string,
  expectedCount: number,
): string[] | null {
  const parts = customId.split(":");
  const segments = parts.slice(1);
  if (segments.length !== expectedCount) return null;
  return segments;
}
