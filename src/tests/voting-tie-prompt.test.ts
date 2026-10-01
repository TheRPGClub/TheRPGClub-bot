import test from "node:test";
import assert from "node:assert/strict";
import type { APIMessageTopLevelComponent } from "discord.js";
import { mapVotingRoundApiData, type VotingRoundApiData } from "../classes/VotingRounds.js";
import {
  buildResolvedTieContainer,
  buildTieBreakSelectId,
  buildTiePendingText,
  buildTiePromptComponents,
  parseTieBreakSelectId,
  replaceTieCategoryContainer,
} from "../functions/VotingTiePrompt.js";

type TieGame = { game_id: number; title: string; cover_url: string | null };

function tieRound(
  pendingTies: VotingRoundApiData["pending_ties"],
  runoffTies: VotingRoundApiData["runoff_ties"] = {},
) {
  return mapVotingRoundApiData({
    round_number: 143,
    month_year: "October 2026",
    voting_opens_at: "2026-09-25T16:00:00.000Z",
    voting_closes_at: "2026-09-28T03:59:59.999Z",
    closed_at: "2026-09-28T04:00:00.000Z",
    decided_at: null,
    phase: "tie",
    nominations_open: false,
    voting_open: false,
    voting_ended: true,
    pending_ties: pendingTies,
    runoff_ties: runoffTies,
  });
}

function games(count: number, withCovers: boolean): TieGame[] {
  return Array.from({ length: count }, (_, i) => ({
    game_id: i + 1,
    title: `Game ${i + 1}`,
    cover_url: withCovers ? `https://images.example/${i + 1}.jpg` : null,
  }));
}

function countComponents(node: unknown): number {
  if (!node || typeof node !== "object") return 0;
  const { components, accessory } = node as { components?: unknown[]; accessory?: unknown };
  const children = (components ?? []).reduce<number>((sum, c) => sum + countComponents(c), 0);
  return 1 + children + (accessory ? countComponents(accessory) : 0);
}

function selectsIn(node: unknown): Array<{ custom_id: string; max_values?: number }> {
  if (!node || typeof node !== "object") return [];
  const own = node as { type?: number; custom_id?: string; max_values?: number };
  const found = own.type === 3 && own.custom_id ? [{ ...own, custom_id: own.custom_id }] : [];
  const children = (node as { components?: unknown[] }).components ?? [];
  return [...found, ...children.flatMap((child) => selectsIn(child))];
}

test("tie-break select ids carry round and category and survive a round trip", () => {
  const id = buildTieBreakSelectId(143, "nr_gotm");

  assert.equal(id, "admin-vote-tie:143:nr_gotm");
  assert.deepEqual(parseTieBreakSelectId(id), { roundNumber: 143, category: "nr_gotm" });
});

test("parseTieBreakSelectId rejects ids that are not a tie-break select", () => {
  assert.equal(parseTieBreakSelectId("admin-vote-tie:0:gotm"), null);
  assert.equal(parseTieBreakSelectId("admin-vote-tie:143:retro"), null);
  assert.equal(parseTieBreakSelectId("admin-vote-tie:143:gotm:extra"), null);
  assert.equal(parseTieBreakSelectId("vote-cast:gotm:143:1"), null);
});

test("buildTiePendingText names the round", () => {
  const text = buildTiePendingText(tieRound({ gotm: games(2, false) }));

  assert.match(text, /^## Round 143 voting ended in a tie/);
});

test("buildTiePendingText says when the runoff did not break the tie", () => {
  const text = buildTiePendingText(tieRound({ gotm: games(2, false) }, { gotm: games(3, false) }));

  assert.match(text, /^## Round 143 runoff did not break the tie/);
  assert.match(text, /tied again or got no votes/);
});

test("the prompt has one select per tied category allowing every tied game", () => {
  const round = tieRound({ gotm: games(2, true), nr_gotm: games(3, false) });

  const json = buildTiePromptComponents(round).map((c) => c.toJSON());
  const selects = json.flatMap((c) => selectsIn(c));

  assert.equal(json.length, 3);
  assert.deepEqual(
    selects.map((s) => [s.custom_id, s.max_values]),
    [["admin-vote-tie:143:gotm", 2], ["admin-vote-tie:143:nr_gotm", 3]],
  );
});

test("the prompt drops covers rather than exceed Discord's component limit", () => {
  const round = tieRound({ gotm: games(8, true), nr_gotm: games(8, true) });

  const json = buildTiePromptComponents(round).map((c) => c.toJSON());
  const total = json.reduce((sum, c) => sum + countComponents(c), 0);

  assert.ok(total <= 40, `expected at most 40 components, got ${total}`);
  assert.equal(json.flatMap((c) => selectsIn(c)).length, 2);
  assert.doesNotMatch(JSON.stringify(json), /images\.example/);
});

test("a small tie keeps its covers", () => {
  const json = buildTiePromptComponents(tieRound({ gotm: games(2, true) })).map((c) => c.toJSON());

  assert.match(JSON.stringify(json), /images\.example\/1\.jpg/);
});

test("resolving one category replaces only that category's container", () => {
  const round = tieRound({ gotm: games(2, false), nr_gotm: games(2, false) });
  const json = buildTiePromptComponents(round).map(
    (c) => c.toJSON() as APIMessageTopLevelComponent,
  );

  const updated = replaceTieCategoryContainer(
    json,
    "admin-vote-tie:143:gotm",
    buildResolvedTieContainer("gotm", ["Game 1", "Game 2"], "123"),
  );
  const text = JSON.stringify(updated);

  assert.deepEqual(
    updated.flatMap((c) => selectsIn(c)).map((s) => s.custom_id),
    ["admin-vote-tie:143:nr_gotm"],
  );
  assert.match(text, /GOTM tie broken/);
  assert.match(text, /\*\*Game 1\*\*, \*\*Game 2\*\* picked as the GOTM joint winners by <@123>/);
  assert.deepEqual(updated[0], json[0]);
});
