export function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

export function decodeBase64Url(value: string, fallback = ""): string {
  if (!value) return fallback;
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return fallback;
  }
}

/**
 * Encodes a string to base64url, trimming characters from the end until it
 * fits within maxLength. Returns fallback if it cannot fit at all.
 */
export function encodeWithMaxLength(
  query: string,
  maxLength: number,
  fallback = "",
): string {
  if (!query) return fallback;
  if (maxLength <= 0) return fallback;
  let trimmed = query.trim();
  while (trimmed.length > 0) {
    const encoded = encodeBase64Url(trimmed);
    if (encoded.length <= maxLength) return encoded;
    trimmed = trimmed.slice(0, -1);
  }
  return fallback;
}
