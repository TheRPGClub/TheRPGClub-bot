import assert from "node:assert/strict";
import test from "node:test";
import { ButtonStyle } from "discord.js";
import type {
  GotyAwardKey,
  IGotyAward,
  IGotyGame,
  IGotyVote,
  IGotyVoteApi,
  IGotyVoteCastResult,
  IGotyVoteSummary,
} from "../services/GotyVoteApi.js";
import {
  buildGotyAwardPanel,
  buildGotyVotePickId,
  buildGotyVoteSelectId,
  gotyVoteCast,
  gotyVoteCommandReply,
  parseGotyVoteId,
  pickCurrentGotyVote,
} from "../services/GotyVotePanels.js";
import { apiError, buttonsOf, selectsOf, textOf } from "./challengeFixtures.js";
import { UNUSED_GOTY_API } from "./gotyFixtures.js";

// /goty vote panels (bot#1581), against a fake API client.

const MEMBER = "222";

function game(id: number, title = `Game ${id}`): IGotyGame {
  return { game_id: id, title };
}

function award(key: GotyAwardKey, overrides: Partial<IGotyAward> = {}): IGotyAward {
  return {
    award: key,
    name: key,
    ballot: [game(1, "Chrono Trigger"), game(2, "Xenogears"), game(3, "Suikoden II")],
    cap: 1,
    runoff_ballot: [],
    pending_tie: [],
    own_votes: [],
    own_runoff_votes: [],
    winner: null,
    ...overrides,
  };
}

function summary(overrides: Partial<IGotyVoteSummary> = {}): IGotyVoteSummary {
  return {
    year: 2026,
    name: "GOTY Vote 2026",
    nominations_open_at: "2027-01-01T05:00:00.000Z",
    voting_opens_at: "2027-01-15T17:00:00.000Z",
    voting_closes_at: "2027-01-18T04:59:59.000Z",
    phase: "voting",
    nominations_open: false,
    voting_open: true,
    runoff_open: false,
    ...overrides,
  };
}

function goty(overrides: Partial<IGotyVote> = {}, awards?: IGotyAward[]): IGotyVote {
  return {
    ...summary(),
    candidates_frozen_at: "2027-01-15T17:00:00.000Z",
    awards: awards ?? [award("gotm"), award("nr_gotm"), award("game_of_the_year")],
    ...overrides,
  };
}

interface IFakeApi extends IGotyVoteApi {
  calls: string[];
}

function fakeApi(options: {
  votes?: IGotyVoteSummary[];
  /** Successive reads; the last one repeats. */
  reads: (IGotyVote | null)[];
  cast?: IGotyVoteCastResult | Error;
}): IFakeApi {
  const calls: string[] = [];
  let read = 0;
  return {
    ...UNUSED_GOTY_API,
    calls,
    async listVotes() {
      calls.push("list");
      return options.votes ?? [summary()];
    },
    async getVote(year, userId) {
      calls.push(`get ${year} ${userId}`);
      const vote = options.reads[Math.min(read, options.reads.length - 1)];
      read += 1;
      return vote;
    },
    async castVote(year, userId, key, gameId) {
      calls.push(`cast ${year} ${userId} ${key} ${gameId}`);
      if (options.cast instanceof Error) throw options.cast;
      if (!options.cast) throw new Error("no cast expected");
      return options.cast;
    },
  };
}

function castResult(overrides: Partial<IGotyVoteCastResult> = {}): IGotyVoteCastResult {
  return {
    action: "voted",
    vote: {
      id: 9,
      year: 2026,
      award: "gotm",
      user_id: MEMBER,
      gamedb_game_id: 2,
      runoff: false,
      voted_at: "2027-01-16T00:00:00.000Z",
      game: game(2, "Xenogears"),
    },
    removed_votes: [],
    cap: 1,
    runoff: false,
    warning: null,
    ...overrides,
  };
}

test("custom ids: a pick and a select round-trip, and a stray id is refused", () => {
  const target = { year: 2026, award: "game_of_the_year" as const, ballot: "runoff" as const };
  assert.deepEqual(parseGotyVoteId(buildGotyVotePickId(target, 42)), { target, gameId: 42 });
  assert.deepEqual(parseGotyVoteId(buildGotyVoteSelectId(target, 0)), { target, gameId: null });
  assert.equal(parseGotyVoteId("goty-vote-pick-v1:2026:best_game:m:4"), null);
  assert.equal(parseGotyVoteId("vote-pick:gotm:12:4"), null);
});

test("pickCurrentGotyVote: the open one, else the newest under way, else the newest", () => {
  const decided = summary({ year: 2025, phase: "decided", voting_open: false });
  const upcoming = summary({ year: 2027, phase: "upcoming", voting_open: false });
  const voting = summary({ year: 2026 });
  assert.equal(pickCurrentGotyVote([upcoming, voting, decided])?.year, 2026);
  assert.equal(pickCurrentGotyVote([upcoming, decided])?.year, 2027);
  assert.equal(pickCurrentGotyVote([decided])?.year, 2025);
  assert.equal(pickCurrentGotyVote([]), null);
});

test("the main panel names the GOTY Vote and year, shows the cap and a button per game", () => {
  const vote = goty({}, [award("gotm", { own_votes: [2] })]);
  const view = buildGotyAwardPanel(vote, "gotm");
  const text = textOf(view.components);
  assert.match(text, /## GOTY Vote 2026: GOTM of the Year/);
  assert.match(text, /not this month's GOTM round/);
  assert.match(text, /Vote for up to \*\*1\*\* game/);
  assert.match(text, /You have used \*\*1\*\* of your \*\*1\*\* vote/);
  assert.match(text, /- ✅ \*\*Xenogears\*\*/);
  const buttons = buttonsOf(view.components);
  assert.deepEqual(buttons.map((b) => b.label), ["Chrono Trigger", "Xenogears", "Suikoden II"]);
  assert.equal(buttons[1].customId, "goty-vote-pick-v1:2026:gotm:m:2");
  assert.equal(buttons[1].style, ButtonStyle.Success);
  assert.equal(buttons[0].style, ButtonStyle.Secondary);
});

test("a large ballot falls back to selects that mark the member's votes", () => {
  const ballot = Array.from({ length: 30 }, (_, i) => game(i + 1));
  const vote = goty({}, [award("game_of_the_year", { ballot, cap: 15, own_votes: [5] })]);
  const view = buildGotyAwardPanel(vote, "game_of_the_year");
  assert.equal(buttonsOf(view.components).length, 0);
  const selects = selectsOf(view.components);
  assert.equal(selects.length, 2);
  assert.equal(selects[0].customId, "goty-vote-sel-v1:2026:game_of_the_year:m:0");
  assert.equal(selects[0].options[4].description, "Your vote");
  assert.match(textOf(view.components), /Pick a game you already voted for/);
});

test("the runoff panel shows only the tied games, with the runoff vote", () => {
  const vote = goty(
    { phase: "runoff", voting_open: false, runoff_open: true,
      runoff_closes_at: "2027-01-20T04:59:59.000Z" },
    [award("gotm", {
      runoff_ballot: [1, 3], pending_tie: [1, 3], own_runoff_votes: [3], own_votes: [2],
    })],
  );
  const view = buildGotyAwardPanel(vote, "gotm");
  const text = textOf(view.components);
  assert.match(text, /GOTM of the Year Runoff/);
  assert.match(text, /ended in a tie/);
  assert.doesNotMatch(text, /Xenogears/);
  const buttons = buttonsOf(view.components);
  assert.deepEqual(buttons.map((b) => b.label), ["Chrono Trigger", "Suikoden II"]);
  assert.equal(buttons[0].customId, "goty-vote-pick-v1:2026:gotm:r:1");
  assert.equal(buttons[1].style, ButtonStyle.Success);
});

test("an uncontested Award shows its game as decided, with no buttons", () => {
  const vote = goty({}, [award("nr_gotm", { ballot: [game(7, "Vagrant Story")] })]);
  const view = buildGotyAwardPanel(vote, "nr_gotm");
  assert.equal(buttonsOf(view.components).length, 0);
  assert.match(textOf(view.components), /\*\*Vagrant Story\*\* is the only candidate.*uncontested/);
});

test("an Award with no candidates is not given; a decided one names its winner", () => {
  const empty = buildGotyAwardPanel(goty({}, [award("gotm", { ballot: [] })]), "gotm");
  assert.match(textOf(empty.components), /GOTM of the Year 2026 is not given/);
  const decided = goty({ phase: "decided", voting_open: false }, [
    award("gotm", { winner: { gamedb_game_id: 2, decided_by: "runoff", game: game(2, "Xeno") } }),
  ]);
  const view = buildGotyAwardPanel(decided, "gotm");
  assert.match(textOf(view.components), /\*\*Xeno\*\* won GOTM of the Year 2026 in the runoff/);
  assert.equal(buttonsOf(view.components).length, 0);
});

test("during a runoff an Award that did not tie has no ballot", () => {
  const vote = goty({ phase: "runoff", voting_open: false, runoff_open: true });
  const view = buildGotyAwardPanel(vote, "nr_gotm");
  assert.match(textOf(view.components), /did not tie/);
  assert.equal(buttonsOf(view.components).length, 0);
});

test("/goty vote: a panel per Award while voting, read for the member", async () => {
  const api = fakeApi({ reads: [goty()] });
  const reply = await gotyVoteCommandReply(api, MEMBER, null);
  assert.ok("views" in reply);
  assert.equal(reply.views.length, 3);
  assert.deepEqual(api.calls, ["list", `get 2026 ${MEMBER}`]);
  assert.match(textOf(reply.views[2].components), /Game of the Year/);
});

test("/goty vote: in a runoff only the tied Awards; one Award when asked", async () => {
  const vote = goty({ phase: "runoff", voting_open: false, runoff_open: true }, [
    award("gotm"), award("nr_gotm", { runoff_ballot: [1, 2], pending_tie: [1, 2] }),
    award("game_of_the_year"),
  ]);
  const runoff = await gotyVoteCommandReply(fakeApi({ reads: [vote] }), MEMBER, null);
  assert.ok("views" in runoff);
  assert.equal(runoff.views.length, 1);
  assert.match(textOf(runoff.views[0].components), /NR-GOTM of the Year Runoff/);
  const one = await gotyVoteCommandReply(fakeApi({ reads: [goty()] }), MEMBER, "gotm");
  assert.ok("views" in one);
  assert.equal(one.views.length, 1);
});

test("/goty vote: before voting, one message with each Award's standing", async () => {
  const vote = goty({ phase: "nominating", voting_open: false, nominations_open: true,
    candidates_frozen_at: null });
  const reply = await gotyVoteCommandReply(fakeApi({ reads: [vote] }), MEMBER, null);
  assert.ok("views" in reply);
  assert.equal(reply.views.length, 1);
  const text = textOf(reply.views[0].components);
  assert.match(text, /## GOTY Vote 2026/);
  assert.match(text, /Voting for Game of the Year opens <t:\d+:F>/);
  assert.equal(buttonsOf(reply.views[0].components).length, 0);
});

test("/goty vote: no GOTY Vote yet", async () => {
  const reply = await gotyVoteCommandReply(fakeApi({ votes: [], reads: [null] }), MEMBER, null);
  assert.deepEqual(reply, { text: "There is no GOTY Vote yet." });
});

test("a press casts for the member and redraws the panel with the vote", async () => {
  const after = goty({}, [award("gotm", { own_votes: [2] })]);
  const api = fakeApi({ reads: [after], cast: castResult() });
  const target = { year: 2026, award: "gotm" as const, ballot: "main" as const };
  const outcome = await gotyVoteCast(api, target, 2, MEMBER);
  assert.equal(outcome.error, null);
  assert.deepEqual(api.calls, [
    `get 2026 ${MEMBER}`, `cast 2026 ${MEMBER} gotm 2`, `get 2026 ${MEMBER}`,
  ]);
  const text = textOf(outcome.panel?.components);
  assert.match(text, /✅ Voted for \*\*Xenogears\*\*/);
  assert.equal(buttonsOf(outcome.panel?.components)[1].style, ButtonStyle.Success);
});

test("a toggle takes the vote back", async () => {
  const api = fakeApi({
    reads: [goty()],
    cast: castResult({ action: "unvoted", vote: null, removed_votes: [castResult().vote!] }),
  });
  const target = { year: 2026, award: "gotm" as const, ballot: "main" as const };
  const outcome = await gotyVoteCast(api, target, 2, MEMBER);
  assert.match(textOf(outcome.panel?.components), /Took back your vote for \*\*Xenogears\*\*/);
  assert.equal(buttonsOf(outcome.panel?.components)[1].style, ButtonStyle.Secondary);
});

test("a vote dropped at the cap is noticed on the panel", async () => {
  const dropped = { ...castResult().vote!, id: 3, gamedb_game_id: 1, game: game(1, "Chrono") };
  const warning = "You were at the vote cap (1), so your oldest vote (Chrono) was removed.";
  const api = fakeApi({
    reads: [goty({}, [award("gotm", { own_votes: [2] })])],
    cast: castResult({ removed_votes: [dropped], warning }),
  });
  const target = { year: 2026, award: "gotm" as const, ballot: "main" as const };
  const text = textOf((await gotyVoteCast(api, target, 2, MEMBER)).panel?.components);
  assert.match(text, /Voted for \*\*Xenogears\*\*/);
  assert.match(text, /⚠️ You were at the vote cap \(1\)/);

  const silent = fakeApi({
    reads: [goty({}, [award("gotm", { own_votes: [2] })])],
    cast: castResult({ removed_votes: [dropped] }),
  });
  const fallback = textOf((await gotyVoteCast(silent, target, 2, MEMBER)).panel?.components);
  assert.match(fallback, /your vote for \*\*Chrono\*\* was dropped/);
});

test("a refused press reports the API's message and request, and redraws the panel", async () => {
  const refusal = apiError(
    422,
    { error: "voting_closed", message: "Voting for GOTY Vote 2026 is closed." },
    { method: "post", url: "/api/v1/goty_votes/2026/votes",
      data: { data: { award: "gotm", gamedb_game_id: 2, user_id: MEMBER } } },
  );
  const closed = goty({ phase: "closed", voting_open: false });
  const api = fakeApi({ reads: [closed], cast: refusal });
  const target = { year: 2026, award: "gotm" as const, ballot: "main" as const };
  const outcome = await gotyVoteCast(api, target, 2, MEMBER);
  assert.match(outcome.error ?? "", /Voting for GOTY Vote 2026 is closed\./);
  assert.match(outcome.error ?? "", /goty_votes\/2026\/votes/);
  assert.match(outcome.error ?? "", /422/);
  assert.equal(buttonsOf(outcome.panel?.components).length, 0);
  assert.match(textOf(outcome.panel?.components), /has closed/);
});

test("an Award an admin settled early in the runoff has no runoff ballot", async () => {
  const settled = award("gotm", {
    runoff_ballot: [1, 3],
    pending_tie: [],
    winner: { gamedb_game_id: 3, decided_by: "admin", game: game(3, "Suikoden II") },
  });
  const vote = goty({ phase: "runoff", voting_open: false, runoff_open: true }, [
    settled, award("nr_gotm", { runoff_ballot: [1, 2], pending_tie: [1, 2] }),
    award("game_of_the_year"),
  ]);
  const panel = buildGotyAwardPanel(vote, "gotm");
  assert.equal(buttonsOf(panel.components).length, 0);
  assert.match(textOf(panel.components), /\*\*Suikoden II\*\* won GOTM of the Year 2026/);
  const reply = await gotyVoteCommandReply(fakeApi({ reads: [vote] }), MEMBER, null);
  assert.ok("views" in reply);
  assert.equal(reply.views.length, 1);
  assert.match(textOf(reply.views[0].components), /NR-GOTM of the Year Runoff/);
});

test("a main vote press from a stale panel during the runoff casts nothing", async () => {
  const vote = goty({ phase: "runoff", voting_open: false, runoff_open: true }, [
    award("gotm", { runoff_ballot: [1, 2], pending_tie: [1, 2] }),
  ]);
  const api = fakeApi({ reads: [vote], cast: castResult() });
  const target = { year: 2026, award: "gotm" as const, ballot: "main" as const };
  const outcome = await gotyVoteCast(api, target, 2, MEMBER);
  assert.equal(outcome.error, null);
  assert.deepEqual(api.calls, [`get 2026 ${MEMBER}`]);
  const text = textOf(outcome.panel?.components);
  assert.match(text, /That button was from the GOTM of the Year main vote.*nothing was cast/);
  assert.match(text, /GOTM of the Year Runoff/);
  assert.equal(buttonsOf(outcome.panel?.components)[0].customId,
    "goty-vote-pick-v1:2026:gotm:r:1");
});
