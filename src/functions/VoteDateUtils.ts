import { DateTime } from "luxon";

export const VOTE_TIME_ZONE = "America/New_York";
const VOTE_HOUR_ET = 12;

function withDefaultVoteTime(date: DateTime): DateTime {
  return date.set({ hour: VOTE_HOUR_ET, minute: 0, second: 0, millisecond: 0 });
}

export function parseVoteDateInput(input: string): Date | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const iso = DateTime.fromISO(trimmed, { zone: VOTE_TIME_ZONE });
  if (iso.isValid) {
    return withDefaultVoteTime(iso.startOf("day")).toUTC().toJSDate();
  }

  const fallbackFormats = [
    "yyyy-MM-dd",
    "M/d/yyyy",
    "M-d-yyyy",
    "MMMM d, yyyy",
    "MMM d, yyyy",
  ];
  for (const format of fallbackFormats) {
    const parsed = DateTime.fromFormat(trimmed, format, { zone: VOTE_TIME_ZONE });
    if (parsed.isValid) {
      return withDefaultVoteTime(parsed.startOf("day")).toUTC().toJSDate();
    }
  }

  return null;
}

export function formatVoteDateForDisplay(value: Date): string {
  return DateTime.fromJSDate(value).setZone(VOTE_TIME_ZONE).toFormat("MM/dd/yyyy");
}

/**
 * Mirrors the API's default voting deadline: voting opens at next_vote_at
 * (scheduled on a Friday) and ends at the end of the first Sunday at or after
 * it, in US Eastern. An explicit vote_ends_at on the round overrides this.
 */
export function calculateVoteDeadlineEt(opensAt: Date): Date {
  const opens = DateTime.fromJSDate(opensAt).setZone(VOTE_TIME_ZONE);
  const daysUntilSunday = (7 - (opens.weekday % 7)) % 7;
  return opens.plus({ days: daysUntilSunday }).endOf("day").toUTC().toJSDate();
}

export function calculateNextVoteDateEt(now: Date = new Date()): Date {
  let cursor = DateTime.fromJSDate(now).setZone(VOTE_TIME_ZONE).plus({ months: 1 }).endOf("month");
  while (cursor.weekday !== 5) {
    cursor = cursor.minus({ days: 1 });
  }
  return withDefaultVoteTime(cursor.startOf("day")).toUTC().toJSDate();
}
