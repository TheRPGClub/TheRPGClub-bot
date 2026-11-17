import assert from "node:assert/strict";
import test from "node:test";
import {
  applyBasics,
  applyExcludePick,
  applyIncludePick,
  applyIncludeSearch,
  applySettings,
  applySourcePick,
  draftFromChallenge,
  newChallengeDraft,
  renderWizardStep,
  saveChallengeDraft,
  WIZARD_FIELDS,
  type IChallengeDraft,
  type IChallengeWizardApi,
  type IIncludeChoice,
} from "../services/ChallengeWizard.js";
import type {
  IChallengeWrite,
  IGameSummary,
  IPage,
  IPoolDefinition,
  IPoolSource,
} from "../services/ChallengeApi.js";
import {
  apiError,
  buttonsOf,
  galleryUrls,
  game,
  poolChallenge,
  selectsOf,
  textOf,
} from "./challengeFixtures.js";

const SID = "chw-42-1";

interface IFakeWizardApi extends IChallengeWizardApi {
  creates: { write: IChallengeWrite; actingUserId: string }[];
  updates: { id: number; write: IChallengeWrite; actingUserId: string }[];
  previews: { pool: IPoolDefinition; page: number; per: number }[];
  searches: string[];
}

const suikodens = [
  "Suikoden", "Suikoden II", "Genso Suikogaiden Vol.1", "Genso Suikogaiden Vol.2",
  "Suikoden III", "Suikoden IV", "Suikoden Tactics", "Suikoden V", "Suikoden Tierkreis",
  "Suikoden I & II HD Remaster",
].map((title, index) => game(index + 1, title));

const sources: IPoolSource[] = [
  { kind: "franchise", id: 9, name: "Suikoden", game_count: 8 },
  { kind: "collection", id: 4, name: "Genso Suikogaiden", game_count: 2 },
];

function fakeApi(options: {
  games?: IGameSummary[];
  createError?: unknown;
  updateError?: unknown;
  warnings?: { code: string; message: string }[];
} = {}): IFakeWizardApi {
  const games = options.games ?? suikodens;
  const api: IFakeWizardApi = {
    creates: [],
    updates: [],
    previews: [],
    searches: [],
    poolSources: async (query) => {
      api.searches.push(query);
      return sources;
    },
    poolPreview: async (pool, page, per): Promise<IPage<IGameSummary>> => {
      api.previews.push({ pool, page, per });
      const kept = games.filter((g) => !pool.excluded_game_ids.includes(g.game_id));
      const items = kept.slice((page - 1) * per, page * per);
      return { items, page, pages: Math.max(1, Math.ceil(kept.length / per)), count: kept.length };
    },
    createChallenge: async (write, actingUserId) => {
      api.creates.push({ write, actingUserId });
      if (options.createError) throw options.createError;
      return {
        challenge: poolChallenge({ id: 12, name: write.name ?? "" }),
        warnings: options.warnings ?? [],
      };
    },
    updateChallenge: async (id, write, actingUserId) => {
      api.updates.push({ id, write, actingUserId });
      if (options.updateError) throw options.updateError;
      return poolChallenge({ id, name: write.name ?? "" });
    },
  };
  return api;
}

function shown(...ids: number[]): { id: number; title: string }[] {
  return suikodens
    .filter((g) => ids.includes(g.game_id))
    .map((g) => ({ id: g.game_id, title: g.title }));
}

function basics(overrides: Record<string, string | null> = {}): Record<string, string | null> {
  return {
    [WIZARD_FIELDS.name]: "Summer of Suikoden",
    [WIZARD_FIELDS.description]: "Play the Suikoden games over the summer. Clear 2 to Finish.",
    [WIZARD_FIELDS.format]: "pool",
    [WIZARD_FIELDS.schedule]: "seasonal",
    ...overrides,
  };
}

function poolSettings(
  overrides: Record<string, string | null> = {},
): Record<string, string | null> {
  return {
    [WIZARD_FIELDS.seasonStart]: "21 June",
    [WIZARD_FIELDS.seasonEnd]: "September 22",
    [WIZARD_FIELDS.target]: "number",
    [WIZARD_FIELDS.targetCount]: "2",
    [WIZARD_FIELDS.search]: "suikoden",
    ...overrides,
  };
}

function withBasics(draft = newChallengeDraft("42", false)): IChallengeDraft {
  const result = applyBasics(draft, basics());
  assert.deepEqual(result.errors, []);
  return result.draft;
}

async function atPreview(api = fakeApi()): Promise<IChallengeDraft> {
  const settled = await applySettings(withBasics(), poolSettings(), api);
  assert.deepEqual(settled.errors, []);
  return { ...applySourcePick(settled.draft, ["franchise:9", "collection:4"]), step: "preview" };
}

test("basics: the first modal sets the name, description, Format and schedule", () => {
  const { draft, errors } = applyBasics(newChallengeDraft("42", false), basics());

  assert.deepEqual(errors, []);
  assert.equal(draft.name, "Summer of Suikoden");
  assert.equal(draft.format, "pool");
  assert.equal(draft.schedule, "seasonal");
  assert.equal(draft.step, "basics");
});

test("basics: a missing name or Format is named back", () => {
  const { errors } = applyBasics(
    newChallengeDraft("42", false),
    basics({ [WIZARD_FIELDS.name]: " ", [WIZARD_FIELDS.format]: null }),
  );

  assert.deepEqual(errors, ["Give the Challenge a name.", "Choose a Challenge Format."]);
});

test("basics step: offers the Format's settings next", async () => {
  const view = await renderWizardStep(SID, withBasics(), fakeApi());

  assert.match(textOf(view.components), /New Challenge \(1 of 2\)/);
  assert.deepEqual(
    buttonsOf(view.components).map((b) => [b.label, b.customId]),
    [
      ["Pool settings", `challenge-wiz-v1:settings:${SID}`],
      ["Edit basics", `challenge-wiz-v1:basics:${SID}`],
      ["Cancel", `challenge-wiz-v1:cancel:${SID}`],
    ],
  );
});

test("settings: Season dates, target and a search lead to the franchise and collection pick", async () => {
  const api = fakeApi();
  const { draft, errors } = await applySettings(withBasics(), poolSettings(), api);

  assert.deepEqual(errors, []);
  assert.deepEqual(draft.season, { start: "06-21", end: "09-22" });
  assert.equal(draft.pool.target, 2);
  assert.equal(draft.step, "sources");
  assert.deepEqual(api.searches, ["suikoden"]);

  const view = await renderWizardStep(SID, draft, api);
  const [select] = selectsOf(view.components);
  assert.equal(select?.customId, `challenge-wiz-v1:sources:${SID}`);
  assert.deepEqual(select?.options.map((o) => [o.label, o.value, o.default]), [
    ["Suikoden (franchise, 8 games)", "franchise:9", false],
    ["Genso Suikogaiden (collection, 2 games)", "collection:4", false],
  ]);
  assert.equal(select?.minValues, 0);
});

test("settings: dates it can't read and a missing count are named back", async () => {
  const { errors } = await applySettings(
    withBasics(),
    poolSettings({
      [WIZARD_FIELDS.seasonStart]: "midsummer",
      [WIZARD_FIELDS.seasonEnd]: "31 February",
      [WIZARD_FIELDS.targetCount]: "",
    }),
    fakeApi(),
  );

  assert.deepEqual(errors, [
    'Season starts: "midsummer" is not a day and month, such as 21 June.',
    'Season ends: "31 February" is not a day and month, such as 21 June.',
    "Games to Clear: give a whole number of 1 or more, or choose every game in the Pool.",
  ]);
});

test("settings: an Always Open Pool takes an optional end date", async () => {
  const draft = applyBasics(
    newChallengeDraft("42", false),
    basics({ [WIZARD_FIELDS.schedule]: "always_open" }),
  ).draft;
  const { draft: settled, errors } = await applySettings(draft, {
    [WIZARD_FIELDS.endsOn]: "3 March 2027",
    [WIZARD_FIELDS.target]: "all",
    [WIZARD_FIELDS.targetCount]: "",
    [WIZARD_FIELDS.search]: "suikoden",
  }, fakeApi());

  assert.deepEqual(errors, []);
  assert.equal(settled.endsOn, "2027-03-03");
  assert.equal(settled.season, null);
  assert.equal(settled.pool.target, "all");
});

test("sources: picking adds them, and leaving one out of the pick removes it", async () => {
  const api = fakeApi();
  const settled = (await applySettings(withBasics(), poolSettings(), api)).draft;
  const both = applySourcePick(settled, ["franchise:9", "collection:4"]);
  assert.deepEqual(both.pool.franchises, [{ id: 9, name: "Suikoden" }]);
  assert.deepEqual(both.pool.collections, [{ id: 4, name: "Genso Suikogaiden" }]);

  const one = applySourcePick(both, ["franchise:9"]);
  assert.deepEqual(one.pool.collections, []);
  const view = await renderWizardStep(SID, one, api);
  assert.match(textOf(view.components), /Chosen: the Suikoden franchise/);
  const preview = buttonsOf(view.components).find((b) => b.label === "Preview");
  assert.equal(preview?.disabled, false);
});

test("preview: the Pool's covers, its size, and an exclude pick", async () => {
  const api = fakeApi();
  const draft = await atPreview(api);
  api.previews.length = 0;
  const view = await renderWizardStep(SID, draft, api);
  const text = textOf(view.components);

  assert.match(text, /^## Preview: Summer of Suikoden$/m);
  assert.match(text, /^-# Pool · Clear 2 · Seasonal, 21 June to 22 September$/m);
  assert.match(
    text,
    /^10 games from the Suikoden franchise and the Genso Suikogaiden collection$/m,
  );
  assert.deepEqual(galleryUrls(view.components), suikodens.map((g) => g.cover_url));
  const [exclude] = selectsOf(view.components);
  assert.equal(exclude?.customId, `challenge-wiz-v1:exclude:${SID}`);
  assert.equal(exclude?.options.length, 10);
  assert.deepEqual(
    buttonsOf(view.components).map((b) => b.label),
    ["Create Challenge", "Include a game", "Back", "Cancel"],
  );
  const definition = {
    franchise_ids: [9],
    collection_ids: [4],
    included_game_ids: [],
    excluded_game_ids: [],
  };
  assert.deepEqual(api.previews, [
    { pool: definition, page: 1, per: 25 },
    { pool: definition, page: 1, per: 10 },
  ]);
});

test("preview: excluded games are ticked, left out of the covers and the count", async () => {
  const api = fakeApi();
  const draft = applyExcludePick(await atPreview(api), shown(9, 10), ["10"]);
  assert.deepEqual(draft.pool.excluded, [{ id: 10, title: "Suikoden I & II HD Remaster" }]);

  const view = await renderWizardStep(SID, draft, api);
  assert.match(textOf(view.components), /^9 games from /m);
  assert.equal(galleryUrls(view.components).length, 9);
  const [exclude] = selectsOf(view.components);
  assert.deepEqual(
    exclude?.options.filter((o) => o.default).map((o) => o.value),
    ["10"],
  );

  const back = applyExcludePick(draft, shown(9, 10), []);
  assert.deepEqual(back.pool.excluded, []);
});

test("include: a search offers GameDB games, and the pick joins the Pool", async () => {
  const api = fakeApi();
  const choices: IIncludeChoice[] = [{ id: 77, title: "Suikoden Star Leap", year: 2024 }];
  const searched = await applyIncludeSearch(await atPreview(api), "star leap", async (q) => {
    assert.equal(q, "star leap");
    return choices;
  });
  const view = await renderWizardStep(SID, searched, api);
  const pick = selectsOf(view.components).find((s) => s.customId.includes(":include-pick:"));
  assert.deepEqual(pick?.options.map((o) => [o.label, o.value]), [
    ["Suikoden Star Leap (2024)", "77"],
  ]);

  const included = applyIncludePick(searched, "77");
  assert.deepEqual(included.pool.included, [{ id: 77, title: "Suikoden Star Leap" }]);
  assert.deepEqual(included.includeChoices, []);
});

test("exclude: excluding a game added by hand takes it back out instead", async () => {
  const draft = applyIncludePick(
    await applyIncludeSearch(await atPreview(), "x", async () => [
      { id: 77, title: "Suikoden Star Leap", year: 2024 },
    ]),
    "77",
  );
  const next = applyExcludePick(draft, [{ id: 77, title: "Suikoden Star Leap" }], ["77"]);

  assert.deepEqual(next.pool.included, []);
  assert.deepEqual(next.pool.excluded, []);
});

test("create: sends every setting, and shows the duplicate-name warning as given", async () => {
  const api = fakeApi({
    warnings: [{ code: "duplicate_name", message: "Another Challenge is called that." }],
  });
  const draft = applyExcludePick(await atPreview(api), shown(10), ["10"]);
  const result = await saveChallengeDraft({ ...draft, clubHosted: true }, "42", api);

  assert.deepEqual(api.creates, [{
    actingUserId: "42",
    write: {
      name: "Summer of Suikoden",
      description: "Play the Suikoden games over the summer. Clear 2 to Finish.",
      challenge_format: "pool",
      schedule: "seasonal",
      season: { start: "06-21", end: "09-22" },
      ends_on: null,
      pool: {
        franchise_ids: [9],
        collection_ids: [4],
        included_game_ids: [],
        excluded_game_ids: [10],
        target: 2,
      },
      hosted_by_club: true,
    },
  }]);
  assert.equal(result.saved, true);
  const text = textOf(result.view.components);
  assert.match(text, /Created \*\*Summer of Suikoden\*\*/);
  assert.match(text, /Another Challenge is called that\./);
});

test("create: an API refusal is shown as given, with the request and response", async () => {
  const body = { error: "invalid_challenge", message: "The Season must not be empty." };
  const api = fakeApi({
    createError: apiError(422, body, { method: "post", url: "/api/v1/challenges" }),
  });
  const result = await saveChallengeDraft(await atPreview(api), "42", api);

  assert.equal(result.saved, false);
  const text = textOf(result.view.components);
  assert.match(text, /^The Season must not be empty\./);
  assert.match(text, /"url": "\/api\/v1\/challenges"/);
  assert.match(text, /"status": 422/);
});

test("edit: the wizard starts from the Challenge and saves with a PATCH", async () => {
  const api = fakeApi({
    updateError: apiError(409, {
      error: "rules_locked",
      message: "This Challenge has Runs, so its Pool can't change.",
      fields: ["pool"],
    }, { method: "patch", url: "/api/v1/challenges/7" }),
  });
  const draft = draftFromChallenge(poolChallenge(), "42");
  assert.equal(draft.mode, "edit");
  assert.deepEqual(draft.season, { start: "09-22", end: "12-21" });
  assert.deepEqual(draft.pool.franchises, [{ id: 5, name: "Final Fantasy" }]);

  const result = await saveChallengeDraft({ ...draft, step: "preview" }, "42", api);
  assert.equal(api.updates[0]?.id, 7);
  assert.equal(api.updates[0]?.write.hosted_by_club, undefined);
  assert.equal(result.saved, false);
  assert.match(textOf(result.view.components), /^This Challenge has Runs, so its Pool can't/);
});

test("edit: the preview's button saves the changes", async () => {
  const draft = { ...draftFromChallenge(poolChallenge(), "42"), step: "preview" as const };
  const view = await renderWizardStep(SID, draft, fakeApi());

  assert.equal(buttonsOf(view.components)[0]?.label, "Save changes");
});

test("assignment: a calendar in place of a Pool, always Always Open", async () => {
  const api = fakeApi();
  const draft = applyBasics(
    newChallengeDraft("42", false),
    basics({ [WIZARD_FIELDS.format]: "assignment", [WIZARD_FIELDS.schedule]: "seasonal" }),
  ).draft;
  const { draft: settled, errors } = await applySettings(draft, {
    [WIZARD_FIELDS.signupCutoff]: "1 December",
    [WIZARD_FIELDS.pickDeadline]: "15 December",
    [WIZARD_FIELDS.reveal]: "25 December",
  }, api);
  assert.deepEqual(errors, []);
  assert.equal(settled.step, "preview");

  const view = await renderWizardStep(SID, settled, api);
  assert.match(textOf(view.components), /Sign-up closes 1 December/);
  await saveChallengeDraft(settled, "42", api);
  const write = api.creates[0]?.write;
  assert.equal(write?.schedule, "always_open");
  assert.equal(write?.ends_on, null);
  assert.deepEqual(write?.assignment, {
    signup_cutoff: "12-01",
    pick_deadline: "12-15",
    reveal: "12-25",
  });
  assert.equal(write?.pool, undefined);
});
