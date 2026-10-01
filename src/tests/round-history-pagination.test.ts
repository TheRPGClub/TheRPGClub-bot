import test from "node:test";
import assert from "node:assert/strict";
import type { Client } from "discord.js";
import {
  buildRoundHistoryPageResponse,
  paginateRoundHistory,
  type IRoundHistoryFilterState,
  type IRoundHistoryRecord,
} from "../commands/round-history.command.js";
import { ROUND_HISTORY_GAMES_PER_PAGE } from "../config/pagination.js";
import { DISCORD_V2_COMPONENTS_MAX } from "../config/textLimits.js";

const fakeClient = {
  channels: {
    fetch: async (threadId: string) => ({
      fetchStarterMessage: async () => ({
        attachments: new Map([
          ["1", { url: `https://images.example/${threadId}.png`, contentType: "image/png" }],
        ]),
        embeds: [],
      }),
    }),
  },
} as unknown as Client;

function games(round: number, kind: string, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    title: `${kind} ${round}-${i + 1}`,
    threadId: `${round}${kind.length}${i}`,
    redditUrl: "https://reddit.example/r",
    gamedbGameId: round * 100 + i,
  }));
}

function record(round: number, gotmCount: number, nrCount: number): IRoundHistoryRecord {
  const monthYear = `Month ${round} 2026`;
  return {
    round,
    gotmEntries: [{ round, monthYear, gameOfTheMonth: games(round, "GOTM", gotmCount) }],
    nrGotmEntries: [{ round, monthYear, gameOfTheMonth: games(round, "NR", nrCount) }],
  };
}

function countComponents(node: unknown): number {
  if (!node || typeof node !== "object") return 0;
  const { components, accessory } = node as { components?: unknown[]; accessory?: unknown };
  const children = (components ?? []).reduce<number>((sum, c) => sum + countComponents(c), 0);
  return 1 + children + (accessory ? countComponents(accessory) : 0);
}

function state(page: number): IRoundHistoryFilterState {
  return { ownerUserId: "1", kind: "both", query: "", year: 2026, sort: "asc", page };
}

// Twelve rounds with ties on both sides, so a page never holds a whole year.
const fullYear = Array.from({ length: 12 }, (_, i) => record(i + 1, 2, 2));

test("every round history page of a full year fits the component limit", async () => {
  const pages = paginateRoundHistory(fullYear);
  assert.ok(pages.length > 1);

  for (let page = 0; page < pages.length; page += 1) {
    const response = await buildRoundHistoryPageResponse(
      fakeClient, "123", state(page), fullYear,
    );
    const json = response.components.map((component) => component.toJSON());
    const total = json.reduce((sum, component) => sum + countComponents(component), 0);
    assert.ok(total <= DISCORD_V2_COMPONENTS_MAX, `page ${page + 1} has ${total} components`);
    // Container, title, intro and a four-part pagination row, then three per game.
    assert.equal(total, 7 + 3 * pages[page].cards.length);
    assert.equal(response.totalPages, pages.length);
  }
});

test("pagination keeps every game once and keeps rounds together", () => {
  const pages = paginateRoundHistory(fullYear);
  const titles = pages.flatMap((page) => page.cards.map((card) => card.title));

  assert.equal(titles.length, 48);
  assert.equal(new Set(titles).size, 48);
  for (const page of pages) {
    assert.ok(page.cards.length <= ROUND_HISTORY_GAMES_PER_PAGE);
    assert.equal(page.cards.length % 4, 0);
  }
});

test("a round larger than a page splits across pages", () => {
  const pages = paginateRoundHistory([record(1, ROUND_HISTORY_GAMES_PER_PAGE + 3, 1)]);

  assert.equal(pages.length, 2);
  assert.equal(pages[0].cards.length, ROUND_HISTORY_GAMES_PER_PAGE);
  assert.equal(pages[1].cards.length, 4);
});

test("a page filled to the game budget still fits the component limit", async () => {
  const rounds = [record(1, ROUND_HISTORY_GAMES_PER_PAGE + 3, 1)];
  const response = await buildRoundHistoryPageResponse(fakeClient, "123", state(0), rounds);
  const total = response.components
    .map((component) => component.toJSON())
    .reduce((sum, component) => sum + countComponents(component), 0);

  assert.ok(total <= DISCORD_V2_COMPONENTS_MAX, `full page has ${total} components`);
});
