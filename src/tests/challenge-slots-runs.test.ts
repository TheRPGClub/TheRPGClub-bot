import assert from "node:assert/strict";
import test from "node:test";
import type { IChallengeRun, IStartedRun } from "../services/ChallengeApi.js";
import type { IBirthDateApi } from "../services/BirthDateService.js";
import { buildMyRunsView } from "../services/ChallengeMyRuns.js";
import {
  birthDateStartReply,
  buildBirthDateModal,
  startRunReply,
  type ChallengeRunResult,
  type IChallengeRunsApi,
} from "../services/ChallengeRuns.js";
import { apiError, buttonsOf, poolRun, slotsRun, textOf } from "./challengeFixtures.js";

// Slots Runs (bot#1550): starting a birth-year Run (the notice, and the Birth Date it may
// ask for), and the my-runs advice for a Slots Run (design 5C).

const BIRTH_REQUIRED = apiError(409, {
  error: "birth_date_required",
  message: "Years Alive starts at your birth year. Enter your Birth Date first; " +
    "the birth year shows on the Run, never the full date.",
}, {
  method: "post",
  url: "/api/v1/challenges/12/runs",
  data: { data: { acting_user_id: "333" } },
});

function startedRun(): IStartedRun {
  return {
    ...slotsRun({ first: 1994, last: 2026, open: [1994, 1995] }),
    notices: [{ code: "birth_year_shown", message: "Your birth year, 1994, shows on the Run." }],
  };
}

interface IFakeRunsApi extends IChallengeRunsApi {
  calls: string[];
}

function fakeApi(options: { startErrors?: unknown[] } = {}): IFakeRunsApi {
  const errors = [...(options.startErrors ?? [])];
  const api: IFakeRunsApi = {
    calls: [],
    startRun: async (challengeId, actingUserId) => {
      api.calls.push(`start ${challengeId} as ${actingUserId}`);
      const error = errors.shift();
      if (error) throw error;
      return startedRun();
    },
    getRun: async () => null,
    abandonRun: async () => {
      throw new Error("not used");
    },
    deleteRun: async () => false,
    listMemberRuns: async (_userId, _acting, page) => ({ items: [], page, pages: 1, count: 0 }),
  };
  return api;
}

function fakeBirthDates(error?: unknown): IBirthDateApi & { calls: string[] } {
  const api = {
    calls: [] as string[],
    getBirthDate: async () => {
      throw new Error("not used");
    },
    setBirthDate: async (userId: string, birthDate: string | null, actingUserId: string) => {
      api.calls.push(`set ${userId} to ${birthDate} as ${actingUserId}`);
      if (error) throw error;
      return { userId, birthDate, changesLeftThisMonth: 1, nextChangeOn: null };
    },
  };
  return api;
}

function shown(result: ChallengeRunResult): string {
  return "error" in result ? result.error : textOf(result.view.components);
}

test("start: a birth-year Slots Run says its range and shows the API's notice", async () => {
  const text = shown(await startRunReply(
    { challengeId: 12, actingUserId: "333" },
    { api: fakeApi() },
  ));

  assert.match(text, /^## You started a Run of Years Alive$/m);
  assert.match(text, /^One slot for each year from 1994 to 2026\.$/m);
  assert.match(text, /^Your play already counts: 31 of 33 Cleared\.$/m);
  assert.match(text, /^Your birth year, 1994, shows on the Run\.$/m);
  assert.doesNotMatch(text, /from its Pool/);
});

test("start: without a Birth Date the reply asks for it with a button", async () => {
  const result = await startRunReply(
    { challengeId: 12, actingUserId: "333" },
    { api: fakeApi({ startErrors: [BIRTH_REQUIRED] }) },
  );

  assert.ok("view" in result, "a missing Birth Date is a question, not an error");
  assert.match(shown(result), /^Years Alive starts at your birth year\./m);
  const [button] = buttonsOf(result.view.components);
  assert.equal(button?.label, "Enter your Birth Date");
  assert.equal(button?.customId, "challenge-run-v1:birth:12");
});

test("birth date modal: one date field, its custom ID naming the Challenge", () => {
  const modal = buildBirthDateModal(12).toJSON();
  assert.equal(modal.custom_id, "challenge-run-v1:birth-modal:12");
  assert.match(JSON.stringify(modal), /YYYY-MM-DD/);
});

test("birth date: saves it, then starts the Run with the notice", async () => {
  const api = fakeApi();
  const birthDates = fakeBirthDates();
  const text = shown(await birthDateStartReply(
    { challengeId: 12, birthDate: " 1994-05-04 ", actingUserId: "333" },
    { api, birthDates },
  ));

  assert.deepEqual(birthDates.calls, ["set 333 to 1994-05-04 as 333"]);
  assert.deepEqual(api.calls, ["start 12 as 333"]);
  assert.match(text, /^Saved your Birth Date, 4 May 1994\. Only you and staff see it\.$/m);
  assert.match(text, /^## You started a Run of Years Alive$/m);
});

test("birth date: a date the API won't take is shown, and no Run starts", async () => {
  const api = fakeApi();
  const birthDates = fakeBirthDates(apiError(422, { error: "Birth date is invalid." }, {
    method: "put",
    url: "/api/v1/users/333/birth_date",
    data: { data: { birth_date: "1994-13-40", acting_user_id: "333" } },
  }));
  const result = await birthDateStartReply(
    { challengeId: 12, birthDate: "1994-13-40", actingUserId: "333" },
    { api, birthDates },
  );

  assert.ok("error" in result);
  assert.match(result.error, /^That Birth Date wasn't saved: Birth date is invalid\./);
  assert.match(result.error, /birth_date/);
  assert.deepEqual(api.calls, []);
});

// my-runs: design 5C, What's next.

// The Run serves all a card needs: its Challenge's Counts past play and its entries'
// release years and covers. Nothing else is read.
function myRunsDeps(runs: IChallengeRun[]) {
  return {
    api: {
      listMemberRuns: async (_u: string, _a: string, page: number) =>
        ({ items: runs, page, pages: 1, count: runs.length }),
    },
  };
}

test("my-runs: a Slots Run names its open years and what would fill one", async () => {
  const run = slotsRun({ first: 1990, open: [1991, 2003, 2021, 2026] });
  const view = await buildMyRunsView({ actingUserId: "333", past: false }, myRunsDeps([run]));

  const text = textOf(view.components);
  assert.match(text, /^\*\*Years Alive\*\* has 4 open years: 1991, 2003, 2021, 2026\.$/m);
  assert.match(text, /^\*\*Tales of Arise\*\* is In Progress and fits 2021\.$/m);
  assert.match(
    text,
    /^-# Counts past play is on: you can pick an earlier Game Completion for an open year\.$/m,
  );
  const buttons = buttonsOf(view.components);
  assert.deepEqual(
    buttons.map((b) => [b.label, b.customId]),
    [
      ["Pick past play", "challenge-slots-v1:pick:90"],
      ["Move a game", "challenge-slots-v1:move:90"],
    ],
  );
});

test("my-runs: a Caught Up Run says when its next slot opens", async () => {
  const run = slotsRun({}, {
    challenge: {
      id: 12,
      name: "Years Alive",
      challenge_format: "slots",
      schedule: "always_open",
      counts_past_play: false,
      slots: { first_year: "birth_year", last_year: "current_year", counts_past_play: false },
    },
  });
  const view = await buildMyRunsView({ actingUserId: "333", past: false }, myRunsDeps([run]));

  const text = textOf(view.components);
  assert.match(
    text,
    /^\*\*Years Alive\*\* is Caught Up: every year to 2026 has a Cleared game\.$/m,
  );
  assert.match(text, /The 2027 slot opens on 1 January\./);
  assert.doesNotMatch(text, /Counts past play/);
  assert.deepEqual(buttonsOf(view.components).map((b) => b.label), []);
});

test("my-runs: an In Progress game whose years are filled, and one of unknown years",
  async () => {
    const run = slotsRun({ first: 2019, last: 2026, open: [2026] });
    run.entries!.push({
      game_id: 88,
      title: "Persona 5",
      state: "in_progress",
      slot_year: null,
      picked_by_hand: false,
      release_years: null,
    });
    const deps = myRunsDeps([run]);
    const text = textOf((await buildMyRunsView({ actingUserId: "333", past: false }, deps))
      .components);

    assert.match(text, /^\*\*Years Alive\*\* has 1 open year: 2026\.$/m);
    assert.match(text, /^\*\*Tales of Arise\*\* is In Progress, but its years are filled\.$/m);
    assert.match(text, /^\*\*Persona 5\*\* is In Progress\.$/m);
  });

test("my-runs: Pool cards are unchanged next to a Slots card", async () => {
  const view = await buildMyRunsView(
    { actingUserId: "333", past: false },
    myRunsDeps([poolRun(), slotsRun({ open: [2001] })]),
  );

  const text = textOf(view.components);
  assert.match(text, /^\*\*Fall of Final Fantasy\*\* needs 1 more Cleared game\.$/m);
  assert.match(text, /^\*\*Years Alive\*\* has 1 open year: 2001\.$/m);
});
