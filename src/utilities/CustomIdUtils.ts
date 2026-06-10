import { logError } from "./LogUtils.js";

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

export function logUnexpectedCustomId(customId: string): void {
  logError("UnexpectedCustomId", customId);
}

export function parseCustomIdSegmentsMin(
  customId: string,
  minCount: number,
): string[] | null {
  const segments = customId.split(":").slice(1);
  if (segments.length < minCount) return null;
  return segments;
}

export function assertCustomIdSegments(
  interaction: { customId: string },
  expectedCount: number,
): string[] | null {
  const segs = parseCustomIdSegments(interaction.customId, expectedCount);
  if (!segs) logUnexpectedCustomId(interaction.customId);
  return segs;
}

export function getCustomIdPrefix(customId: string): string {
  return customId.split(":")[0];
}
