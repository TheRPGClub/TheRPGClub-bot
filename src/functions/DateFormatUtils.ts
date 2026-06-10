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

export function formatDiscordTimestamp(value: Date | string | null | undefined): string {
  if (!value) return "Unknown";
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return "Unknown";
  const seconds = Math.floor(date.getTime() / 1000);
  return `<t:${seconds}:F>`;
}

export function formatLocalNumber(value: number): string {
  return value.toLocaleString("en-US");
}

export function formatMonthYear(date: Date, timeZone = "UTC"): string {
  return date.toLocaleString("en-US", { month: "long", year: "numeric", timeZone });
}
