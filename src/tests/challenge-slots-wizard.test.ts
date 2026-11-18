import assert from "node:assert/strict";
import test from "node:test";
import {
  applyBasics,
  applySettings,
  buildBasicsModal,
  buildSettingsModal,
  challengeDraftFromState,
  challengeWriteOf,
  draftFromChallenge,
  newChallengeDraft,
  renderWizardStep,
  saveChallengeDraft,
  WIZARD_FIELDS,
  type IChallengeDraft,
  type IChallengeWizardApi,
} from "../services/ChallengeWizard.js";
import type { IChallengeWrite } from "../services/ChallengeApi.js";
import { buildEditPanel } from "../services/ChallengeEdit.js";
import { buttonsOf, slotsChallenge, textOf } from "./challengeFixtures.js";

// /challenge create with the Slots Format (bot#1550), design 6C: Counts past play in the
// basics modal, then the Slots settings modal (first and last year), then the preview.

const SID = "chw-42-1";

function basics(overrides: Record<string, string | null> = {}): Record<string, string | null> {
  return {
    [WIZARD_FIELDS.name]: "Years Alive",
    [WIZARD_FIELDS.description]: "One game from every year you've been alive.",
    [WIZARD_FIELDS.format]: "slots",
    [WIZARD_FIELDS.schedule]: "always_open",
    [WIZARD_FIELDS.countsPastPlay]: "on",
    ...overrides,
  };
}

function slotsSettings(
  overrides: Record<string, string | null> = {},
): Record<string, string | null> {
  return {
    [WIZARD_FIELDS.firstYear]: "birth_year",
    [WIZARD_FIELDS.firstYearFixed]: "",
    [WIZARD_FIELDS.lastYear]: "current_year",
    [WIZARD_FIELDS.lastYearFixed]: "",
    [WIZARD_FIELDS.endsOn]: "",
    ...overrides,
  };
}

function withBasics(overrides: Record<string, string | null> = {}): IChallengeDraft {
  const result = applyBasics(newChallengeDraft("42", false), basics(overrides));
  assert.deepEqual(result.errors, []);
  return result.draft;
}

function fakeApi(): IChallengeWizardApi & { creates: IChallengeWrite[]; updates: number[] } {
  const api = {
    creates: [] as IChallengeWrite[],
    updates: [] as number[],
    poolSources: async () => [],
    poolPreview: async () => {
      throw new Error("A Slots Challenge has no Pool to preview.");
    },
    createChallenge: async (write: IChallengeWrite) => {
      api.creates.push(write);
      return { challenge: slotsChallenge({ name: write.name ?? "" }), warnings: [] };
    },
    updateChallenge: async (id: number, write: IChallengeWrite) => {
      api.updates.push(id);
      return slotsChallenge({ id, name: write.name ?? "" });
    },
  };
  return api;
}

test("basics modal: Slots is offered first, with Counts past play", () => {
  const json = JSON.stringify(buildBasicsModal(SID, newChallengeDraft("42", false)).toJSON());
  assert.ok(json.indexOf("\"Slots\"") < json.indexOf("\"Pool\""), "Slots leads the Formats");
  assert.match(json, /Let earlier Game Completions be picked/);
  assert.match(json, /Always Open only/);
  assert.match(json, new RegExp(WIZARD_FIELDS.countsPastPlay));
});

test("basics: Slots with Counts past play on an Always Open Challenge", () => {
  const draft = withBasics();

  assert.equal(draft.format, "slots");
  assert.equal(draft.schedule, "always_open");
  assert.equal(draft.slots.countsPastPlay, true);
});

test("basics: Counts past play needs Slots and Always Open", () => {
  const seasonal = applyBasics(
    newChallengeDraft("42", false),
    basics({ [WIZARD_FIELDS.schedule]: "seasonal" }),
  );
  assert.deepEqual(seasonal.errors, ["Counts past play is only for Always Open Challenges."]);

  const pool = applyBasics(
    newChallengeDraft("42", false),
    basics({ [WIZARD_FIELDS.format]: "pool" }),
  );
  assert.deepEqual(pool.errors, ["Counts past play is only for Slots Challenges."]);

  const off = applyBasics(
    newChallengeDraft("42", false),
    basics({ [WIZARD_FIELDS.format]: "pool", [WIZARD_FIELDS.countsPastPlay]: null }),
  );
  assert.deepEqual(off.errors, []);
});

test("settings modal: first and last year, and the end date while Always Open", () => {
  const json = JSON.stringify(buildSettingsModal(SID, withBasics()).toJSON());
  assert.match(json, /Slots settings \(2 of 2\)/);
  assert.match(json, /Each member's birth year/);
  assert.match(json, /Members are asked for their Birth Date/);
  assert.match(json, /The current year/);
  assert.match(json, /Gains a slot every 1 January/);
  assert.match(json, /Fixed first year/);
  assert.match(json, /Fixed last year/);
  assert.match(json, /Counts past play was set in step 1/);
  assert.match(json, new RegExp(WIZARD_FIELDS.endsOn));
});

test("settings modal: a Seasonal Slots Challenge takes its Season in one field", () => {
  const draft = withBasics({
    [WIZARD_FIELDS.schedule]: "seasonal",
    [WIZARD_FIELDS.countsPastPlay]: null,
  });
  const json = JSON.stringify(buildSettingsModal(SID, draft).toJSON());
  assert.match(json, new RegExp(WIZARD_FIELDS.season));
  assert.match(json, /21 June to 22 September/);
});

test("settings: birth year to the current year goes to the preview", async () => {
  const { draft, errors } = await applySettings(withBasics(), slotsSettings());

  assert.deepEqual(errors, []);
  assert.equal(draft.step, "preview");
  assert.deepEqual(challengeWriteOf(draft).slots, {
    first_year: "birth_year",
    last_year: "current_year",
    counts_past_play: true,
  });
  assert.equal(challengeWriteOf(draft).pool, undefined);
});

test("settings: fixed years, and years it can't read named back", async () => {
  const fixed = await applySettings(withBasics(), slotsSettings({
    [WIZARD_FIELDS.firstYear]: "fixed",
    [WIZARD_FIELDS.firstYearFixed]: "1990",
    [WIZARD_FIELDS.lastYear]: "fixed",
    [WIZARD_FIELDS.lastYearFixed]: " 1999 ",
  }));
  assert.deepEqual(fixed.errors, []);
  assert.deepEqual(challengeWriteOf(fixed.draft).slots, {
    first_year: 1990,
    last_year: 1999,
    counts_past_play: true,
  });

  const bad = await applySettings(withBasics(), slotsSettings({
    [WIZARD_FIELDS.firstYear]: "fixed",
    [WIZARD_FIELDS.firstYearFixed]: "",
    [WIZARD_FIELDS.lastYear]: "fixed",
    [WIZARD_FIELDS.lastYearFixed]: "nineties",
  }));
  assert.deepEqual(bad.errors, [
    "Fixed first year: give a year, such as 1990.",
    "Fixed last year: \"nineties\" is not a year, such as 1999.",
  ]);
  assert.equal(bad.draft.step, "basics");

  const backwards = await applySettings(withBasics(), slotsSettings({
    [WIZARD_FIELDS.firstYear]: "fixed",
    [WIZARD_FIELDS.firstYearFixed]: "2001",
    [WIZARD_FIELDS.lastYear]: "fixed",
    [WIZARD_FIELDS.lastYearFixed]: "1999",
  }));
  assert.deepEqual(backwards.errors, ["The first year can't come after the last year."]);
});

test("settings: a Seasonal Slots Challenge reads its Season", async () => {
  const draft = withBasics({
    [WIZARD_FIELDS.schedule]: "seasonal",
    [WIZARD_FIELDS.countsPastPlay]: null,
  });
  const result = await applySettings(draft, slotsSettings({
    [WIZARD_FIELDS.season]: "21 June to September 22",
  }));

  assert.deepEqual(result.errors, []);
  const write = challengeWriteOf(result.draft);
  assert.deepEqual(write.season, { start: "06-21", end: "09-22" });
  assert.equal(write.slots?.counts_past_play, false);

  const bad = await applySettings(draft, slotsSettings({ [WIZARD_FIELDS.season]: "summer" }));
  assert.deepEqual(bad.errors, [
    "Season: \"summer\" is not two days and months, such as 21 June to 22 September.",
  ]);
});

test("preview: the Slots rules, then Create Challenge", async () => {
  const { draft } = await applySettings(withBasics(), slotsSettings());
  const view = await renderWizardStep(SID, draft, fakeApi());

  const text = textOf(view.components);
  assert.match(text, /^## Preview: Years Alive$/m);
  assert.match(text, /^\*\*Slots\*\* Your birth year to the current year$/m);
  assert.match(text, /^\*\*Counts past play\*\* Pick earlier Game Completions for open years$/m);
  assert.deepEqual(
    buttonsOf(view.components).map((b) => b.label),
    ["Create Challenge", "Back", "Cancel"],
  );
});

test("create: sends the Slots settings", async () => {
  const api = fakeApi();
  const { draft } = await applySettings(withBasics(), slotsSettings());
  const result = await saveChallengeDraft(draft, "42", api);

  assert.equal(result.saved, true);
  assert.equal(api.creates[0]?.challenge_format, "slots");
  assert.deepEqual(api.creates[0]?.slots, {
    first_year: "birth_year",
    last_year: "current_year",
    counts_past_play: true,
  });
});

test("edit: a Slots Challenge's rules start from its settings", () => {
  const draft = draftFromChallenge(slotsChallenge({
    slots: { first_year: 1990, last_year: 1999, counts_past_play: false },
  }), "42");

  assert.equal(draft.format, "slots");
  assert.deepEqual(draft.slots, { firstYear: 1990, lastYear: 1999, countsPastPlay: false });
  assert.deepEqual(challengeWriteOf(draft).slots, {
    first_year: 1990,
    last_year: 1999,
    counts_past_play: false,
  });
});

test("restore: a saved Slots draft comes back; an older one without slots gets defaults",
  () => {
    const draft = withBasics();
    assert.deepEqual(challengeDraftFromState(JSON.parse(JSON.stringify(draft)))?.slots,
      draft.slots);

    const older = JSON.parse(JSON.stringify(newChallengeDraft("42", false)));
    delete older.slots;
    assert.deepEqual(challengeDraftFromState(older)?.slots, {
      firstYear: "birth_year",
      lastYear: "current_year",
      countsPastPlay: false,
    });
  });

test("edit panel: a Slots Challenge's rules open the wizard until a Run exists", () => {
  const open = buildEditPanel(slotsChallenge({ run_count: 0 }), { canModerate: false });
  const rules = buttonsOf(open.components).find((b) => b.label === "Rules");
  assert.equal(rules?.disabled, false);
  assert.doesNotMatch(textOf(open.components), /website/);

  const locked = buildEditPanel(slotsChallenge({ run_count: 2 }), { canModerate: false });
  assert.equal(buttonsOf(locked.components).find((b) => b.label === "Rules")?.disabled, true);
});
