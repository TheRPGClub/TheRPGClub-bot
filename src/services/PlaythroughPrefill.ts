import { PLAYTIME_API, withinDeadline, type IGamePlaytime } from "./PlaytimeApi.js";
import { logError } from "../utilities/LogUtils.js";

/**
 * Final playtime prefill from the member's open Playthrough (spec api#457, bot#1573).
 *
 * The completion flows read `GET /users/:id/games/:game_id/playtime` (PlaytimeApi `find`) and offer the open
 * Playthrough's time, in hours, as the final playtime. The member can change it. The API
 * also fills an empty `final_playtime_hrs` from the same Playthrough on create, so a lookup
 * that fails or is slow just leaves the field blank.
 */

/** Modal flows must answer within Discord's 3 second window, so the lookup is capped. */
export const PLAYTHROUGH_PREFILL_TIMEOUT_MS = 1_500;

/** The part of a member's Playtime document the prefill reads. */
type PlaytimeDocument = { playthrough?: Pick<IGamePlaytime, "playthrough">["playthrough"] };

/** Reads a member's Playtime for a game: null on a 404. The Playtime API client's `find`. */
type PlaytimeGetter = (userId: string, gameId: number) => Promise<PlaytimeDocument | null>;

/** Playthrough minutes as hours with 2 decimals, as the API fills `final_playtime_hrs`. */
export function playthroughMinutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

/** The open Playthrough's time in hours, or null when none is open. */
export function prefillHoursFromPlaytime(doc: PlaytimeDocument | null): number | null {
  const minutes = doc?.playthrough?.minutes;
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < 0) {
    return null;
  }
  return playthroughMinutesToHours(minutes);
}

/** The text a modal input shows for a prefill, or undefined to leave it blank. */
export function prefillInputValue(hours: number | null | undefined): string | undefined {
  return hours == null ? undefined : String(hours);
}

export const playthroughPrefill = {
  /**
   * Hours to prefill for a member's game, or null when no Playthrough is open, the lookup
   * fails, or it takes longer than `timeoutMs`. Never throws.
   */
  async fetchHours(
    userId: string,
    gameId: number,
    options: { timeoutMs?: number; get?: PlaytimeGetter } = {},
  ): Promise<number | null> {
    const get: PlaytimeGetter = options.get ?? ((user, game) => PLAYTIME_API.find(user, game));
    try {
      const request = get(userId, gameId);
      const doc = options.timeoutMs == null
        ? await request
        : await withinDeadline(request, options.timeoutMs);
      return prefillHoursFromPlaytime(doc);
    } catch (err: unknown) {
      logError("PlaythroughPrefill.fetchHours", err);
      return null;
    }
  },

  /**
   * The final playtime to send: the member's own value when given, else the open
   * Playthrough's time (for flows with no input to prefill, like `/game-completion add`).
   */
  async resolveFinalHours(
    userId: string,
    gameId: number,
    given: number | null,
  ): Promise<number | null> {
    if (given != null) return given;
    return playthroughPrefill.fetchHours(userId, gameId);
  },
};
