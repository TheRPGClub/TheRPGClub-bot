import { AxiosError, AxiosHeaders, type AxiosResponse } from "axios";
import type {
  IChallenge,
  IChallengeRun,
  IChallengeRunEntry,
  IGameSummary,
} from "../services/ChallengeApi.js";

// Shared fixtures for the Challenge tests: a Pool Challenge as the API serves it, and a
// reader for the Components V2 JSON the Challenge views and posts are built from.

export function poolChallenge(overrides: Partial<IChallenge> = {}): IChallenge {
  return {
    id: 7,
    name: "Fall of Final Fantasy",
    description: "Play Final Fantasy through the autumn. Clear 3 to Finish.",
    challenge_format: "pool",
    hosted_by_club: false,
    host: { user_id: "111", username: "kaiserkaze", global_name: "Kaiserkaze" },
    schedule: "seasonal",
    ends_on: null,
    season: { start: "09-22", end: "12-21", crosses_new_year: false },
    open: true,
    pool: {
      target: 3,
      franchises: [{ franchise_id: 5, name: "Final Fantasy" }],
      collections: [],
      included_games: [],
      excluded_games: [],
      game_count: 38,
    },
    slots: null,
    assignment: null,
    run_count: 0,
    hidden: false,
    ended_at: null,
    ...overrides,
  };
}

/** Lufia's Active Run of the Fall of Final Fantasy: 2 of 3 Cleared, FF X In Progress. */
export function poolRun(overrides: Partial<IChallengeRun> = {}): IChallengeRun {
  return {
    id: 41,
    challenge: {
      id: 7,
      name: "Fall of Final Fantasy",
      challenge_format: "pool",
      schedule: "seasonal",
    },
    user: { user_id: "222", username: "lufia", global_name: "Lufia" },
    status: "active",
    started_at: "2026-09-23T14:00:00.000Z",
    ended_at: null,
    window: { starts_on: "2026-09-22", ends_on: "2026-12-21" },
    progress: { in_progress: 1, cleared: 2, target: 3 },
    entries: [
      { game_id: 9, title: "Final Fantasy IX", state: "cleared", cleared_on: "2026-10-02" },
      { game_id: 6, title: "Final Fantasy VI", state: "cleared", cleared_on: "2026-10-30" },
      { game_id: 10, title: "Final Fantasy X", state: "in_progress", cleared_on: null },
    ],
    ...overrides,
  };
}

/** Years Alive: a club-hosted Slots Challenge from each member's birth year to now. */
export function slotsChallenge(overrides: Partial<IChallenge> = {}): IChallenge {
  return poolChallenge({
    id: 12,
    name: "Years Alive",
    description: "One game from every year you've been alive.",
    challenge_format: "slots",
    hosted_by_club: true,
    host: null,
    schedule: "always_open",
    season: null,
    pool: null,
    slots: { first_year: "birth_year", last_year: "current_year", counts_past_play: true },
    ...overrides,
  });
}

/**
 * Tamsin's Run of Years Alive from 1994: every year Cleared but the years in `open` (titles are "Game <year>", game IDs the year), plus an In Progress game.
 */
export function slotsRun(
  options: { first?: number; last?: number; open?: number[]; growing?: boolean } = {},
  overrides: Partial<IChallengeRun> = {},
): IChallengeRun {
  const first = options.first ?? 1994;
  const last = options.last ?? 2026;
  const open = new Set(options.open ?? []);
  const years: { year: number; game_id: number | null; title: string | null }[] = [];
  const entries: IChallengeRunEntry[] = [];
  for (let year = first; year <= last; year += 1) {
    const filled = !open.has(year);
    years.push({ year, game_id: filled ? year : null, title: filled ? `Game ${year}` : null });
    if (filled) {
      entries.push({
        game_id: year,
        title: `Game ${year}`,
        state: "cleared",
        cleared_on: "2025-05-01",
        completion_id: 5000 + year,
        slot_year: year,
        picked_by_hand: false,
      });
    }
  }
  entries.push({
    game_id: 77,
    title: "Tales of Arise",
    state: "in_progress",
    cleared_on: null,
    slot_year: null,
    picked_by_hand: false,
  });
  const cleared = years.filter((y) => y.game_id !== null).length;
  return {
    id: 90,
    challenge: { id: 12, name: "Years Alive", challenge_format: "slots", schedule: "always_open" },
    user: { user_id: "333", username: "tamsin", global_name: "Tamsin" },
    status: "active",
    started_at: "2024-03-04T15:00:00.000Z",
    ended_at: null,
    window: { starts_on: "2024-03-04", ends_on: null },
    progress: {
      in_progress: 1,
      cleared,
      target: years.length,
      caught_up: cleared === years.length,
    },
    entries,
    slots: { first_year: first, last_year: last, growing: options.growing ?? true, years },
    ...overrides,
  };
}

export function game(id: number, title: string, year = 1990 + id): IGameSummary {
  return {
    game_id: id,
    title,
    initial_release_date: `${year}-06-01T00:00:00.000Z`,
    cover_url: `https://img.example/${id}.jpg`,
  };
}

/** A real AxiosError for an API refusal, as the client throws it. */
export function apiError(
  status: number,
  body: unknown,
  request: { method: string; url: string; data?: unknown },
): AxiosError {
  const config = {
    method: request.method,
    url: request.url,
    headers: new AxiosHeaders(),
    data: request.data === undefined ? undefined : JSON.stringify(request.data),
  };
  const response = { status, statusText: "", data: body, headers: {}, config } as AxiosResponse;
  return new AxiosError("Request failed", "ERR_BAD_REQUEST", config, null, response);
}

type Json = Record<string, unknown>;

function walk(node: unknown, visit: (component: Json) => void): void {
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, visit));
    return;
  }
  if (!node || typeof node !== "object") return;
  const json = typeof (node as { toJSON?: unknown }).toJSON === "function"
    ? (node as { toJSON: () => unknown }).toJSON()
    : node;
  const component = json as Json;
  visit(component);
  walk(component.components, visit);
  walk(component.accessory, visit);
  walk(component.component, visit);
}

/** Every text display's content, in order, joined by new lines. */
export function textOf(components: unknown): string {
  const parts: string[] = [];
  walk(components, (c) => {
    if (c.type === 10 && typeof c.content === "string") parts.push(c.content);
  });
  return parts.join("\n");
}

/** The media gallery image URLs, in order. */
export function galleryUrls(components: unknown): string[] {
  const urls: string[] = [];
  walk(components, (c) => {
    if (c.type !== 12 || !Array.isArray(c.items)) return;
    for (const item of c.items as { media: { url: string } }[]) urls.push(item.media.url);
  });
  return urls;
}

export interface IButtonView {
  label: string;
  customId: string | null;
  url: string | null;
  disabled: boolean;
  style: number;
}

/** Every button, in order. */
export function buttonsOf(components: unknown): IButtonView[] {
  const buttons: IButtonView[] = [];
  walk(components, (c) => {
    if (c.type !== 2) return;
    buttons.push({
      label: String(c.label ?? ""),
      customId: typeof c.custom_id === "string" ? c.custom_id : null,
      url: typeof c.url === "string" ? c.url : null,
      disabled: c.disabled === true,
      style: Number(c.style),
    });
  });
  return buttons;
}

export interface ISelectView {
  customId: string;
  options: { label: string; value: string; default: boolean }[];
  minValues: number | null;
  maxValues: number | null;
}

/** Every string select, in order. */
export function selectsOf(components: unknown): ISelectView[] {
  const selects: ISelectView[] = [];
  walk(components, (c) => {
    if (c.type !== 3) return;
    const options = (c.options as { label: string; value: string; default?: boolean }[]) ?? [];
    selects.push({
      customId: String(c.custom_id),
      options: options.map((o) => ({ label: o.label, value: o.value, default: !!o.default })),
      minValues: typeof c.min_values === "number" ? c.min_values : null,
      maxValues: typeof c.max_values === "number" ? c.max_values : null,
    });
  });
  return selects;
}
