import assert from "node:assert/strict";
import test from "node:test";
import {
  applyBasics,
  applyCorePick,
  applyExcludePick,
  applyFranchiseMainline,
  applyGameList,
  applyIncludePick,
  applyIncludeSearch,
  applyOptionalTarget,
  applySettings,
  applySourcePick,
  draftFromChallenge,
  newChallengeDraft,
  renderWizardStep,
  saveChallengeDraft,
  WIZARD_FIELDS,
  buildIncludeModal,
  buildSettingsModal,
  challengeWriteOf,
  challengeDraftFromState,
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
import type { IGameList } from "../services/GameListApi.js";
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
  const picked = applySourcePick(settled.draft, ["franchise:9", "collection:4"]);
  return { ...picked, step: "preview", pool: { ...picked.pool, optionalTarget: 2 } };
}

function definition(overrides: Partial<IPoolDefinition> = {}): IPoolDefinition {
  return {
    franchise_ids: [9],
    collection_ids: [4],
    core_game_ids: [],
    optional_game_ids: [],
    excluded_game_ids: [],
    ...overrides,
  };
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

test("settings: Season dates and a search lead to the franchise and Series pick",
  async () => {
    const api = fakeApi();
    const { draft, errors } = await applySettings(withBasics(), poolSettings(), api);

    assert.deepEqual(errors, []);
    assert.deepEqual(draft.season, { start: "06-21", end: "09-22" });
    assert.equal(draft.pool.optionalTarget, 0);
    assert.equal(draft.step, "sources");
    assert.deepEqual(api.searches, ["suikoden"]);

    const view = await renderWizardStep(SID, draft, api);
    const [select] = selectsOf(view.components);
    assert.equal(select?.customId, `challenge-wiz-v1:sources:${SID}`);
    assert.equal(select?.placeholder, "Franchises and Series");
    assert.deepEqual(
      select?.options.map((o) => [o.label, o.description, o.value, o.default]),
      [
        ["Suikoden", "Franchise · 8 games", "franchise:9", false],
        ["Genso Suikogaiden", "Series · 2 games", "collection:4", false],
      ],
    );
    assert.equal(select?.minValues, 0);
  });

test("settings: dates it can't read are named back", async () => {
  const { errors } = await applySettings(
    withBasics(),
    poolSettings({
      [WIZARD_FIELDS.seasonStart]: "midsummer",
      [WIZARD_FIELDS.seasonEnd]: "31 February",
    }),
    fakeApi(),
  );

  assert.deepEqual(errors, [
    'Season starts: "midsummer" is not a day and month, such as 21 June.',
    'Season ends: "31 February" is not a day and month, such as 21 June.',
  ]);
});

test("settings: with no search the wizard goes to the preview, to include games by hand",
  async () => {
    const api = fakeApi({ games: [] });
    const { draft, errors } = await applySettings(
      withBasics(),
      poolSettings({ [WIZARD_FIELDS.search]: "" }),
      api,
    );
    assert.deepEqual(errors, []);
    assert.equal(draft.step, "preview");

    const view = await renderWizardStep(SID, draft, api);
    assert.match(textOf(view.components), /No games yet\. Include a game, or go Back/);
    assert.deepEqual(selectsOf(view.components), []);
  });

test("settings: the Pool modal holds the dates and the search, no target", () => {
  const modal = buildSettingsModal(SID, withBasics()).toJSON();
  const ids = modal.components.map((c) => ("component" in c ? c.component.custom_id : null));
  assert.deepEqual(ids, [
    WIZARD_FIELDS.seasonStart,
    WIZARD_FIELDS.seasonEnd,
    WIZARD_FIELDS.search,
  ]);
});

test("settings: an Always Open Pool takes an optional end date", async () => {
  const draft = applyBasics(
    newChallengeDraft("42", false),
    basics({ [WIZARD_FIELDS.schedule]: "always_open" }),
  ).draft;
  const { draft: settled, errors } = await applySettings(draft, {
    [WIZARD_FIELDS.endsOn]: "3 March 2027",
    [WIZARD_FIELDS.search]: "suikoden",
  }, fakeApi());

  assert.deepEqual(errors, []);
  assert.equal(settled.endsOn, "2027-03-03");
  assert.equal(settled.season, null);
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
  const both_ = await renderWizardStep(SID, both, api);
  assert.match(
    textOf(both_.components),
    /Chosen: the Suikoden franchise and the Genso Suikogaiden series/,
  );
  const preview = buttonsOf(view.components).find((b) => b.label === "Preview");
  assert.equal(preview?.disabled, false);
});

test("preview: the target, covers, a Core line, an Optional line, and two picks (1A)",
  async () => {
    const api = fakeApi();
    const draft = applyCorePick(await atPreview(api), shown(1, 2, 5), ["1", "2", "5"]);
    api.previews.length = 0;
    const view = await renderWizardStep(SID, draft, api);
    const text = textOf(view.components);

    assert.match(text, /^## Preview: Summer of Suikoden$/m);
    assert.ok(text.includes(
      "\n-# Pool · Clear every Core Game (3) and 2 Optional Games · " +
        "Seasonal, 21 June to 22 September\n",
    ), text);
    assert.match(text, /^\*\*Core Games \(3\)\*\* Suikoden, Suikoden II and Suikoden III$/m);
    assert.ok(text.includes(
      "\n**Optional Games (7)** from the Suikoden franchise and the Genso Suikogaiden series\n",
    ), text);
    assert.match(text, /Add-ons never come in from a franchise or Series/);
    assert.deepEqual(galleryUrls(view.components), suikodens.map((g) => g.cover_url));
    const [core, exclude] = selectsOf(view.components);
    assert.equal(core?.customId, `challenge-wiz-v1:core:${SID}`);
    assert.deepEqual(core?.options.filter((o) => o.default).map((o) => o.value), ["1", "2", "5"]);
    assert.equal(exclude?.customId, `challenge-wiz-v1:exclude:${SID}`);
    assert.equal(exclude?.options.length, 10);
    assert.deepEqual(
      buttonsOf(view.components).map((b) => [b.label, b.customId]),
      [
        ["Create Challenge", `challenge-wiz-v1:save:${SID}`],
        ["Optional target: 2", `challenge-wiz-v1:target:${SID}`],
        ["Include a game", `challenge-wiz-v1:include:${SID}`],
        ["Back", `challenge-wiz-v1:basics:${SID}`],
        ["Cancel", `challenge-wiz-v1:cancel:${SID}`],
      ],
    );
    const withCore = definition({ core_game_ids: [1, 2, 5] });
    assert.deepEqual(api.previews, [
      { pool: withCore, page: 1, per: 25 },
      { pool: withCore, page: 1, per: 25 },
      { pool: withCore, page: 1, per: 10 },
    ]);
  });

test("core: unticking a Core Game keeps it in the Pool as an Optional Game", async () => {
  const draft = applyCorePick(await atPreview(), shown(1, 2, 3), ["1", "2"]);
  assert.deepEqual(draft.pool.core.map((g) => g.id), [1, 2]);
  assert.deepEqual(draft.pool.optional, []);

  const moved = applyCorePick(draft, shown(1, 2, 3), ["2"]);
  assert.deepEqual(moved.pool.core.map((g) => g.id), [2]);
  assert.deepEqual(moved.pool.optional, [{ id: 1, title: "Suikoden" }]);

  // A Core Game on another page stays Core; ticking a hand-picked Optional Game moves it.
  const back = applyCorePick(moved, shown(1), ["1"]);
  assert.deepEqual(back.pool.core.map((g) => g.id), [2, 1]);
  assert.deepEqual(back.pool.optional, []);
});

test("target: the Optional target modal takes 0 or more, and names anything else back",
  async () => {
    const draft = await atPreview();
    const set = applyOptionalTarget(draft, { [WIZARD_FIELDS.optionalTarget]: " 5 " });
    assert.deepEqual(set.errors, []);
    assert.equal(set.draft.pool.optionalTarget, 5);
    assert.equal(
      applyOptionalTarget(draft, { [WIZARD_FIELDS.optionalTarget]: "" }).draft.pool
        .optionalTarget,
      0,
    );

    const bad = applyOptionalTarget(draft, { [WIZARD_FIELDS.optionalTarget]: "-1" });
    assert.deepEqual(bad.errors, ['Optional target: "-1" is not a whole number of 0 or more.']);
    assert.equal(bad.draft.pool.optionalTarget, 2);
  });

test("target: a Pool of Core Games alone reads as every Core Game", async () => {
  const draft = applyCorePick(await atPreview(), shown(1), ["1"]);
  const view = await renderWizardStep(SID, {
    ...draft,
    pool: { ...draft.pool, optionalTarget: 0 },
  }, fakeApi());
  assert.match(textOf(view.components), /^-# Pool · Clear every Core Game \(1\) · /m);
});

test("preview: excluded games are ticked, left out of the covers and the count", async () => {
  const api = fakeApi();
  const draft = applyExcludePick(await atPreview(api), shown(9, 10), ["10"]);
  assert.deepEqual(draft.pool.excluded, [{ id: 10, title: "Suikoden I & II HD Remaster" }]);

  const view = await renderWizardStep(SID, draft, api);
  assert.match(textOf(view.components), /^\*\*Optional Games \(9\)\*\* /m);
  assert.match(textOf(view.components), /^-# Left out: Suikoden I & II HD Remaster$/m);
  assert.equal(galleryUrls(view.components).length, 9);
  const exclude = selectsOf(view.components).find((s) => s.customId.includes(":exclude:"));
  assert.deepEqual(
    exclude?.options.filter((o) => o.default).map((o) => o.value),
    ["10"],
  );

  const back = applyExcludePick(draft, shown(9, 10), []);
  assert.deepEqual(back.pool.excluded, []);
});

test("include: a search offers GameDB games, and the pick joins as Core or Optional",
  async () => {
    const api = fakeApi();
    const choices: IIncludeChoice[] = [{ id: 77, title: "Suikoden Star Leap", year: 2024 }];
    const search = async (q: string) => {
      assert.equal(q, "star leap");
      return choices;
    };
    const searched = await applyIncludeSearch(await atPreview(api), "star leap", search);
    const view = await renderWizardStep(SID, searched, api);
    const pick = selectsOf(view.components).find((s) => s.customId.includes(":include-pick:"));
    assert.equal(pick?.placeholder, "Pick the game to add as a Core Game");
    assert.deepEqual(pick?.options.map((o) => [o.label, o.value]), [
      ["Suikoden Star Leap (2024)", "77"],
    ]);

    const core = applyIncludePick(searched, "77");
    assert.deepEqual(core.pool.core, [{ id: 77, title: "Suikoden Star Leap" }]);
    assert.deepEqual(core.includeChoices, []);

    const asOptional = await applyIncludeSearch(core, "star leap", search, "optional");
    const optional = applyIncludePick(asOptional, "77");
    assert.deepEqual(optional.pool.core, []);
    assert.deepEqual(optional.pool.optional, [{ id: 77, title: "Suikoden Star Leap" }]);
    const text = textOf((await renderWizardStep(SID, optional, api)).components);
    assert.match(text, /, plus Suikoden Star Leap added by hand$/m);
  });

test("include: the modal asks whether the game joins as Core or Optional", async () => {
  const modal = buildIncludeModal(SID, await atPreview()).toJSON();
  const radio = modal.components
    .map((c) => ("component" in c ? c.component : null))
    .find((c) => c?.custom_id === WIZARD_FIELDS.includeAs);
  assert.ok(radio && "options" in radio);
  assert.deepEqual(
    (radio.options as { value: string; default?: boolean }[]).map((o) => [o.value, o.default]),
    [["core", true], ["optional", false]],
  );
});

test("exclude: leaving out a game picked by hand takes it out of Core too", async () => {
  const draft = applyIncludePick(
    await applyIncludeSearch(await atPreview(), "x", async () => [
      { id: 77, title: "Suikoden Star Leap", year: 2024 },
    ]),
    "77",
  );
  const next = applyExcludePick(draft, [{ id: 77, title: "Suikoden Star Leap" }], ["77"]);

  assert.deepEqual(next.pool.core, []);
  assert.deepEqual(next.pool.excluded, [{ id: 77, title: "Suikoden Star Leap" }]);
  // Including it again lifts the exclusion.
  const again = applyIncludePick(
    await applyIncludeSearch(next, "x", async () => [
      { id: 77, title: "Suikoden Star Leap", year: 2024 },
    ]),
    "77",
  );
  assert.deepEqual(again.pool.excluded, []);
  assert.deepEqual(again.pool.core.map((g) => g.id), [77]);
});

test("create: sends every setting, and shows the duplicate-name warning as given", async () => {
  const api = fakeApi({
    warnings: [{ code: "duplicate_name", message: "Another Challenge is called that." }],
  });
  const excluded = applyExcludePick(await atPreview(api), shown(10), ["10"]);
  const draft = applyCorePick(excluded, shown(1, 2), ["1", "2"]);
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
        core_game_ids: [1, 2],
        optional_game_ids: [],
        excluded_game_ids: [10],
        optional_target: 2,
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

test("edit with Runs: the Pool alone stays editable, from the preview", async () => {
  const challenge = poolChallenge({
    run_count: 4,
    pool: {
      ...poolChallenge().pool!,
      optional_target: 1,
      core_games: [{ game_id: 1, title: "Final Fantasy" }],
      optional_games: [
        { game_id: 2, title: "Final Fantasy Tactics", source: "hand", new: false },
        { game_id: 3, title: "Final Fantasy II", source: "franchise", new: true },
      ],
      core_count: 1,
    },
  });
  const draft = draftFromChallenge(challenge, "42");
  assert.equal(draft.poolOnly, true);
  assert.equal(draft.step, "preview");
  assert.deepEqual(draft.pool.core, [{ id: 1, title: "Final Fantasy" }]);
  assert.deepEqual(draft.pool.optional, [{ id: 2, title: "Final Fantasy Tactics" }]);
  assert.equal(draft.pool.optionalTarget, 1);

  const view = await renderWizardStep(SID, draft, fakeApi());
  const text = textOf(view.components);
  assert.match(text, /Adding Core Games or raising the target DMs members with an Active Run/);
  assert.deepEqual(
    buttonsOf(view.components).map((b) => b.label),
    ["Save changes", "Optional target: 1", "Include a game", "Sources", "Cancel"],
  );
  const modal = buildSettingsModal(SID, draft).toJSON();
  assert.equal(modal.title, "Pool sources");
  assert.equal(modal.components.length, 1);

  assert.deepEqual(challengeWriteOf(draft), {
    pool: {
      franchise_ids: [5],
      collection_ids: [],
      core_game_ids: [1],
      optional_game_ids: [2],
      excluded_game_ids: [],
      optional_target: 1,
    },
  });
});

test("edit with Runs: Slots and Assignment rules stay locked", () => {
  const draft = draftFromChallenge(poolChallenge({
    run_count: 4,
    challenge_format: "slots",
    pool: null,
  }), "42");
  assert.equal(draft.poolOnly, false);
  assert.equal(draft.step, "basics");
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

// Starting a Pool from a Game List, and a Franchise's Mainline games as Core (bot#1569).

function soulsList(): IGameList {
  const titles = ["Lies of P", "Nioh", "Nioh 2"];
  return {
    id: 12,
    name: "Soulslike, but make it history",
    description: null,
    visibility: "members",
    sort: "ranked",
    club: false,
    owner: { user_id: "42", username: "grindlord", global_name: null },
    entry_count: 3,
    viewer: { can_edit: true, can_delete: true },
    // Served in the sort's order; the Pool takes the ranked order.
    entries: [3, 1, 2].map((position) => ({
      game_id: 200 + position,
      position,
      note: null,
      added_at: "2026-11-01T00:00:00Z",
      game: { game_id: 200 + position, title: titles[position - 1]! },
    })),
    updated_at: "2026-11-01T00:00:00Z",
  };
}

function listApi(list: IGameList | null) {
  const reads: string[] = [];
  return {
    reads,
    get: async (id: number, actingUserId: string) => {
      reads.push(`get ${id} as ${actingUserId}`);
      return list;
    },
  };
}

test("from-list: after basics the list's games come in as Core Games, and create links it",
  async () => {
    const lists = listApi(soulsList());
    const started = withBasics(newChallengeDraft("42", false, 12));
    const result = await applyGameList(started, "42", lists);

    assert.deepEqual(result.errors, []);
    assert.deepEqual(lists.reads, ["get 12 as 42"]);
    assert.deepEqual(result.draft.pool.core.map((g) => g.title), ["Lies of P", "Nioh", "Nioh 2"]);
    assert.deepEqual(result.draft.gameList, {
      id: 12, name: "Soulslike, but make it history", gameCount: 3,
    });
    // Read once: a second basics submit leaves it be.
    await applyGameList(result.draft, "42", lists);
    assert.equal(lists.reads.length, 1);

    const write = challengeWriteOf({ ...result.draft, step: "preview" });
    assert.equal(write.pool?.game_list_id, 12);
    assert.deepEqual(write.pool?.core_game_ids, [201, 202, 203]);

    const view = await renderWizardStep(SID, { ...result.draft, step: "preview" }, fakeApi());
    assert.ok(textOf(view.components).includes(
      "-# Made from your Game List **Soulslike, but make it history**. Its 3 games came in " +
        "as Core Games. Games you add to the list later arrive as Optional Games.",
    ));
  });

test("from-list: another Format, or a list that can't be read, starts without it",
  async () => {
    const slots = applyBasics(newChallengeDraft("42", false, 12), basics({
      [WIZARD_FIELDS.format]: "slots",
      [WIZARD_FIELDS.schedule]: "always_open",
    })).draft;
    const dropped = await applyGameList(slots, "42", listApi(soulsList()));
    assert.equal(dropped.draft.gameList, null);
    assert.match(dropped.errors[0] ?? "", /only starts a Pool Challenge/);

    const gone = await applyGameList(withBasics(newChallengeDraft("42", false, 12)), "42",
      listApi(null));
    assert.equal(gone.draft.gameList, null);
    assert.deepEqual(gone.draft.pool.core, []);
    assert.match(gone.errors[0] ?? "", /That Game List is gone/);
    assert.equal(challengeWriteOf(gone.draft).pool?.game_list_id, undefined);
  });

test("from-list: an edit shows the linked list but never sends it", () => {
  const draft = draftFromChallenge(poolChallenge({
    pool: {
      ...poolChallenge().pool!,
      game_list: { id: 12, name: "Soulslike", visible: true, can_add: true },
    },
  }), "42");
  assert.equal(draft.gameList?.name, "Soulslike");
  assert.equal(challengeWriteOf(draft).pool?.game_list_id, undefined);
});

test("from-list: the draft survives a restart, and a bad saved list is dropped", () => {
  const draft = newChallengeDraft("42", false, 12);
  const saved = JSON.parse(JSON.stringify(draft)) as unknown;
  assert.deepEqual(challengeDraftFromState(saved)?.gameList, {
    id: 12, name: null, gameCount: 0,
  });
  const bad = { ...draft, gameList: { id: "x" } };
  assert.equal(challengeDraftFromState(bad)?.gameList, null);
});

test("sources: a Franchise newly picked brings its Mainline games in as Core", async () => {
  const api = fakeApi();
  const settled = await applySettings(withBasics(), poolSettings(), api);
  const left = applyExcludePick(settled.draft, shown(5), ["5"]);
  const asked: number[] = [];
  const mainlineOf = async (id: number) => {
    asked.push(id);
    return [
      { game_id: 1, title: "Suikoden", mainline: true },
      { game_id: 2, title: "Suikoden II", mainline: true },
      { game_id: 5, title: "Suikoden III", mainline: true },
    ];
  };
  const picked = applySourcePick(left, ["franchise:9", "collection:4"]);
  const next = await applyFranchiseMainline(left, picked, mainlineOf);

  assert.deepEqual(asked, [9]);
  // Left out stays left out.
  assert.deepEqual(next.pool.core.map((g) => g.id), [1, 2]);
  assert.deepEqual(next.pool.excluded.map((g) => g.id), [5]);

  // Picking again with the Franchise already in asks for nothing more.
  const again = await applyFranchiseMainline(next, applySourcePick(next, ["franchise:9"]),
    mainlineOf);
  assert.deepEqual(asked, [9]);
  assert.deepEqual(again.pool.core.map((g) => g.id), [1, 2]);
});

test("sources: a Franchise that can't be read adds its games as Optional only", async () => {
  const settled = await applySettings(withBasics(), poolSettings(), fakeApi());
  const picked = applySourcePick(settled.draft, ["franchise:9"]);
  const next = await applyFranchiseMainline(settled.draft, picked, async () => {
    throw new Error("API down");
  });
  assert.deepEqual(next.pool.core, []);
  assert.deepEqual(next.pool.franchises.map((f) => f.id), [9]);
});
