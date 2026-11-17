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

// A Release date is a plain calendar date ("YYYY-MM-DD", read as UTC midnight), so it is
// always read in UTC: the host's time zone must never move it to the day before.
export function formatReleaseDate(date: Date | null, precision: DatePrecision): string {
  if (!date || Number.isNaN(date.getTime()) || precision === "tba") return "TBA";
  const year = date.getUTCFullYear();
  const monthIndex = date.getUTCMonth();
  switch (precision) {
    case "month":
      return `${MONTH_ABBREVIATIONS[monthIndex]} ${year}`;
    case "quarter":
      return `Q${Math.floor(monthIndex / 3) + 1} ${year}`;
    case "year":
      return String(year);
    default: {
      const month = String(monthIndex + 1).padStart(2, "0");
      const day = String(date.getUTCDate()).padStart(2, "0");
      return `${month}/${day}/${year}`;
    }
  }
}
