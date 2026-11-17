import { DateTime } from "luxon";
import type {
  ChallengeFormat,
  IChallenge,
  IChallengeMember,
  IChallengePool,
} from "../services/ChallengeApi.js";

// The words every Challenge view and post shares (spec api#376), in the API glossary's
// terms: Host, Pool, Season, Always Open, Seasonal, Cleared, Finish.

/** The club's time zone, which decides which day it is for Seasons and end dates. */
export const CHALLENGE_TIME_ZONE = "America/New_York";

export const CHALLENGE_FORMAT_LABELS: Readonly<Record<ChallengeFormat, string>> = {
  pool: "Pool",
  slots: "Slots",
  assignment: "Assignment",
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
    included ? `${included} ${included === 1 ? "game" : "games"} added by hand` : null,
  ].filter((part): part is string => part !== null);
  const count = pool.game_count;
  const games = typeof count === "number" ? `${count} ${count === 1 ? "game" : "games"}` : "Games";
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

/** The club's date today, as an ISO date. */
export function clubToday(now: Date = new Date()): string {
  return DateTime.fromJSDate(now).setZone(CHALLENGE_TIME_ZONE).toISODate() ?? "";
}

function seasonDate(year: number, monthDay: string): DateTime {
  const [month, day] = monthDay.split("-").map(Number);
  return DateTime.fromObject({ year, month, day }, { zone: CHALLENGE_TIME_ZONE });
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
      let endDay = seasonDate(today.year, end);
      if (endDay < today) endDay = seasonDate(today.year + 1, end);
      return endDay.plus({ days: 1 }).toJSDate();
    }
    let startDay = seasonDate(today.year, start);
    if (startDay <= today) startDay = seasonDate(today.year + 1, start);
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
