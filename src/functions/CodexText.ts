import type { ICodexMember } from "../services/CodexApi.js";

// Club Codex text helpers shared by every part's Discord views.

/** A mention token as the API stores it: `<@id>`, or the legacy `<@!id>`. */
const MENTION_TOKEN = /<@!?(\d+)>/g;

/**
 * The entry's text with each known member's token as `@name`, for places Discord shows
 * as plain text (autocomplete choices, button labels). A token for no known member stays.
 */
export function plainCodexText(
  body: string | null,
  mentions: Readonly<Record<string, ICodexMember>>,
): string {
  return (body ?? "").replace(MENTION_TOKEN, (token, id: string) => {
    const member = mentions[id];
    return member ? `@${member.name}` : token;
  });
}
