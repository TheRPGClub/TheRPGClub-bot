import type {
  IChallengeRun,
  IChallengeRunEntry,
  IChallengeSlots,
} from "../services/ChallengeApi.js";
import { plural } from "../utilities/TextUtils.js";

// The words for Slots (spec api#376, bot#1550), in the glossary's terms: a slot per
// release year, Cleared, Caught Up for a range that grows, Counts past play.

/** "1990 to 1999", "Your birth year to the current year", ... */
export function describeSlotsRange(slots: IChallengeSlots): string {
  const first = slots.first_year === "birth_year" ? "Your birth year" : String(slots.first_year);
  const last = slots.last_year === "current_year" ? "the current year" : String(slots.last_year);
  return `${first} to ${last}`;
}

/** What it takes: "Clear all 10 slots", or Caught Up for a range that grows. */
export function describeSlotsTarget(slots: IChallengeSlots): string {
  if (slots.last_year === "current_year") {
    return "Clear every slot to be Caught Up; a new slot opens every 1 January";
  }
  if (slots.first_year === "birth_year") {
    return `Clear every slot from your birth year to ${slots.last_year}`;
  }
  const count = slots.last_year - slots.first_year + 1;
  return `Clear all ${plural(count, "slot")}`;
}

export const COUNTS_PAST_PLAY_LINE = "Pick earlier Game Completions for open years";

/** The decade a year falls in: 1994 is in 1990. */
export function decadeOf(year: number): number {
  return Math.floor(year / 10) * 10;
}

/** "1990s" */
export function decadeLabel(decade: number): string {
  return `${decade}s`;
}

/** The Run's decades, oldest first. */
export function runDecades(run: IChallengeRun): number[] {
  const slots = run.slots;
  if (!slots) return [];
  const decades: number[] = [];
  for (let d = decadeOf(slots.first_year); d <= decadeOf(slots.last_year); d += 10) {
    decades.push(d);
  }
  return decades;
}

/** The Run's years so far with no game in them, oldest first. */
export function openYears(run: IChallengeRun): number[] {
  return (run.slots?.years ?? []).filter((y) => !y.game_id).map((y) => y.year);
}

/** The Cleared games on the Run, each with the year it fills (null while waiting). */
export function clearedEntries(run: IChallengeRun): IChallengeRunEntry[] {
  return (run.entries ?? []).filter((entry) => entry.state === "cleared");
}

/** "2027" after a growing Run's last year: the next slot to open. */
export function nextSlotYear(run: IChallengeRun): number | null {
  return run.slots?.growing ? run.slots.last_year + 1 : null;
}
