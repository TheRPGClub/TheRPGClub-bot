import assert from "node:assert/strict";
import test from "node:test";
import type {
  IGamePlaytime,
  IManualPlaytimeWrite,
  IPlaytimeApi,
} from "../services/PlaytimeApi.js";
import {
  addPlaytimeReply,
  buildMyPlaytimeReply,
  buildPlaytimeUndoId,
  formatHoursDelta,
  formatPlaytime,
  formatPlaythroughStart,
  myPlaytimeReply,
  parsePlaytimeUndoId,
  playtimeMinutesFromHours,
  playtimePlatformChoices,
  playtimePlatformChoicesFor,
  undoPlaytimeReply,
  type IPlaytimeDeps,
  type IPlaytimePlatform,
  type PlaytimeResult,
} from "../services/Playtime.js";
import { buildGameProfileActionRow } from "../commands/gamedb/gamedb-profile.service.js";
import { featureKeyFor } from "../functions/FeatureGate.js";
import { apiError, buttonsOf, textOf } from "./challengeFixtures.js";

// /playtime add (5B receipt + Undo) and the game view's My Playtime (6B), bot#1572, with a
// fake Playtime API. The scenario is the design's: Mara's Final Fantasy VI.

const MARA = "222000000000000001";
const NOW = new Date("2026-11-25T21:10:00Z");
const FF6 = { id: 6, title: "Final Fantasy VI", coverUrl: "https://img.example/ff6.jpg" };

const PLATFORMS: IPlaytimePlatform[] = [
  { id: 1, name: "PC (Microsoft Windows)", abbreviation: "PC", code: "pc" },
  { id: 2, name: "Super Nintendo Entertainment System", abbreviation: "SNES", code: "snes" },
  { id: 3, name: "PlayStation 4", abbreviation: "PS4", code: "ps4" },
  { id: 4, name: "Nintendo Switch", abbreviation: "Switch", code: "switch" },
  { id: 5, name: "Nintendo Switch 2", abbreviation: null, code: "switch2" },
  { id: 6, name: "Atari 2600", abbreviation: "2600", code: "atari2600" },
];

function doc(overrides: Partial<IGamePlaytime> = {}): IGamePlaytime {
  return {
    user_id: MARA,
    game_id: FF6.id,
    total_minutes: 180 * 60,
    breakdown: {
      provider_sets: [
        { achievement_set_id: 1, provider: "steam", platform_label: "PC", platform_id: 1,
          minutes: 42 * 60, counted: true },
        { achievement_set_id: 2, provider: "retroachievements", platform_label: "SNES",
          platform_id: 2, minutes: 48 * 60, counted: true },
        { achievement_set_id: 3, provider: "psn", platform_label: "PS4", platform_id: 3,
          minutes: 29 * 60, counted: true },
      ],
      manual_entries: [
        { id: 70, platform_id: 4, platform_name: "Nintendo Switch", minutes: 30 * 60,
          origin: "member" },
        { id: 71, platform_id: 3, platform_name: "PlayStation 4", minutes: 31 * 60,
          origin: "member" },
      ],
    },
    mismatches: [{
      platform_id: 3, platform_name: "PlayStation 4", provider: "psn",
      provider_minutes: 29 * 60, manual_playtime_id: 71, manual_minutes: 31 * 60,
    }],
    playthrough: { id: 9, started_at: "2026-11-09T20:00:00Z", minutes: 14 * 60 + 20,
      manual: false },
    ...overrides,
  };
}

/** `doc()` with the Switch entry at `minutes` (or gone when null), totals kept in step. */
function withSwitch(minutes: number | null, base = doc()): IGamePlaytime {
  const others = base.breakdown.manual_entries.filter((e) => e.platform_id !== 4);
  const manual = minutes === null
    ? others
    : [{ id: 70, platform_id: 4, minutes, origin: "member" as const }, ...others];
  const old = base.breakdown.manual_entries.find((e) => e.platform_id === 4)?.minutes ?? 0;
  const gain = (minutes ?? 0) - old;
  return {
    ...base,
    total_minutes: base.total_minutes + gain,
    breakdown: { ...base.breakdown, manual_entries: manual },
    playthrough: base.playthrough
      ? { ...base.playthrough, minutes: base.playthrough.minutes + gain }
      : null,
  };
}

interface IFakeApi extends IPlaytimeApi {
  writes: { userId: string; gameId: number; write: IManualPlaytimeWrite }[];
  deletes: number[];
}

function fakeApi(start: IGamePlaytime, options: { failWrite?: Error } = {}): IFakeApi {
  let current = start;
  const api: IFakeApi = {
    writes: [],
    deletes: [],
    async get() {
      return current;
    },
    async writeManual(userId, gameId, write) {
      api.writes.push({ userId, gameId, write });
      if (options.failWrite) throw options.failWrite;
      const old = current.breakdown.manual_entries
        .find((e) => (e.platform_id ?? null) === write.platformId)?.minutes ?? 0;
      const minutes = write.mode === "add" ? old + write.minutes : write.minutes;
      if (write.platformId === 4) current = withSwitch(minutes, current);
      else throw new Error("fake only knows Switch");
      return current;
    },
    async deleteManual(entryId) {
      api.deletes.push(entryId);
      if (entryId === 70) current = withSwitch(null, current);
      return current;
    },
  };
  return api;
}

function deps(api: IPlaytimeApi): IPlaytimeDeps {
  return {
    api,
    platforms: async () => PLATFORMS,
    game: async (id) => (id === FF6.id ? FF6 : null),
  };
}

function viewOf(result: PlaytimeResult) {
  assert.ok("view" in result, "error" in result ? result.error : "no view");
  return result.view;
}

// --- parsing --------------------------------------------------------------------------

test("hours: adding takes more than 0, setting takes 0, both round to whole minutes", () => {
  assert.deepEqual(playtimeMinutesFromHours(3, "add"), { minutes: 180 });
  assert.deepEqual(playtimeMinutesFromHours(1.25, "add"), { minutes: 75 });
  assert.deepEqual(playtimeMinutesFromHours(0.333, "add"), { minutes: 20 });
  assert.deepEqual(playtimeMinutesFromHours(0, "set"), { minutes: 0 });
  assert.ok("error" in playtimeMinutesFromHours(0, "add"));
  assert.ok("error" in playtimeMinutesFromHours(0.001, "add"));
  assert.ok("error" in playtimeMinutesFromHours(-3, "set"));
  assert.ok("error" in playtimeMinutesFromHours(Number.NaN, "add"));
  assert.ok("error" in playtimeMinutesFromHours(100_001, "set"));
});

test("formatting: hours, minutes, deltas and the Playthrough's start", () => {
  assert.equal(formatPlaytime(183 * 60), "183 h");
  assert.equal(formatPlaytime(17 * 60 + 20), "17 h 20 m");
  assert.equal(formatPlaytime(45), "45 m");
  assert.equal(formatPlaytime(0), "0 h");
  assert.equal(formatPlaytime(1240 * 60), "1,240 h");
  assert.equal(formatHoursDelta(180), "+3");
  assert.equal(formatHoursDelta(-90), "-1.5");
  assert.equal(formatHoursDelta(15), "+0.25");
  assert.equal(formatPlaythroughStart("2026-11-09T20:00:00Z", NOW), "9 Nov");
  assert.equal(formatPlaythroughStart("2025-03-02T20:00:00Z", NOW), "2 Mar 2025");
});

test("Undo's custom ID round-trips, for an earlier total and for a new entry on Other", () => {
  const id = buildPlaytimeUndoId({ userId: MARA, gameId: 6, platformId: 4, before: 1800 });
  assert.equal(id, `playtime-undo-v1:${MARA}:6:4:1800`);
  assert.ok(id.length <= 100);
  assert.deepEqual(parsePlaytimeUndoId(id), {
    userId: MARA, gameId: 6, platformId: 4, before: 1800,
  });
  const fresh = buildPlaytimeUndoId({ userId: MARA, gameId: 6, platformId: null, before: null });
  assert.deepEqual(parsePlaytimeUndoId(fresh), {
    userId: MARA, gameId: 6, platformId: null, before: null,
  });
  assert.equal(parsePlaytimeUndoId("playtime-undo-v1:x:6:4:1"), null);
  assert.equal(parsePlaytimeUndoId("playtime-undo-v1:1:0:4:1"), null);
});

// --- platform autocomplete -----------------------------------------------------------

test("platform choices: the member's platforms for the game first, with what they hold", () => {
  const choices = playtimePlatformChoices({ query: "", platforms: PLATFORMS, doc: doc() });
  assert.deepEqual(choices.slice(0, 4).map((c) => c.value), ["4", "1", "3", "2"]);
  assert.equal(choices[0]!.name, "Nintendo Switch (Switch) · your Manual Playtime: 30 h");
  assert.equal(choices[1]!.name, "PC (Microsoft Windows) (PC) · Steam reports 42 h");
  assert.match(choices[2]!.name, /PlayStation 4 \(PS4\) · your Manual Playtime: 31 h/);
  assert.match(choices[3]!.name, /RetroAchievements reports 48 h/);
  assert.deepEqual(choices.slice(4).map((c) => c.value), ["6", "5", "other"]);
});

test("platform choices: typing filters by name, abbreviation or code", () => {
  const choices = playtimePlatformChoices({ query: "sw", platforms: PLATFORMS, doc: doc() });
  assert.deepEqual(choices.map((c) => c.value), ["4", "5"]);
  const none = playtimePlatformChoices({ query: "oth", platforms: PLATFORMS, doc: null });
  assert.deepEqual(none.map((c) => c.value), ["other"]);
});

test("platform choices: a game not picked yet, or a slow read, gives the plain list", async () => {
  const slow: IPlaytimeApi = {
    ...fakeApi(doc()),
    get: () => new Promise(() => undefined),
  };
  const choices = await playtimePlatformChoicesFor(
    { query: "", userId: MARA, gameId: 6 },
    { ...deps(slow), waitMs: 5 },
  );
  assert.equal(choices[0]!.value, "6");
  assert.ok(!choices.some((c) => c.name.includes("·")));
});

// --- 5B: /playtime add ---------------------------------------------------------------

test("/playtime add: adds to the Switch entry and answers with the 5B receipt", async () => {
  const api = fakeApi(doc());
  const view = viewOf(await addPlaytimeReply(
    { userId: MARA, gameId: 6, platformId: 4, hours: 3, set: false },
    deps(api),
  ));
  assert.deepEqual(api.writes, [{
    userId: MARA, gameId: 6, write: { platformId: 4, minutes: 180, mode: "add" },
  }]);
  assert.ok(view.flags & 64, "ephemeral");
  const text = textOf(view.components);
  assert.match(text, /^### Final Fantasy VI · 183 h$/m);
  assert.match(text, /Added 3 h to Manual · Switch \(30 h to 33 h\)/);
  assert.match(text, /^Steam · PC \*\*42 h\*\*$/m);
  assert.match(text, /^RetroAchievements · SNES \*\*48 h\*\*$/m);
  assert.match(text, /^Manual · Switch \*\*33 h\*\* \*\(\+3\)\*$/m);
  assert.match(text, /^Manual · PS4 \*\*31 h\*\*$/m);
  assert.match(text, /Playthrough open since 9 Nov: \*\*17 h 20 m\*\*/);
  assert.match(text,
    /PSN and your manual PS4 entry may both count your PS4 time\. Sort it out on the website\./);
  assert.match(JSON.stringify(view.components), /ff6\.jpg/);
  const buttons = buttonsOf(view.components);
  assert.deepEqual(buttons.map((b) => b.label), ["Undo", "Open on the website"]);
  assert.equal(buttons[0]!.customId, `playtime-undo-v1:${MARA}:6:4:1800`);
  assert.match(buttons[1]!.url ?? "", /\/games\/6$/);
});

test("/playtime add set:true: sets the total and says what it was", async () => {
  const api = fakeApi(doc());
  const text = textOf(viewOf(await addPlaytimeReply(
    { userId: MARA, gameId: 6, platformId: 4, hours: 41, set: true },
    deps(api),
  )).components);
  assert.equal(api.writes[0]!.write.mode, "set");
  assert.equal(api.writes[0]!.write.minutes, 41 * 60);
  assert.match(text, /### Final Fantasy VI · 191 h/);
  assert.match(text, /Set Manual · Switch to 41 h \(was 30 h\)/);
  assert.match(text, /Manual · Switch \*\*41 h\*\* \*\(\+11\)\*/);
});

test("/playtime add: a new entry's Undo deletes it; no Playthrough and no mismatch lines",
  async () => {
    const start = withSwitch(null, doc({ mismatches: [], playthrough: null }));
    const api = fakeApi(start);
    const view = viewOf(await addPlaytimeReply(
      { userId: MARA, gameId: 6, platformId: 4, hours: 2, set: false },
      deps({ ...api, writeManual: api.writeManual }),
    ));
    const text = textOf(view.components);
    assert.match(text, /Added 2 h to Manual · Switch \(0 h to 2 h\)/);
    assert.doesNotMatch(text, /Playthrough|Sort it out/);
    assert.equal(buttonsOf(view.components)[0]!.customId, `playtime-undo-v1:${MARA}:6:4:n`);
  });

test("/playtime add: refusals before calling the API", async () => {
  const api = fakeApi(doc());
  const run = (input: Partial<Parameters<typeof addPlaytimeReply>[0]>) => addPlaytimeReply(
    { userId: MARA, gameId: 6, platformId: 4, hours: 3, set: false, ...input },
    deps(api),
  );
  assert.match(textOf(viewOf(await run({ gameId: null })).components), /Pick the game/);
  assert.match(textOf(viewOf(await run({ platformId: undefined })).components),
    /Pick a platform/);
  assert.match(textOf(viewOf(await run({ hours: 0 })).components), /at least a minute/);
  assert.match(textOf(viewOf(await run({ gameId: 999 })).components), /No game found/);
  assert.equal(api.writes.length, 0);
});

test("/playtime add: an API refusal shows the request and the response", async () => {
  const err = apiError(422, { error: "unknown_platform", message: "Unknown platform." }, {
    method: "post",
    url: `/api/v1/users/${MARA}/games/6/manual_playtimes`,
    data: { data: { platform_id: 4, minutes: 180, mode: "add" } },
  });
  const result = await addPlaytimeReply(
    { userId: MARA, gameId: 6, platformId: 4, hours: 3, set: false },
    deps(fakeApi(doc(), { failWrite: err })),
  );
  assert.ok("error" in result);
  assert.match(result.error, /^Unknown platform\./);
  assert.match(result.error, /manual_playtimes/);
  assert.match(result.error, /422/);
});

test("Undo: sets the entry back to its earlier total, and the receipt loses Undo", async () => {
  const api = fakeApi(withSwitch(33 * 60));
  const view = viewOf(await undoPlaytimeReply(
    { userId: MARA, gameId: 6, platformId: 4, before: 30 * 60 },
    deps(api),
  ));
  assert.deepEqual(api.writes[0]!.write, { platformId: 4, minutes: 1800, mode: "set" });
  const text = textOf(view.components);
  assert.match(text, /### Final Fantasy VI · 180 h/);
  assert.match(text, /Undone: Manual · Switch is back to 30 h/);
  assert.doesNotMatch(text, /\(\+/);
  assert.deepEqual(buttonsOf(view.components).map((b) => b.label), ["Open on the website"]);
});

test("Undo: an entry the change created is deleted", async () => {
  const api = fakeApi(withSwitch(2 * 60));
  const text = textOf(viewOf(await undoPlaytimeReply(
    { userId: MARA, gameId: 6, platformId: 4, before: null },
    deps(api),
  )).components);
  assert.deepEqual(api.deletes, [70]);
  assert.equal(api.writes.length, 0);
  assert.match(text, /Undone: removed Manual · Switch/);
  assert.doesNotMatch(text, /Manual · Switch \*\*/);
});

// --- 6B: My Playtime -----------------------------------------------------------------

test("My Playtime: a table of sources and the total, the Playthrough and a hint", () => {
  const view = buildMyPlaytimeReply({ doc: doc(), game: FF6, platforms: PLATFORMS, now: NOW });
  assert.ok(view.flags & 64, "ephemeral");
  const text = textOf(view.components);
  assert.match(text, /^### Your Playtime · Final Fantasy VI$/m);
  const table = /```\n([\s\S]*?)\n```/.exec(text)![1]!.split("\n");
  assert.deepEqual(table, [
    "Steam · PC                    42 h",
    "RetroAchievements · SNES      48 h",
    "PSN · PS4                     29 h",
    "Manual · Switch               30 h",
    "Manual · PS4                  31 h",
    "----------------------------------",
    "Playtime                     180 h",
  ]);
  assert.match(text, /Playthrough open since 9 Nov: \*\*14 h 20 m\*\*/);
  assert.match(text, /Add time with \/playtime add\. PSN and your manual PS4 entry/);
  assert.match(buttonsOf(view.components)[0]!.url ?? "", /\/games\/6$/);
});

test("My Playtime: a Provider figure kept off shows in brackets with a note", () => {
  const kept = doc({ mismatches: [] });
  kept.breakdown.provider_sets[2]!.counted = false;
  const text = textOf(buildMyPlaytimeReply({ doc: kept, game: FF6, platforms: PLATFORMS })
    .components);
  assert.match(text, /PSN · PS4 {19}\(29 h\)/);
  assert.match(text, /Hours in brackets don't count/);
});

test("My Playtime: no Playtime points to linking accounts or /playtime add", () => {
  const empty = doc({
    total_minutes: 0,
    breakdown: { provider_sets: [], manual_entries: [] },
    mismatches: [],
    playthrough: null,
  });
  const view = buildMyPlaytimeReply({ doc: empty, game: FF6, platforms: PLATFORMS });
  const text = textOf(view.components);
  assert.match(text, /You have no Playtime on \*\*Final Fantasy VI\*\* yet\./);
  assert.match(text, /Link Steam, RetroAchievements or PSN on the website, or add it with/);
  assert.doesNotMatch(text, /```/);
});

test("My Playtime: reads the presser's Playtime, not the view's author's", async () => {
  const seen: string[] = [];
  const api: IPlaytimeApi = { ...fakeApi(doc()), get: async (userId) => {
    seen.push(userId);
    return doc({ user_id: userId });
  } };
  viewOf(await myPlaytimeReply({ userId: "333000000000000001", game: FF6 }, deps(api)));
  assert.deepEqual(seen, ["333000000000000001"]);
});

test("game view: My Playtime is the first row's fifth button, and it is ungated", () => {
  const rows = buildGameProfileActionRow(12, "https://youtu.be/x", false, false)
    .map((r) => r.toJSON());
  const buttons = buttonsOf(rows[0]);
  assert.equal(buttons.length, 5);
  assert.equal(buttons[4]!.label, "My Playtime");
  assert.equal(buttons[4]!.customId, "gamedb-action:playtime:12");
  const component = (customId: string) => ({ type: "component" as const, customId });
  assert.equal(featureKeyFor(component("gamedb-action:playtime:12")), null);
  assert.equal(featureKeyFor(component(`playtime-undo-v1:${MARA}:6:4:n`)), null);
});
