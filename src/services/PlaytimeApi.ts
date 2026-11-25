import {
  apiDelete,
  apiGetOrThrow,
  apiPostOrThrow,
} from "./RpgClubApiClient.js";

// The Playtime endpoints the bot calls (spec api#457, tickets api#458 and api#459). The
// shapes are the API's own (snake_case), as its swagger serves them. Every write answers
// with the game's whole Playtime document, so a receipt never needs a second read. The
// bot's service token may write for any member.

export type PlaytimeProvider = "steam" | "retroachievements" | "psn";

/** A Provider's figure for one Achievement Set mapped to the game. */
export interface IPlaytimeProviderSet {
  achievement_set_id: number;
  provider: PlaytimeProvider;
  title?: string | null;
  /** The Provider's own platform label, raw. */
  platform_label?: string | null;
  /** The GameDB platform the label resolves to; null when it doesn't. */
  platform_id?: number | null;
  platform_name?: string | null;
  minutes: number;
  /** False when the member kept their Manual entry on this platform over it. */
  counted: boolean;
}

/** A Manual Playtime entry: one per member, game and platform (null is "Other"). */
export interface IManualPlaytimeEntry {
  id: number;
  platform_id?: number | null;
  platform_name?: string | null;
  minutes: number;
  note?: string | null;
  origin: "member" | "completion_seed";
  keeps_over_provider?: PlaytimeProvider | null;
}

/** A Manual entry and a Provider on the same platform, with no keep chosen. */
export interface IPlaytimeMismatch {
  platform_id: number;
  platform_name?: string | null;
  provider: PlaytimeProvider;
  provider_minutes: number;
  manual_playtime_id: number;
  manual_minutes: number;
}

/** The member's open Playthrough of the game. */
export interface IOpenPlaythrough {
  id: number;
  started_at: string;
  minutes: number;
  manual: boolean;
}

/** A member's Playtime for one game: `GET /users/:user_id/games/:game_id/playtime`. */
export interface IGamePlaytime {
  user_id: string;
  game_id: number;
  total_minutes: number;
  breakdown: {
    provider_sets: IPlaytimeProviderSet[];
    manual_entries: IManualPlaytimeEntry[];
  };
  mismatches: IPlaytimeMismatch[];
  playthrough: IOpenPlaythrough | null;
}

export type ManualPlaytimeMode = "add" | "set";

export interface IManualPlaytimeWrite {
  /** Null is "Other". */
  platformId: number | null;
  minutes: number;
  mode: ManualPlaytimeMode;
}

export interface IPlaytimeApi {
  /** The member's Playtime for the game. Throws the AxiosError on a failure, 404 included. */
  get(userId: string, gameId: number): Promise<IGamePlaytime>;
  /** Adds to or sets the member's Manual entry on a platform (an upsert). */
  writeManual(userId: string, gameId: number, write: IManualPlaytimeWrite): Promise<IGamePlaytime>;
  /** Deletes a Manual entry. Null when it is already gone. */
  deleteManual(entryId: number): Promise<IGamePlaytime | null>;
}

export function playtimePath(userId: string, gameId: number): string {
  return `/api/v1/users/${encodeURIComponent(userId)}/games/${gameId}`;
}

export const PLAYTIME_API: IPlaytimeApi = {
  async get(userId, gameId) {
    const payload = await apiGetOrThrow<{ data: IGamePlaytime }>(
      `${playtimePath(userId, gameId)}/playtime`,
    );
    return payload.data;
  },
  async writeManual(userId, gameId, write) {
    const payload = await apiPostOrThrow<{ data: IGamePlaytime }>(
      `${playtimePath(userId, gameId)}/manual_playtimes`,
      { data: { platform_id: write.platformId, minutes: write.minutes, mode: write.mode } },
    );
    return payload.data;
  },
  async deleteManual(entryId) {
    const payload = await apiDelete<{ data: IGamePlaytime }>(
      `/api/v1/manual_playtimes/${entryId}`,
    );
    return payload?.data ?? null;
  },
};
