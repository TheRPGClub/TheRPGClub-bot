import assert from "node:assert/strict";
import test from "node:test";
import { AxiosError, AxiosHeaders } from "axios";
import { UNUSED_GOTY_API } from "./gotyFixtures.js";
import {
  buildGotyDatesBody,
  createGotyAdminApi,
  mapGotyVoteAdminView,
  type GotyAwardKey,
  type IGotyAdminApi,
  type IGotyDateChanges,
  type IGotyAdminNomination,
  type IGotyVoteAdminView,
  type IGotyVoteForAdmin,
} from "../services/GotyVoteApi.js";
import {
  buildGotyNominationChangeComponents,
  buildGotyNominationListText,
  buildGotyTiePrompt,
  buildGotyTieSelectId,
  filterGotyNominationChoices,
  GOTY_NOM_DEL_MODAL_ID_PATTERN,
  GOTY_TIE_SELECT_ID_PATTERN,
  buildGotyNomDeleteModalId,
  parseGotyDateInput,
  parseGotyNomDeleteModalId,
  parseGotyNominationChoiceValue,
  parseGotyTieSelectId,
} from "../functions/GotyAdminHelpers.js";
import {
  findGotyNomination,
  handleGotyDeleteNomination,
  loadGotyTiePrompt,
  moveGotyDates,
  removeGotyNomination,
  settleGotyTie,
} from "../commands/admin/goty-admin.service.js";

// GOTY Vote admin in /admin (bot#1583): move dates, settle a tie, remove a nomination.
// The actions run against a mocked IGotyAdminApi.

function view(overrides: Partial<IGotyVoteAdminView> = {}): IGotyVoteAdminView {
  return {
    year: 2026,
    name: "GOTY Vote 2026",
    phase: "nominating",
    nominationsOpenAt: new Date("2027-01-01T05:00:00Z"),
    votingOpensAt: new Date("2027-01-15T17:00:00Z"),
    votingClosesAt: new Date("2027-01-18T04:59:59Z"),
    decidedAt: null,
    ties: [],
    winners: [],
    ...overrides,
  };
}

const NOMINATIONS: IGotyAdminNomination[] = [
  { id: 11, year: 2026, userId: "u1", gameId: 100, gameTitle: "Clair Obscur", userName: "Ada" },
  { id: 12, year: 2026, userId: "u2", gameId: 100, gameTitle: "Clair Obscur", userName: "Bo" },
  { id: 13, year: 2026, userId: "u2", gameId: 200, gameTitle: "Hades II", userName: "Bo" },
];

function apiError(status: number, data: unknown): AxiosError {
  const request = { method: "patch", url: "/api/v1/goty_votes/2026", data: "{}" };
  const response: any = {
    status,
    data,
    headers: {},
    statusText: "Unprocessable Content",
    config: { headers: new AxiosHeaders() },
  };
  return new AxiosError("Request failed", "ERR_BAD_REQUEST", request as any, null, response);
}

type Call = [string, ...unknown[]];

function fakeApi(options: {
  votes?: { year: number; phase: string }[];
  vote?: IGotyVoteAdminView | null;
  moveError?: unknown;
  tieError?: unknown;
  deleteResult?: boolean;
  deleteError?: unknown;
  nominations?: IGotyAdminNomination[];
} = {}): IGotyAdminApi & { calls: Call[] } {
  const calls: Call[] = [];
  let nominations = options.nominations ?? NOMINATIONS;
  return {
    calls,
    listVotes: async () => {
      calls.push(["listVotes"]);
      return (options.votes ?? [{ year: 2026, phase: "nominating" }])
        .map((entry) => ({ ...view(), ...entry, name: `GOTY Vote ${entry.year}` }));
    },
    getVote: async (year) => {
      calls.push(["getVote", year]);
      return options.vote === undefined ? view({ year }) : options.vote;
    },
    moveDates: async (year, changes: IGotyDateChanges) => {
      calls.push(["moveDates", year, changes]);
      if (options.moveError) throw options.moveError;
      return view({ year, name: `GOTY Vote ${year}`, ...changes });
    },
    resolveTie: async (year, award: GotyAwardKey, gameId) => {
      calls.push(["resolveTie", year, award, gameId]);
      if (options.tieError) throw options.tieError;
      return view({
        year,
        phase: "decided",
        decidedAt: new Date(),
        winners: [{
          award,
          name: "Game of the Year",
          game: { id: gameId, title: "Hades II" },
          decidedBy: "admin",
        }],
      });
    },
    listNominations: async (year) => {
      calls.push(["listNominations", year]);
      return nominations;
    },
    deleteNomination: async (year, id) => {
      calls.push(["deleteNomination", year, id]);
      if (options.deleteError) throw options.deleteError;
      nominations = nominations.filter((entry) => entry.id !== id);
      return options.deleteResult ?? true;
    },
  };
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

test("a date alone takes the default schedule's time for each date (US Eastern)", () => {
  assert.equal(
    parseGotyDateInput("2027-01-01", "nominationsOpenAt")?.toISOString(),
    "2027-01-01T05:00:00.000Z",
  );
  assert.equal(
    parseGotyDateInput("2027-01-15", "votingOpensAt")?.toISOString(),
    "2027-01-15T17:00:00.000Z",
  );
  assert.equal(
    parseGotyDateInput("1/17/2027", "votingClosesAt")?.toISOString(),
    "2027-01-18T04:59:59.999Z",
  );
});

test("a date with a time is taken as given", () => {
  assert.equal(
    parseGotyDateInput("2027-01-15 18:30", "votingOpensAt")?.toISOString(),
    "2027-01-15T23:30:00.000Z",
  );
  assert.equal(
    parseGotyDateInput("2027-01-15 9:00 PM", "votingClosesAt")?.toISOString(),
    "2027-01-16T02:00:00.000Z",
  );
  assert.equal(parseGotyDateInput("next friday", "votingOpensAt"), null);
});

test("the PATCH body carries only the dates being moved", () => {
  assert.deepEqual(
    buildGotyDatesBody({ votingOpensAt: new Date("2027-01-22T17:00:00Z") }),
    { voting_opens_at: "2027-01-22T17:00:00.000Z" },
  );
});

test("moving dates PATCHes the current GOTY Vote and asks the poll to re-read", async () => {
  const api = fakeApi({
    votes: [{ year: 2027, phase: "upcoming" }, { year: 2026, phase: "decided" }],
  });
  const outcome = await moveGotyDates(api, undefined, { votingOpensAt: "2028-01-21" });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.poll, true);
  assert.deepEqual(api.calls.at(-1), [
    "moveDates", 2027, { votingOpensAt: new Date("2028-01-21T17:00:00.000Z") },
  ]);
  assert.match(outcome.text, /GOTY Vote 2027 dates moved\.\nNominations open: <t:\d+:F>/);
});

test("without an undecided GOTY Vote the newest year is used", async () => {
  const api = fakeApi({ votes: [{ year: 2026, phase: "decided" }] });
  await moveGotyDates(api, undefined, { votingClosesAt: "2027-01-17" });
  assert.equal(api.calls.at(-1)?.[1], 2026);
});

test("an unreadable date is refused before any API call", async () => {
  const api = fakeApi();
  const outcome = await moveGotyDates(api, 2026, { votingOpensAt: "soon" });
  assert.equal(outcome.ok, false);
  assert.match(outcome.text, /Could not read voting-open "soon"/);
  assert.deepEqual(api.calls, []);
});

test("no dates shows the schedule and moves nothing", async () => {
  const api = fakeApi();
  const outcome = await moveGotyDates(api, 2026, {});
  assert.equal(outcome.ok, true);
  assert.equal(outcome.poll, undefined);
  assert.match(outcome.text, /nothing moved\. GOTY Vote 2026 \(nominating\):/);
  assert.equal(api.calls.some(([name]) => name === "moveDates"), false);
});

test("an API refusal shows its message with the full request and response", async () => {
  const api = fakeApi({
    moveError: apiError(422, {
      error: "voting_opened",
      message: "voting for GOTY Vote 2026 has opened, so voting_opens_at can't move",
    }),
  });
  const outcome = await moveGotyDates(api, 2026, { votingOpensAt: "2027-01-22" });
  assert.equal(outcome.ok, false);
  assert.match(outcome.text, /^voting for GOTY Vote 2026 has opened/);
  assert.match(outcome.text, /"status": 422/);
  assert.match(outcome.text, /\/api\/v1\/goty_votes\/2026/);
});

test("no GOTY Vote at all says so", async () => {
  const outcome = await moveGotyDates(fakeApi({ votes: [] }), undefined, {
    votingOpensAt: "2027-01-22",
  });
  assert.equal(outcome.ok, false);
  assert.match(outcome.text, /No GOTY Vote exists yet/);
});

// ---------------------------------------------------------------------------
// Ties
// ---------------------------------------------------------------------------

const AWARD_PAYLOAD: IGotyVoteForAdmin = {
  year: 2026,
  name: "GOTY Vote 2026",
  phase: "tie",
  nominations_open_at: "2027-01-01T05:00:00Z",
  voting_opens_at: "2027-01-15T17:00:00Z",
  voting_closes_at: "2027-01-18T04:59:59Z",
  decided_at: null,
  awards: [
    {
      award: "gotm",
      name: "GOTM of the Year",
      ballot: [{ game_id: 1, title: "Chrono Trigger" }],
      pending_tie: [],
      winner: { gamedb_game_id: 1, decided_by: "uncontested", game: null },
    },
    {
      award: "game_of_the_year",
      name: "Game of the Year",
      ballot: [{ game_id: 100, title: "Clair Obscur" }, { game_id: 200, title: "Hades II" }],
      pending_tie: [100, 200],
      winner: null,
    },
  ],
};

test("the GOTY Vote payload maps ties with ballot titles and the winners", () => {
  const mapped = mapGotyVoteAdminView(AWARD_PAYLOAD);
  assert.deepEqual(mapped.ties, [{
    award: "game_of_the_year",
    name: "Game of the Year",
    games: [{ id: 100, title: "Clair Obscur" }, { id: 200, title: "Hades II" }],
  }]);
  assert.deepEqual(mapped.winners, [{
    award: "gotm",
    name: "GOTM of the Year",
    game: { id: 1, title: "Chrono Trigger" },
    decidedBy: "uncontested",
  }]);
});

test("the tie prompt has a stable select per tied Award", () => {
  const prompt = buildGotyTiePrompt(mapGotyVoteAdminView(AWARD_PAYLOAD));
  assert.equal(prompt.length, 2);
  const json = JSON.stringify(prompt.map((container) => container.toJSON()));
  assert.match(json, /admin-goty-tie-v1:2026:game_of_the_year/);
  assert.match(json, /Hades II/);
  assert.equal(GOTY_TIE_SELECT_ID_PATTERN.test(buildGotyTieSelectId(2026, "nr_gotm")), true);
  assert.deepEqual(parseGotyTieSelectId("admin-goty-tie-v1:2026:nr_gotm"),
    { year: 2026, award: "nr_gotm" });
  assert.equal(parseGotyTieSelectId("admin-goty-tie-v1:2026:best_rpg"), null);
});

test("the tie prompt with no tie left says the vote is decided", () => {
  const prompt = buildGotyTiePrompt(view({ phase: "decided", decidedAt: new Date() }));
  assert.equal(prompt.length, 1);
  assert.match(JSON.stringify(prompt[0]?.toJSON()), /is decided/);
});

test("loading the tie prompt reads the named year", async () => {
  const api = fakeApi();
  const loaded = await loadGotyTiePrompt(api, 2026);
  assert.equal("vote" in loaded, true);
  assert.deepEqual(api.calls, [["getVote", 2026]]);
  const missing = await loadGotyTiePrompt(fakeApi({ vote: null }), 2030);
  assert.deepEqual(missing, { ok: false, text: "There is no GOTY Vote 2030." });
});

test("a tie pick records the winner and asks the poll to post the result", async () => {
  const api = fakeApi();
  const settled = await settleGotyTie(api, "admin-goty-tie-v1:2026:game_of_the_year", 200, "a1");
  assert.deepEqual(api.calls, [["resolveTie", 2026, "game_of_the_year", 200]]);
  assert.equal("vote" in settled && settled.poll, true);
  assert.equal("lead" in settled && settled.lead,
    "<@a1> picked Hades II as Game of the Year 2026.");
});

test("a stale tie pick shows the API's refusal", async () => {
  const api = fakeApi({
    tieError: apiError(422, { error: "no_tie", message: "GOTY Vote 2026 has no pending tie" }),
  });
  const settled = await settleGotyTie(api, "admin-goty-tie-v1:2026:gotm", 1, "a1");
  assert.equal("ok" in settled && settled.ok, false);
  assert.match("text" in settled ? settled.text : "", /^GOTY Vote 2026 has no pending tie/);
});

test("a malformed tie select is refused without an API call", async () => {
  const api = fakeApi();
  const settled = await settleGotyTie(api, "admin-goty-tie-v1:20:gotm", 1, "a1");
  assert.equal("ok" in settled && settled.ok, false);
  assert.deepEqual(api.calls, []);
});

// ---------------------------------------------------------------------------
// Nominations
// ---------------------------------------------------------------------------

test("autocomplete choices name the game and nominator and filter by query", () => {
  assert.deepEqual(filterGotyNominationChoices(NOMINATIONS, "hades"), [
    { name: "Hades II (Bo)", value: "2026:13" },
  ]);
  assert.equal(filterGotyNominationChoices(NOMINATIONS, "").length, 3);
});

test("the removal modal id round-trips", () => {
  const id = buildGotyNomDeleteModalId(2026, 13);
  assert.equal(GOTY_NOM_DEL_MODAL_ID_PATTERN.test(id), true);
  assert.deepEqual(parseGotyNomDeleteModalId(id), { year: 2026, nominationId: 13 });
  assert.equal(parseGotyNomDeleteModalId("admin-goty-nom-del-reason-v1:2026:x"), null);
});

test("finding a nomination refuses a value not picked from the list", async () => {
  const api = fakeApi();
  assert.deepEqual(await findGotyNomination(api, 2026, "Hades"),
    { ok: false, text: "Pick a nomination from the list." });
  assert.deepEqual(await findGotyNomination(api, 2026, "99"),
    { ok: false, text: "That GOTY Vote 2026 nomination no longer exists." });
});

test("removal deletes, words the notice like GOTM's and lists what is left", async () => {
  const api = fakeApi();
  const removal = await removeGotyNomination(api, 2026, 13, "admin-1", "  Released in 2024 ");
  assert.equal(removal.ok, true);
  assert.ok(api.calls.some((call) => call[0] === "deleteNomination" && call[2] === 13));
  assert.equal(
    removal.announcement?.content,
    "<@admin-1> deleted <@u2>'s GOTY Vote 2026 Game of the Year nomination \"Hades II\". " +
      "Reason: Released in 2024",
  );
  assert.deepEqual(removal.announcement?.nominations?.map((entry) => entry.id), [11, 12]);
});

test("removal needs a reason", async () => {
  const api = fakeApi();
  const removal = await removeGotyNomination(api, 2026, 13, "admin-1", "   ");
  assert.deepEqual(removal, { ok: false, text: "A deletion reason is required." });
  assert.deepEqual(api.calls, []);
});

test("a reason over 250 characters is cut to the API's limit", async () => {
  const api = fakeApi();
  const removal = await removeGotyNomination(api, 2026, 13, "admin-1", "x".repeat(300));
  assert.equal(removal.ok, true);
  assert.match(removal.text, /Reason: x{250}$/);
});

test("removal after voting opened shows the API's refusal and posts nothing", async () => {
  const api = fakeApi({
    deleteError: apiError(422, {
      error: "nominations_closed",
      message: "Game of the Year nominations for 2026 can no longer be withdrawn: voting " +
        "has opened",
    }),
  });
  const removal = await removeGotyNomination(api, 2026, 13, "admin-1", "Late");
  assert.equal(removal.ok, false);
  assert.equal(removal.announcement, undefined);
  assert.match(removal.text, /^Game of the Year nominations for 2026 can no longer/);
});

test("a nomination already gone is not announced", async () => {
  const removal = await removeGotyNomination(
    fakeApi({ deleteResult: false }), 2026, 13, "admin-1", "Dupe",
  );
  assert.equal(removal.ok, false);
  assert.equal(removal.announcement, undefined);
});

test("the nomination list groups nominators per game", () => {
  assert.equal(
    buildGotyNominationListText(2026, NOMINATIONS),
    "## GOTY Vote 2026: Game of the Year nominations\n" +
      "1. Clair Obscur (<@u1>, <@u2>)\n2. Hades II (<@u2>)",
  );
  assert.match(buildGotyNominationListText(2026, []), /No nominations yet\./);
});

test("the admin view reads the one GOTY client; delete is the withdraw", async () => {
  const calls: unknown[][] = [];
  const api = createGotyAdminApi({
    ...UNUSED_GOTY_API,
    getVote: async (...args) => {
      calls.push(["getVote", ...args]);
      return { ...AWARD_PAYLOAD, cap: 1 } as never;
    },
    withdrawNomination: async (...args) => {
      calls.push(["withdrawNomination", ...args]);
      return false;
    },
  });
  const vote = await api.getVote(2026);
  assert.equal(vote?.ties[0]?.award, "game_of_the_year");
  assert.equal(await api.deleteNomination(2026, 11), false);
  assert.deepEqual(calls, [["getVote", 2026], ["withdrawNomination", 2026, 11]]);
});

test("a nomination choice carries its year and id, so the modal needs no API read", async () => {
  assert.deepEqual(parseGotyNominationChoiceValue("2026:13"), { year: 2026, nominationId: 13 });
  assert.equal(parseGotyNominationChoiceValue("13"), null);
  assert.equal(parseGotyNominationChoiceValue("Hades II"), null);

  const shown: string[] = [];
  const replies: unknown[] = [];
  const interaction = {
    replied: false,
    deferred: false,
    showModal: async (modal: { toJSON: () => { custom_id: string } }) => {
      shown.push(modal.toJSON().custom_id);
    },
    reply: async (payload: unknown) => {
      replies.push(payload);
    },
  } as never;
  await handleGotyDeleteNomination(interaction, "2026:13");
  assert.deepEqual(shown, ["admin-goty-nom-del-reason-v1:2026:13"]);
  await handleGotyDeleteNomination(interaction, "Hades II");
  assert.equal(shown.length, 1);
  assert.equal(replies.length, 1);
});

test("a removal whose list re-read failed posts the notice without a list", async () => {
  const api = fakeApi();
  let reads = 0;
  const flaky = {
    ...api,
    listNominations: async (year: number) => {
      reads += 1;
      if (reads > 1) throw new Error("API down");
      return api.listNominations(year);
    },
  };
  const removal = await removeGotyNomination(flaky, 2026, 13, "admin-1", "Dupe");
  assert.equal(removal.ok, true);
  assert.equal(removal.announcement?.nominations, null);
  const components = buildGotyNominationChangeComponents(2026, "notice", null);
  assert.equal(components.length, 1);
  assert.doesNotMatch(JSON.stringify(components[0].toJSON()), /No nominations yet/);
  assert.equal(buildGotyNominationChangeComponents(2026, "notice", []).length, 2);
});
