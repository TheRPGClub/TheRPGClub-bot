import type { ICodexEntry, ICodexMember } from "../services/CodexApi.js";
import { isIsoDate } from "./ClubDate.js";

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

/**
 * A Club Codex date at the precision the club knows it: "12 August 2020", "March 2018"
 * or "2016". Null when there is no date. The date is a calendar date, read in UTC.
 */
export function formatCodexDate(
  occurredOn: string | null,
  precision: ICodexEntry["date_precision"],
): string | null {
  if (!occurredOn || !precision || !isIsoDate(occurredOn)) return null;
  const date = new Date(`${occurredOn}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const parts: Intl.DateTimeFormatOptions = precision === "year"
    ? { year: "numeric" }
    : precision === "month"
      ? { month: "long", year: "numeric" }
      : { day: "numeric", month: "long", year: "numeric" };
  return date.toLocaleDateString("en-GB", { ...parts, timeZone: "UTC" });
}

/** Each History Event Kind as members read it. */
export const HISTORY_KIND_LABELS: Readonly<Record<NonNullable<ICodexEntry["kind"]>, string>> = {
  founding: "Founding",
  staff: "Staff",
  platform: "Platform",
  rules: "Rules",
  milestone: "Milestone",
};
