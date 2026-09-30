import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBacklogPickContent,
  buildBacklogPickRerollId,
  buildBacklogPickStartId,
  findBacklogPick,
  parseBacklogPickRerollId,
  parseBacklogPickStartId,
  parseHltbHours,
  shuffleBacklogPickCandidates,
  type IBacklogPickCandidate,
  type IBacklogPickState,
} from "../commands/backlog/backlog-pick.service.js";

const OWNER = "123456789012345678";

function candidate(kind: "b" | "c", entryId: number): IBacklogPickCandidate {
  return {
    kind,
    entryId,
    gameId: entryId * 10,
    title: `Game ${entryId}`,
    platformId: null,
    platformName: null,
  };
}

test("reroll id round-trips every field and fits Discord's limit", () => {
  const state: IBacklogPickState = {
    ownerId: OWNER,
    source: "both",
    platformId: 48,
    maxHours: 25,
    seed: 0xfffffffe,
    position: 1234,
  };
  const id = buildBacklogPickRerollId(state);
  assert.ok(id.length <= 100);
  assert.deepEqual(parseBacklogPickRerollId(id), state);
});

test("reroll id parser rejects malformed ids", () => {
  assert.equal(parseBacklogPickRerollId(`backlog-pick-reroll-v1:${OWNER}:x:0:0:abc:0`), null);
  assert.equal(parseBacklogPickRerollId(`backlog-pick-reroll-v1:${OWNER}:b:0:0:abc`), null);
});

test("start id round-trips and rejects a zero entry id", () => {
  const id = buildBacklogPickStartId(OWNER, "c", 77);
  assert.deepEqual(parseBacklogPickStartId(id), { ownerId: OWNER, kind: "c", entryId: 77 });
  assert.equal(parseBacklogPickStartId(`backlog-pick-start-v1:${OWNER}:b:0`), null);
});

test("parseHltbHours reads hours, halves, and minutes", () => {
  assert.equal(parseHltbHours("12 Hours"), 12);
  assert.equal(parseHltbHours("12½ Hours"), 12.5);
  assert.equal(parseHltbHours("30 Mins"), 0.5);
  assert.equal(parseHltbHours("--"), null);
  assert.equal(parseHltbHours(null), null);
});

test("shuffle is stable for a seed regardless of input order", () => {
  const entries = [candidate("b", 3), candidate("c", 1), candidate("b", 1), candidate("b", 2)];
  const first = shuffleBacklogPickCandidates(entries, 42);
  const second = shuffleBacklogPickCandidates([...entries].reverse(), 42);
  assert.deepEqual(first, second);
  assert.equal(first.length, entries.length);
});

test("findBacklogPick skips rejected candidates and wraps around", async () => {
  const order = [1, 2, 3, 4, 5, 6, 7].map((id) => candidate("b", id));
  const found = await findBacklogPick(order, 5, async (c) => (c.entryId === 2 ? true : null));
  assert.equal(found?.candidate.entryId, 2);
  assert.equal(found?.position, 8);
  assert.equal(await findBacklogPick(order, 0, async () => null), null);
});

test("pick content shows HLTB times and the wrap notice", () => {
  const content = buildBacklogPickContent({
    candidate: candidate("b", 1),
    position: 0,
    hltb: {
      gameId: 10, name: null, url: null, imageUrl: null, main: "12 Hours",
      mainSides: null, completionist: "40 Hours", singlePlayer: null, coOp: null, vs: null,
      sourceQuery: null, scrapedAt: null, updatedAt: null,
    },
    coverUrl: null,
    wrapped: true,
  }, "source: backlog");
  assert.match(content, /Main: 12 Hours/);
  assert.match(content, /Completionist: 40 Hours/);
  assert.match(content, /From your backlog/);
  assert.match(content, /picks may repeat/);
});
