import assert from "node:assert/strict";
import test from "node:test";
import type {
  GotyAwardKey,
  IGotyAward,
  IGotyGame,
  IGotyVote,
  IGotyVoteApi,
  IGotyVoteSummary,
} from "../services/GotyVoteApi.js";
import { gotyResultsReply } from "../services/GotyResults.js";
import { apiError, textOf } from "./challengeFixtures.js";
import { UNUSED_GOTY_API } from "./gotyFixtures.js";

// /goty results (bot#1580), against a fake API client.

const MEMBER = "222";

function game(id: number, title: string): IGotyGame {
  return { game_id: id, title };
}

function summary(overrides: Partial<IGotyVoteSummary> = {}): IGotyVoteSummary {
  return {
    year: 2026,
    name: "GOTY Vote 2026",
    nominations_open_at: "2027-01-01T05:00:00.000Z",
    voting_opens_at: "2027-01-15T17:00:00.000Z",
    voting_closes_at: "2027-01-18T04:59:59.000Z",
    decided_at: "2027-01-18T05:00:00.000Z",
    phase: "decided",
    nominations_open: false,
    voting_open: false,
    runoff_open: false,
    ...overrides,
  };
}

function award(key: GotyAwardKey, overrides: Partial<IGotyAward> = {}): IGotyAward {
  return {
    award: key,
    name: key,
    ballot: [],
    cap: 1,
    runoff_ballot: [],
    pending_tie: [],
    own_votes: [],
    own_runoff_votes: [],
    winner: null,
    result: [],
    ...overrides,
  };
}

function decidedVote(year = 2026): IGotyVote {
  return {
    ...summary({ year, name: `GOTY Vote ${year}` }),
    candidates_frozen_at: "2027-01-15T17:00:00.000Z",
    awards: [
      award("gotm", {
        ballot: [game(1, "Chrono Trigger"), game(2, "Xenogears"), game(3, "Suikoden II")],
        runoff_ballot: [1, 2],
        winner: { gamedb_game_id: 2, decided_by: "runoff", game: game(2, "Xenogears") },
        result: [
          { gamedb_game_id: 1, votes: 4, runoff_votes: 2 },
          { gamedb_game_id: 2, votes: 4, runoff_votes: 5 },
          { gamedb_game_id: 3, votes: 1, runoff_votes: 0 },
        ],
      }),
      award("nr_gotm", {
        ballot: [game(9, "Ys Origin")],
        winner: { gamedb_game_id: 9, decided_by: "uncontested", game: game(9, "Ys Origin") },
        result: [{ gamedb_game_id: 9, votes: 0, runoff_votes: 0 }],
      }),
      award("game_of_the_year", { ballot: [] }),
    ],
  };
}

function fakeApi(votes: IGotyVoteSummary[], read: IGotyVote | null | Error): IGotyVoteApi & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    ...UNUSED_GOTY_API,
    calls,
    async listVotes() {
      calls.push("votes");
      return votes;
    },
    async getVote(year, userId) {
      calls.push(`get ${year} ${userId}`);
      if (read instanceof Error) throw read;
      return read;
    },
  };
}

test("results: the latest decided year by default, all three Awards", async () => {
  const api = fakeApi(
    [summary({ year: 2027, phase: "upcoming" }), summary(), summary({ year: 2025 })],
    decidedVote(),
  );
  const reply = await gotyResultsReply(api, { userId: MEMBER, year: null, isPrivate: false });
  assert.ok("view" in reply);
  assert.equal(reply.view.flags & 64, 0, "public unless asked");
  const text = textOf(reply.view.components);
  assert.match(text, /## GOTY Vote 2026: the results/);
  assert.match(text, /### GOTM of the Year 2026\n🏆 \*\*Xenogears\*\* won the runoff\./);
  assert.match(text, /- Xenogears: 4 votes, 5 votes in the runoff/);
  assert.match(text, /- Chrono Trigger: 4 votes, 2 votes in the runoff/);
  assert.match(text, /- Suikoden II: 1 vote$/m);
  assert.ok(text.indexOf("Xenogears: 4") < text.indexOf("Chrono Trigger: 4"));
  assert.match(text, /### NR-GOTM of the Year 2026\n🏆 \*\*Ys Origin\*\* won uncontested/);
  assert.doesNotMatch(text, /Ys Origin: 0 votes/);
  assert.match(text, /### Game of the Year 2026\nNot given: it had no candidates\./);
  assert.deepEqual(api.calls, ["votes", `get 2026 ${MEMBER}`]);
});

test("results: an Award with candidates but no votes is not given", async () => {
  const vote = decidedVote();
  vote.awards[2] = award("game_of_the_year", {
    ballot: [game(4, "Clair Obscur")],
    result: [{ gamedb_game_id: 4, votes: 0, runoff_votes: 0 }],
  });
  const reply = await gotyResultsReply(fakeApi([summary()], vote), {
    userId: MEMBER, year: 2026, isPrivate: true,
  });
  assert.ok("view" in reply);
  assert.notEqual(reply.view.flags & 64, 0, "private when asked");
  assert.match(textOf(reply.view.components), /Not given: nobody voted\./);
});

test("results: an admin pick after a second tie", async () => {
  const vote = decidedVote();
  vote.awards[0].winner = { gamedb_game_id: 1, decided_by: "admin", game: game(1, "Chrono") };
  const reply = await gotyResultsReply(fakeApi([summary()], vote), {
    userId: MEMBER, year: null, isPrivate: false,
  });
  assert.ok("view" in reply);
  assert.match(
    textOf(reply.view.components),
    /\*\*Chrono Trigger\*\* was picked by staff after the runoff tied again\./,
  );
});

test("results: a year not decided yet, an unknown year, and none decided", async () => {
  const running = await gotyResultsReply(
    fakeApi([summary({ phase: "voting", voting_open: true })], null),
    { userId: MEMBER, year: 2026, isPrivate: false },
  );
  assert.ok("text" in running);
  assert.match(running.text, /GOTY Vote 2026 is not decided yet/);

  const unknown = await gotyResultsReply(fakeApi([summary()], null), {
    userId: MEMBER, year: 2031, isPrivate: false,
  });
  assert.ok("text" in unknown);
  assert.equal(unknown.text, "There is no GOTY Vote for 2031.");

  const none = await gotyResultsReply(fakeApi([summary({ phase: "nominating" })], null), {
    userId: MEMBER, year: null, isPrivate: false,
  });
  assert.ok("text" in none);
  assert.equal(none.text, "No GOTY Vote has been decided yet.");
});

test("results: a failed read carries the request and response", async () => {
  const api = fakeApi([summary()], apiError(500, { error: "boom" }, {
    method: "get",
    url: "/api/v1/goty_votes/2026",
  }));
  const reply = await gotyResultsReply(api, { userId: MEMBER, year: null, isPrivate: false });
  assert.ok("error" in reply);
  assert.match(reply.error, /^Could not read GOTY Vote 2026\./);
  assert.match(reply.error, /goty_votes\/2026/);
});
