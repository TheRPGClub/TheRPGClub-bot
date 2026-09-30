/**
 * Escape every backtick in serialized JSON as the JSON unicode escape (backslash, "u0060").
 * JSON.stringify output only holds backticks inside string literals, where the escape
 * decodes to the same value, and a backtick-free body can never close its code fence
 * early. Discord ends a code block at the first triple backtick, so a longer fence would
 * not help.
 */
export function escapeJsonBackticks(json: string): string {
  return json.replaceAll("`", "\\u0060");
}

/** Wrap serialized JSON in a ```json code block that its content cannot break. */
export function jsonCodeBlock(json: string): string {
  return `\`\`\`json\n${escapeJsonBackticks(json)}\n\`\`\``;
}
