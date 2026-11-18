import { DateTime } from "luxon";
import type {
  ChallengeFormat,
  IChallenge,
  IChallengeMember,
  IChallengePool,
} from "../services/ChallengeApi.js";
import { plural } from "../utilities/TextUtils.js";
import { CLUB_TIME_ZONE } from "./ClubDate.js";

// The words every Challenge view and post shares (spec api#376), in the API glossary's
// terms: Host, Pool, Season, Always Open, Seasonal, Cleared, Finish.

/** The club's time zone, which decides which day it is for Seasons and end dates. */
export const CHALLENGE_TIME_ZONE = CLUB_TIME_ZONE;

export const CHALLENGE_FORMAT_LABELS: Readonly<Record<ChallengeFormat, string>> = {
  pool: "Pool",
  slots: "Slots",
  assignment: "Assignment",
};

/** Each Format's ink, for small markers such as a Run card's accent (DESIGN.md). */
export const CHALLENGE_FORMAT_INKS: Readonly<Record<ChallengeFormat, number>> = {
  pool: 0x3ba7e0,
  slots: 0xe0a03b,
  assignment: 0x3fb57a,
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "09-22" as "22 September"; the text itself when it is not a month and day. */
export function formatMonthDay(monthDay: string): string {
  const match = /^(\d{2})-(\d{2})$/.exec(monthDay);
  const month = match ? MONTHS[Number(match[1]) - 1] : undefined;
  return match && month ? `${Number(match[2])} ${month}` : monthDay;
}

/** "2027-03-03" as "3 March 2027". */
export function formatChallengeDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  const monthName = MONTHS[Number(month) - 1];
  return monthName && year && day ? `${Number(day)} ${monthName} ${year}` : isoDate;
}

/** A member's name as Discord shows it: their display name, else their username. */
export function memberName(member: IChallengeMember): string {
  return member.global_name?.trim() || member.username;
}

/** Keeps a name from the API from turning into Discord formatting. */
export function escapeChallengeText(text: string): string {
  return text.replace(/([\\*_~`|>[\]])/g, "\\$1");
}

/** "a", "a and b", "a, b and c". */
export function listJoin(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function namedGroup(names: readonly string[], one: string, many: string): string | null {
  if (!names.length) return null;
  return `the ${listJoin(names.map(escapeChallengeText))} ${names.length === 1 ? one : many}`;
}

/** "38 games from the Final Fantasy franchise": where a Pool's games come from. */
export function describePool(pool: IChallengePool): string {
  const included = pool.included_games?.length ?? 0;
  const sources = [
    namedGroup((pool.franchises ?? []).map((f) => f.name), "franchise", "franchises"),
    namedGroup((pool.collections ?? []).map((c) => c.name), "collection", "collections"),
    included ? `${plural(included, "game")} added by hand` : null,
  ].filter((part): part is string => part !== null);
  const count = pool.game_count;
  const games = typeof count === "number" ? `${plural(count, "game")}` : "Games";
  return sources.length ? `${games} from ${listJoin(sources)}` : games;
}

/** What it takes to Finish a Pool Run: "Clear 3", or every game. */
export function describePoolTarget(pool: IChallengePool): string {
  return pool.target === "all" ? "Clear every game in the Pool" : `Clear ${pool.target}`;
}

/** The schedule as a label and its value: Season dates, or Always Open with its end. */
export function describeSchedule(challenge: IChallenge): { label: string; value: string } {
  if (challenge.schedule === "seasonal" && challenge.season) {
    const { start, end } = challenge.season;
    return {
      label: "Season",
      value: `${formatMonthDay(start)} to ${formatMonthDay(end)}, every year`,
    };
  }
  return {
    label: "Always Open",
    value: challenge.ends_on ? `until ${formatChallengeDate(challenge.ends_on)}` : "no end date",
  };
}

/** One line of the schedule for a summary line: "Seasonal, 22 September to 21 December". */
export function describeScheduleShort(challenge: IChallenge): string {
  if (challenge.schedule === "seasonal" && challenge.season) {
    const { start, end } = challenge.season;
    return `Seasonal, ${formatMonthDay(start)} to ${formatMonthDay(end)}`;
  }
  return challenge.ends_on
    ? `Always Open until ${formatChallengeDate(challenge.ends_on)}`
    : "Always Open";
}

/** Who hosts it: the Host's mention (which callers keep from pinging), or the club. */
export function hostLabel(challenge: IChallenge): string {
  if (challenge.hosted_by_club || !challenge.host) return "the club";
  return `<@${challenge.host.user_id}>`;
}

/**
 * A Season's first or last day in a year. A 29 February the year lacks falls back as the
 * API's does (Challenges::Schedule): a Season starts on 1 March and ends on 28 February.
 */
function seasonDate(year: number, monthDay: string, edge: "start" | "end"): DateTime {
  const [month, day] = monthDay.split("-").map(Number);
  const date = DateTime.fromObject({ year, month, day }, { zone: CHALLENGE_TIME_ZONE });
  if (date.isValid) return date;
  const fallback = edge === "start" ? { month: 3, day: 1 } : { month: 2, day: 28 };
  return DateTime.fromObject({ year, ...fallback }, { zone: CHALLENGE_TIME_ZONE });
}

/**
 * Whether it is Open now and the moment that changes: the end of the Season or end date
 * while Open, the start of the next Season while Closed. Null when nothing will change.
 */
export function nextOpenChange(challenge: IChallenge, now: Date = new Date()): Date | null {
  const today = DateTime.fromJSDate(now).setZone(CHALLENGE_TIME_ZONE).startOf("day");
  if (challenge.schedule === "seasonal" && challenge.season) {
    const { start, end } = challenge.season;
    if (challenge.open) {
      let endDay = seasonDate(today.year, end, "end");
      if (endDay < today) endDay = seasonDate(today.year + 1, end, "end");
      return endDay.plus({ days: 1 }).toJSDate();
    }
    let startDay = seasonDate(today.year, start, "start");
    if (startDay <= today) startDay = seasonDate(today.year + 1, start, "start");
    return startDay.toJSDate();
  }
  if (!challenge.open || !challenge.ends_on) return null;
  return DateTime.fromISO(challenge.ends_on, { zone: CHALLENGE_TIME_ZONE })
    .plus({ days: 1 })
    .toJSDate();
}

/** "Open, closes <t:...:R>", "Closed, opens <t:...:R>", "Open" or "Closed". */
export function describeOpen(challenge: IChallenge, now: Date = new Date()): string {
  const change = nextOpenChange(challenge, now);
  const state = challenge.open ? "Open" : "Closed";
  if (!change) return state;
  const when = `<t:${Math.floor(change.getTime() / 1000)}:R>`;
  return `${state}, ${challenge.open ? "closes" : "opens"} ${when}`;
}

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function monthNumber(name: string): number | null {
  const lower = name.toLowerCase();
  if (lower.length < 3) return null;
  const index = MONTHS.findIndex((month) => month.toLowerCase().startsWith(lower));
  return index >= 0 ? index + 1 : null;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * A day and month a member typed ("21 June", "June 21", "21 Jun", "06-21") as "MM-DD",
 * or null when it is not one. 29 February is a day and month; the API decides on it.
 */
export function parseMonthDay(input: string): string | null {
  const value = input.trim().replace(/,/g, " ").replace(/\s+/g, " ");
  let month: number | null = null;
  let day: number | null = null;
  let match = /^(\d{1,2})-(\d{1,2})$/.exec(value);
  if (match) {
    month = Number(match[1]);
    day = Number(match[2]);
  } else if ((match = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)\.?$/i.exec(value))) {
    day = Number(match[1]);
    month = monthNumber(match[2]!);
  } else if ((match = /^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?$/i.exec(value))) {
    month = monthNumber(match[1]!);
    day = Number(match[2]);
  }
  if (!month || !day || month > 12 || day > DAYS_IN_MONTH[month - 1]!) return null;
  return `${twoDigits(month)}-${twoDigits(day)}`;
}

/**
 * A date a member typed ("3 March 2027", "March 3 2027", "2027-03-03") as an ISO date, or
 * null when it is not one.
 */
export function parseChallengeDate(input: string): string | null {
  const value = input.trim().replace(/,/g, " ").replace(/\s+/g, " ");
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  let parts: { year: number; monthDay: string | null } | null = null;
  if (iso) {
    parts = { year: Number(iso[1]), monthDay: parseMonthDay(`${iso[2]}-${iso[3]}`) };
  } else {
    const withYear = /^(.*) (\d{4})$/.exec(value);
    if (withYear) parts = { year: Number(withYear[2]), monthDay: parseMonthDay(withYear[1]!) };
  }
  if (!parts?.monthDay) return null;
  const date = DateTime.fromISO(`${parts.year}-${parts.monthDay}`);
  return date.isValid ? date.toISODate() : null;
}
