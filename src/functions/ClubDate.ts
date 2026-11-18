import { DateTime } from "luxon";

// The club's calendar, shared by every Feature that asks which day it is: Challenges'
// Seasons and end dates, and the Daily Fun Fact's club date.

/** The club's time zone, which decides which day it is. */
export const CLUB_TIME_ZONE = "America/New_York";

/** The club's date today, as an ISO date. */
export function clubToday(now: Date = new Date()): string {
  return DateTime.fromJSDate(now).setZone(CLUB_TIME_ZONE).toISODate() ?? "";
}

/** True for a `YYYY-MM-DD` date as the API sends one (the shape only, not the calendar). */
export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
