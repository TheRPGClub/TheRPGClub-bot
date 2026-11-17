import { AxiosError, AxiosHeaders, type AxiosResponse } from "axios";
import type { IChallenge, IChallengeRun, IGameSummary } from "../services/ChallengeApi.js";
import type {
  IChallengeEdition,
  ISantaBacklogEntry,
  ISantaView,
} from "../services/ChallengeEditionApi.js";

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

/** The club's Secret Santa: an Assignment Challenge whose 2026 Edition takes sign-ups. */
export function santaChallenge(overrides: Partial<IChallenge> = {}): IChallenge {
  return poolChallenge({
    id: 9,
    name: "Secret Santa",
    description: "The club's yearly gift exchange.",
    challenge_format: "assignment",
    hosted_by_club: true,
    host: null,
    schedule: "always_open",
    season: null,
    pool: null,
    assignment: {
      signup_cutoff: "12-01",
      pick_deadline: "12-15",
      reveal: "12-25",
      edition: {
        id: 12,
        year: 2026,
        phase: "signup",
        signup_opens_on: "2025-12-26",
        signup_cutoff_on: "2026-12-01",
        pick_deadline_on: "2026-12-15",
        reveal_on: "2026-12-25",
        ends_on: "2027-12-25",
      },
    },
    tint: { fill: "#1c6545", hi: "#3fbf8a" },
    ...overrides,
  });
}

/** Secret Santa's 2026 Edition, in sign-up with 14 members. */
export function santaEdition(overrides: Partial<IChallengeEdition> = {}): IChallengeEdition {
  return {
    id: 12,
    year: 2026,
    phase: "signup",
    challenge: { id: 9, name: "Secret Santa" },
    signup_opens_on: "2025-12-26",
    signup_cutoff_on: "2026-12-01",
    pick_deadline_on: "2026-12-15",
    reveal_on: "2026-12-25",
    ends_on: "2027-12-25",
    signup_open: true,
    signed_up_count: 14,
    signed_up: false,
    members: [],
    drawn_at: null,
    ...overrides,
  };
}

/** A game in the recipient's backlog, on a platform. */
export function backlogEntry(
  id: number,
  title: string,
  platform: string | null = "PlayStation 2",
): ISantaBacklogEntry {
  return {
    entry_id: 500 + id,
    gamedb_game_id: id,
    platform_id: platform ? 7 : null,
    game: game(id, title),
    platform: platform ? { platform_id: 7, platform_name: platform } : null,
  };
}

/** Kaiserkaze's side as Lufia's Santa in the 2026 Edition: picking, nothing picked yet. */
export function santaView(overrides: Partial<ISantaView> = {}): ISantaView {
  return {
    edition_id: 12,
    year: 2026,
    recipient: { user_id: "101", username: "lufia", global_name: "Lufia" },
    taste: {
      genres: [
        { genre_id: 1, name: "Role-playing (RPG)" },
        { genre_id: 2, name: "Adventure" },
        { genre_id: 3, name: "Strategy" },
      ],
      platform: { platform_id: 7, platform_name: "PlayStation 2" },
    },
    pick: null,
    pick_deadline_on: "2026-12-15",
    picks_open: true,
    backlog: [
      backlogEntry(1, "Shadow Hearts: Covenant"),
      backlogEntry(2, "Dragon Quest XI S", "Nintendo Switch"),
      backlogEntry(3, "Chained Echoes", null),
    ],
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
