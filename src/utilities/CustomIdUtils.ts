import { logError } from "./LogUtils.js";
import { DISCORD_CUSTOM_ID_MAX } from "../config/textLimits.js";

/**
 * Logs a clear error when a custom ID exceeds Discord's hard limit. An
 * over-length custom ID makes discord.js throw "Invalid string length" at
 * serialization time, which surfaces only as a silent "interaction failed".
 * Returns the id unchanged so it can be used inline at the call site.
 */
export function validateCustomId(customId: string): string {
  if (customId.length > DISCORD_CUSTOM_ID_MAX) {
    logError("validateCustomId", {
      message: "Custom ID exceeds Discord limit",
      length: customId.length,
      max: DISCORD_CUSTOM_ID_MAX,
      customId,
    });
  }
  return customId;
}

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

export function encodeVisibility(isEphemeral: boolean): string {
  return isEphemeral ? "e" : "p";
}

export function decodeVisibility(code: string): boolean | null {
  if (code === "e") return true;
  if (code === "p") return false;
  return null;
}
