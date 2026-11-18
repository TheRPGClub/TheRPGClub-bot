import type { DatePrecision } from "../types/GameTypes.js";

export function formatPlaytimeHours(val: number | null | undefined): string | null {
  if (val === null || val === undefined) return null;
  const rounded = Math.round(val * 100) / 100;
  return `${rounded} hours`;
}

export function formatTableDate(date: Date | null): string {
  if (!date) return "No date";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

export function toUnixTimestamp(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

export function formatDiscordTimestamp(value: Date | string | null | undefined): string {
  if (!value) return "Unknown";
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return "Unknown";
  return `<t:${toUnixTimestamp(date)}:F>`;
}

export function formatLocalNumber(value: number): string {
  return value.toLocaleString("en-US");
}

export function formatMonthYear(date: Date, timeZone = "UTC"): string {
  return date.toLocaleString("en-US", { month: "long", year: "numeric", timeZone });
}

const MONTH_ABBREVIATIONS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

type DatedPrecision = Exclude<DatePrecision, "tba">;

interface IDatePrecisionPeriod {
  /** How a Release at this precision reads. */
  label: (year: number, monthIndex: number, day: number) => string;
  /** The first day of the period holding the date, at UTC midnight. */
  periodStart: (year: number, monthIndex: number, day: number) => number;
  /** The first day after that period (its exclusive end), at UTC midnight. */
  periodEnd: (year: number, monthIndex: number, day: number) => number;
  /**
   * Where the Release Calendar places the period: a day on itself, a month before day 1 of
   * its month, a quarter after its last day, a year after its Q4.
   */
  placedAt: "start" | "end";
  /** Orders entries placed on the same instant: quarter, then year, then month, then day. */
  tieRank: number;
}

const quarterStartMonth = (monthIndex: number): number => Math.floor(monthIndex / 3) * 3;

// One entry per Date Precision, shared by the label and the Release Calendar placement.
const DATE_PRECISION_PERIODS: Record<DatedPrecision, IDatePrecisionPeriod> = {
  day: {
    label: (year, monthIndex, day) =>
      `${String(monthIndex + 1).padStart(2, "0")}/${String(day).padStart(2, "0")}/${year}`,
    periodStart: (year, monthIndex, day) => Date.UTC(year, monthIndex, day),
    periodEnd: (year, monthIndex, day) => Date.UTC(year, monthIndex, day + 1),
    placedAt: "start",
    tieRank: 1,
  },
  month: {
    label: (year, monthIndex) => `${MONTH_ABBREVIATIONS[monthIndex]} ${year}`,
    periodStart: (year, monthIndex) => Date.UTC(year, monthIndex, 1),
    periodEnd: (year, monthIndex) => Date.UTC(year, monthIndex + 1, 1),
    placedAt: "start",
    tieRank: 0,
  },
  quarter: {
    label: (year, monthIndex) => `Q${quarterStartMonth(monthIndex) / 3 + 1} ${year}`,
    periodStart: (year, monthIndex) => Date.UTC(year, quarterStartMonth(monthIndex), 1),
    periodEnd: (year, monthIndex) => Date.UTC(year, quarterStartMonth(monthIndex) + 3, 1),
    placedAt: "end",
    tieRank: -2,
  },
  year: {
    label: (year) => String(year),
    periodStart: (year) => Date.UTC(year, 0, 1),
    periodEnd: (year) => Date.UTC(year + 1, 0, 1),
    placedAt: "end",
    tieRank: -1,
  },
};

function datedPeriod(
  date: Date | null,
  precision: DatePrecision,
): { period: IDatePrecisionPeriod; parts: [number, number, number] } | null {
  if (!date || Number.isNaN(date.getTime()) || precision === "tba") return null;
  return {
    period: DATE_PRECISION_PERIODS[precision],
    parts: [date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()],
  };
}

// A Release date is a plain calendar date ("YYYY-MM-DD", read as UTC midnight), so it is
// always read in UTC: the host's time zone must never move it to the day before.
export function formatReleaseDate(date: Date | null, precision: DatePrecision): string {
  const dated = datedPeriod(date, precision);
  return dated ? dated.period.label(...dated.parts) : "TBA";
}

/**
 * Where the Release Calendar places a Release, as [UTC timestamp, tie-break rank]: sorting
 * by it puts "Q4 2027" < "2027" < "Jan 2028" < "01/01/2028", with TBA last.
 */
export function releaseCalendarPlacement(
  date: Date | null,
  precision: DatePrecision,
): [number, number] {
  const dated = datedPeriod(date, precision);
  if (!dated) return [Number.POSITIVE_INFINITY, 0];
  const { period, parts } = dated;
  const placed = period.placedAt === "start"
    ? period.periodStart(...parts)
    : period.periodEnd(...parts);
  return [placed, period.tieRank];
}
