import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEditPanel,
  EDIT_FIELDS,
  runStaffAction,
  saveDetails,
  type IChallengeEditApi,
} from "../services/ChallengeEdit.js";
import type { IChallenge, IChallengeWrite } from "../services/ChallengeApi.js";
import { apiError, buttonsOf, poolChallenge, textOf } from "./challengeFixtures.js";

interface IFakeEditApi extends IChallengeEditApi {
  calls: string[];
  writes: IChallengeWrite[];
}

function fakeApi(options: { error?: unknown; challenge?: IChallenge } = {}): IFakeEditApi {
  const result = options.challenge ?? poolChallenge();
  const api: IFakeEditApi = {
    calls: [],
    writes: [],
    updateChallenge: async (id, write, actingUserId) => {
      api.calls.push(`update ${id} as ${actingUserId}`);
      api.writes.push(write);
      if (options.error) throw options.error;
      return { ...result, ...write } as IChallenge;
    },
    setHidden: async (id, hidden, actingUserId) => {
      api.calls.push(`${hidden ? "hide" : "unhide"} ${id} as ${actingUserId}`);
      if (options.error) throw options.error;
      return { ...result, hidden };
    },
    changeHost: async (id, hostUserId, actingUserId) => {
      api.calls.push(`host ${id} to ${hostUserId ?? "the club"} as ${actingUserId}`);
      if (options.error) throw options.error;
      return result;
    },
  };
  return api;
}

test("edit panel: a Challenge with Runs says plainly its rules are locked", () => {
  const view = buildEditPanel(poolChallenge({ run_count: 3 }), { canModerate: false });
  const text = textOf(view.components);

  assert.match(text, /^## Edit: Fall of Final Fantasy$/m);
  assert.ok(text.includes(
    "**The rules are locked:** this Challenge has 3 Runs, so its Format, schedule, " +
      "Season and Pool can't change.",
  ), text);
  assert.match(text, /Its name, description and end date still can\./);
  const rules = buttonsOf(view.components).find((b) => b.label === "Rules");
  assert.equal(rules?.disabled, true);
});

test("edit panel: without Runs the rules can change, and members see no staff controls", () => {
  const view = buildEditPanel(poolChallenge({ run_count: 0 }), { canModerate: false });

  assert.match(textOf(view.components), /The rules can change until someone starts a Run\./);
  assert.deepEqual(
    buttonsOf(view.components).map((b) => [b.label, b.customId, b.disabled]),
    [
      ["Name and description", "challenge-edit-v1:details:7", false],
      ["Rules", "challenge-edit-v1:rules:7", false],
    ],
  );
});

test("edit panel: staff get hide and the Host controls", () => {
  const view = buildEditPanel(poolChallenge(), { canModerate: true });
  const labels = buttonsOf(view.components).map((b) => b.label);

  assert.deepEqual(labels, ["Name and description", "Rules", "Hide", "Hand to the club"]);
  const json = JSON.stringify(view.components);
  assert.match(json, /"custom_id":"challenge-edit-v1:host:7"/);
});

test("edit panel: a hidden Challenge offers unhide", () => {
  const view = buildEditPanel(poolChallenge({ hidden: true }), { canModerate: true });

  assert.ok(buttonsOf(view.components).some((b) => b.label === "Unhide"));
  assert.match(textOf(view.components), /Hidden from members/);
});

test("edit panel: an ended Challenge can't change its end date", () => {
  const challenge = poolChallenge({
    schedule: "always_open",
    season: null,
    ends_on: "2026-10-01",
    ended_at: "2026-10-02T04:00:00Z",
    open: false,
  });
  const view = buildEditPanel(challenge, { canModerate: false });

  assert.match(textOf(view.components), /Closed for good/);
});

test("details: saves the name and description, and an Always Open end date", async () => {
  const api = fakeApi();
  const challenge = poolChallenge({ schedule: "always_open", season: null });
  const result = await saveDetails(challenge, {
    [EDIT_FIELDS.name]: "Fall of Final Fantasy, again",
    [EDIT_FIELDS.description]: "New words.",
    [EDIT_FIELDS.endsOn]: "1 December 2026",
  }, "42", api);

  assert.equal(result.error, undefined);
  assert.deepEqual(api.writes, [{
    name: "Fall of Final Fantasy, again",
    description: "New words.",
    ends_on: "2026-12-01",
  }]);
  assert.deepEqual(api.calls, ["update 7 as 42"]);
});

test("details: a Seasonal Challenge sends no end date, and a bad date is named back", async () => {
  const api = fakeApi();
  await saveDetails(poolChallenge(), {
    [EDIT_FIELDS.name]: "Fall",
    [EDIT_FIELDS.description]: "Words.",
  }, "42", api);
  assert.deepEqual(api.writes, [{ name: "Fall", description: "Words." }]);

  const bad = await saveDetails(poolChallenge({ schedule: "always_open", season: null }), {
    [EDIT_FIELDS.name]: "Fall",
    [EDIT_FIELDS.description]: "Words.",
    [EDIT_FIELDS.endsOn]: "soon",
  }, "42", api);
  assert.equal(bad.error, 'End date: "soon" is not a date, such as 3 March 2027.');
  assert.equal(api.writes.length, 1);
});

test("details: a form without the End date keeps it; an emptied End date clears it",
  async () => {
    // A panel opened before the end date became editable showed a form without it.
    const api = fakeApi();
    const alwaysOpen = poolChallenge({
      schedule: "always_open",
      season: null,
      ends_on: "2027-03-03",
    });
    await saveDetails(alwaysOpen, {
      [EDIT_FIELDS.name]: "Fall",
      [EDIT_FIELDS.description]: "Words.",
    }, "42", api);
    await saveDetails(alwaysOpen, {
      [EDIT_FIELDS.name]: "Fall",
      [EDIT_FIELDS.description]: "Words.",
      [EDIT_FIELDS.endsOn]: "",
    }, "42", api);

    assert.deepEqual(api.writes, [
      { name: "Fall", description: "Words." },
      { name: "Fall", description: "Words.", ends_on: null },
    ]);
  });

test("details: an API refusal is shown as given", async () => {
  const api = fakeApi({
    error: apiError(403, {
      error: "forbidden",
      message: "Only the Host can edit this Challenge.",
    }, { method: "patch", url: "/api/v1/challenges/7" }),
  });
  const result = await saveDetails(poolChallenge(), {
    [EDIT_FIELDS.name]: "Mine now",
    [EDIT_FIELDS.description]: "Words.",
  }, "42", api);

  assert.match(result.error ?? "", /^Only the Host can edit this Challenge\./);
  assert.match(result.error ?? "", /"status": 403/);
});

test("staff: hide refused for a member shows the API's message", async () => {
  const api = fakeApi({
    error: apiError(403, {
      error: "forbidden",
      message: "Only Moderators and above can hide a Challenge.",
    }, { method: "post", url: "/api/v1/challenges/7/hide" }),
  });
  const result = await runStaffAction({ action: "hide", challengeId: 7 }, "42", api);

  assert.ok("error" in result);
  assert.match(result.error, /^Only Moderators and above can hide a Challenge\./);
  assert.match(result.error, /"url": "\/api\/v1\/challenges\/7\/hide"/);
});

test("staff: unhide, and hand the Challenge to a member or the club", async () => {
  const api = fakeApi();
  await runStaffAction({ action: "unhide", challengeId: 7 }, "42", api);
  await runStaffAction({ action: "host", challengeId: 7, hostUserId: "555" }, "42", api);
  const result = await runStaffAction({ action: "host-club", challengeId: 7 }, "42", api);

  assert.deepEqual(api.calls, [
    "unhide 7 as 42",
    "host 7 to 555 as 42",
    "host 7 to the club as 42",
  ]);
  assert.ok("notice" in result);
  assert.equal(result.notice, "The club is now the Host.");
});
