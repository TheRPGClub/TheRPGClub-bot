import test from "node:test";
import assert from "node:assert/strict";
import type { Client } from "discord.js";
import {
  buildRoundHistoryPageResponse,
  paginateRoundHistory,
  type IRoundHistoryFilterState,
  type IRoundHistoryRecord,
} from "../commands/round-history.command.js";
import {
  ROUND_HISTORY_CARD_TEXT_BUDGET,
  ROUND_HISTORY_GAMES_PER_PAGE,
} from "../config/pagination.js";
import { DISCORD_V2_COMPONENTS_MAX, DISCORD_V2_TEXT_MAX } from "../config/textLimits.js";

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

const GUILD_ID = "1234567890123456789";
const LONG_REDDIT_URL =
  "https://www.reddit.com/r/TheRPGClub/comments/1abcdef/" +
  "gotm_round_142_voting_results_and_the_winning_games_of_the_month/";

function games(round: number, kind: string, count: number, redditUrl = LONG_REDDIT_URL) {
  return Array.from({ length: count }, (_, i) => ({
    title: `${kind} ${round}-${i + 1} A Fairly Long Game Title: The Subtitle Edition`,
    threadId: `1${String(round).padStart(9, "0")}${kind.length}${String(i).padStart(8, "0")}`,
    redditUrl,
    gamedbGameId: round * 100 + i,
  }));
}

function record(
  round: number,
  gotmCount: number,
  nrCount: number,
  redditUrl = LONG_REDDIT_URL,
): IRoundHistoryRecord {
  const monthYear = `Month ${round} 2026`;
  return {
    round,
    gotmEntries: [
      { round, monthYear, gameOfTheMonth: games(round, "GOTM", gotmCount, redditUrl) },
    ],
    nrGotmEntries: [{ round, monthYear, gameOfTheMonth: games(round, "NR", nrCount, redditUrl) }],
  };
}

function countComponents(node: unknown): number {
  if (!node || typeof node !== "object") return 0;
  const { components, accessory } = node as { components?: unknown[]; accessory?: unknown };
  const children = (components ?? []).reduce<number>((sum, c) => sum + countComponents(c), 0);
  return 1 + children + (accessory ? countComponents(accessory) : 0);
}

function textLength(node: unknown): number {
  if (!node || typeof node !== "object") return 0;
  const { content, components, accessory } = node as {
    content?: string;
    components?: unknown[];
    accessory?: unknown;
  };
  const children = (components ?? []).reduce<number>((sum, c) => sum + textLength(c), 0);
  return (content?.length ?? 0) + children + (accessory ? textLength(accessory) : 0);
}

function state(page: number): IRoundHistoryFilterState {
  return { ownerUserId: "1", kind: "both", query: "", year: 2026, sort: "asc", page };
}

// Twelve rounds with ties on both sides, so a page never holds a whole year.
const fullYear = Array.from({ length: 12 }, (_, i) => record(i + 1, 2, 2));

test("every round history page of a full year fits the component limit", async () => {
  const pages = paginateRoundHistory(fullYear, GUILD_ID);
  assert.ok(pages.length > 1);

  for (let page = 0; page < pages.length; page += 1) {
    const response = await buildRoundHistoryPageResponse(
      fakeClient, GUILD_ID, state(page), fullYear,
    );
    const json = response.components.map((component) => component.toJSON());
    const total = json.reduce((sum, component) => sum + countComponents(component), 0);
    assert.ok(total <= DISCORD_V2_COMPONENTS_MAX, `page ${page + 1} has ${total} components`);
    // Container, title, intro and a four-part pagination row, then three per game.
    assert.equal(total, 7 + 3 * pages[page].cards.length);
    assert.equal(response.totalPages, pages.length);
    const text = json.reduce((sum, component) => sum + textLength(component), 0);
    assert.ok(text <= DISCORD_V2_TEXT_MAX, `page ${page + 1} has ${text} characters`);
  }
});

test("pagination keeps every game once and keeps rounds together", () => {
  const pages = paginateRoundHistory(fullYear, GUILD_ID);
  const titles = pages.flatMap((page) => page.cards.map((card) => card.title));

  assert.equal(titles.length, 48);
  assert.equal(new Set(titles).size, 48);
  for (const page of pages) {
    assert.ok(page.cards.length <= ROUND_HISTORY_GAMES_PER_PAGE);
    assert.equal(page.cards.length % 4, 0);
  }
});

test("a round larger than a page splits across pages", () => {
  const round = record(1, ROUND_HISTORY_GAMES_PER_PAGE + 3, 1);
  for (const entry of [...round.gotmEntries, ...round.nrGotmEntries]) {
    entry.gameOfTheMonth = entry.gameOfTheMonth.map((game) => ({ ...game, redditUrl: null }));
  }
  const pages = paginateRoundHistory([round], GUILD_ID);

  assert.equal(pages.length, 2);
  assert.equal(pages[0].cards.length, ROUND_HISTORY_GAMES_PER_PAGE);
  assert.equal(pages[1].cards.length, 4);
});

test("a page filled to the game budget still fits the component limit", async () => {
  const rounds = [record(1, ROUND_HISTORY_GAMES_PER_PAGE + 3, 1)];
  const response = await buildRoundHistoryPageResponse(fakeClient, GUILD_ID, state(0), rounds);
  const total = response.components
    .map((component) => component.toJSON())
    .reduce((sum, component) => sum + countComponents(component), 0);

  assert.ok(total <= DISCORD_V2_COMPONENTS_MAX, `full page has ${total} components`);
});

test("long card text closes a page before the game budget", () => {
  const redditUrl = `${LONG_REDDIT_URL}?context=${"x".repeat(100)}`;
  const rounds = Array.from({ length: 12 }, (_, i) => record(i + 1, 1, 0, redditUrl));
  const pages = paginateRoundHistory(rounds, GUILD_ID);

  assert.ok(pages.every((page) => page.textLength <= ROUND_HISTORY_CARD_TEXT_BUDGET));
  assert.ok(pages[0].cards.length < ROUND_HISTORY_GAMES_PER_PAGE);
});
