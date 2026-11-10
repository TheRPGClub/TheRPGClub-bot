import assert from "node:assert/strict";
import test from "node:test";
import { ContainerBuilder, MessageFlags, TextDisplayBuilder } from "discord.js";

import {
  addPreviewNote,
  decideFeatureGate,
  FEATURE_NOT_AVAILABLE_MESSAGE,
  FEATURE_PREVIEW_NOTE,
  featureKeyFor,
  resolveFeatureGate,
  type FeatureState,
  type IFeatureAccess,
} from "../functions/FeatureGate.js";
import {
  createFeatureAccessCache,
  toFeatureAccess,
  type FeatureAccessPayload,
  type IFeatureAccessApi,
} from "../services/FeatureAccessService.js";

/**
 * Builds the API lookup's answer for one Feature the way api#350 computes it:
 * Live is usable by everyone, Preview by staff only, Off by nobody.
 */
function accessFor(key: string, state: FeatureState, staff: boolean): IFeatureAccess {
  const canUse = state === "live" || (state === "preview" && staff);
  return {
    userId: "42",
    staff,
    features: [
      { key, name: key, state, canUse, preview: staff && state === "preview" },
    ],
  };
}

const MATRIX: Array<[FeatureState, boolean, string]> = [
  ["live", false, "run"],
  ["live", true, "run"],
  ["preview", false, "not_available"],
  ["preview", true, "preview_note"],
  ["off", false, "not_available"],
  ["off", true, "not_available"],
];

for (const [state, staff, expected] of MATRIX) {
  const who = staff ? "staff" : "non-staff";
  test(`decideFeatureGate: ${state} Feature for ${who} -> ${expected}`, () => {
    assert.equal(decideFeatureGate("journals", accessFor("journals", state, staff)), expected);
  });
}

test("decideFeatureGate: an unmapped command always runs, whatever the flags", () => {
  assert.equal(decideFeatureGate(null, accessFor("journals", "off", false)), "run");
  assert.equal(decideFeatureGate(null, null), "run");
});

const COMMANDS: Array<[string, string | null]> = [
  ["gamedb", "game_index"],
  ["gotm", "voting_gotm"],
  ["nominate", "voting_gotm"],
  ["backlog", "backlog"],
  ["collection", "collection"],
  ["now-playing", "now_playing"],
  ["Now playing", "now_playing"],
  ["game-completion", "game_completions"],
  ["Compare completions", "game_completions"],
  ["game-journal", "journals"],
  ["giveaway", "giveaways"],
  ["gamegiveaway", "giveaways"],
  ["suggestion", "suggestions"],
  ["help", null],
  ["timestamp", null],
  ["profile", null],
  ["View profile", null],
  ["admin", null],
  ["mod", null],
  ["superadmin", null],
  ["generate-vote-image", null],
];

for (const [name, expected] of COMMANDS) {
  test(`featureKeyFor: command "${name}" -> ${expected ?? "unmapped"}`, () => {
    assert.equal(featureKeyFor({ type: "command", name }), expected);
  });
}

const COMPONENTS: Array<[string, string | null]> = [
  ["gamedb-search-page:1:2:zelda:x:next", "game_index"],
  ["gamedb-action:video:12", "game_index"],
  ["gamedb-action:nowplaying:12", "now_playing"],
  ["gamedb-action:backlog:12", "backlog"],
  ["gamedb-action:collection:12", "collection"],
  ["gamedb-collection-platform:12", "collection"],
  ["gamedb-completion-next:12", "game_completions"],
  ["gotm-nom-details:4", "voting_gotm"],
  ["vote-runoff-cast:gotm:4:9", "voting_gotm"],
  ["blm1:a:b:c:e", "backlog"],
  ["collection-list-nav-v2:a:b:1:e:next", "collection"],
  ["nowplaying-list-edit:42", "now_playing"],
  ["np-complete-type:abc", "now_playing"],
  ["nowplaying-journal-open:1:2:3", "journals"],
  ["nowplaying-view-journal:42", "journals"],
  ["comp-journal-page:1:2:next:3", "journals"],
  ["comp-list-header:42", "game_completions"],
  ["completion-react-type:abc", "game_completions"],
  ["game-journal-hmenu-add:1:2", "journals"],
  ["journal-public-close:1", "journals"],
  ["giveaway-hub-claim:7", "giveaways"],
  ["suggestion-approve:3", "suggestions"],
  ["todo-review-suggestions", "suggestions"],
  ["now-playing-help-select", null],
  ["help:gamedb:main", null],
  ["admin-vote-close:4:confirm", null],
  ["vsbx-pick:1:ab:2:gotm:3", null],
  ["gotm-audit-stop-1", null],
  ["user-header-label:1", null],
  ["todo-list-page:x:1", null],
];

for (const [customId, expected] of COMPONENTS) {
  test(`featureKeyFor: component "${customId}" -> ${expected ?? "unmapped"}`, () => {
    assert.equal(featureKeyFor({ type: "component", customId }), expected);
  });
}

/** A fake API client that answers like api#350 and counts lookups per user. */
function fakeApi(state: FeatureState = "live"): IFeatureAccessApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async fetchFeatureAccess(userId: string): Promise<IFeatureAccess> {
      calls.push(userId);
      return { ...accessFor("journals", state, false), userId };
    },
  };
}

test("toFeatureAccess: maps the API lookup's payload", () => {
  const raw: FeatureAccessPayload = {
    data: {
      user_id: "123",
      staff: true,
      features: [
        { key: "game_index", name: "Game Index", state: "live", can_use: true, preview: false },
        { key: "journals", name: "Journals", state: "preview", can_use: true, preview: true },
      ],
    },
  };
  assert.deepEqual(toFeatureAccess(raw), {
    userId: "123",
    staff: true,
    features: [
      { key: "game_index", name: "Game Index", state: "live", canUse: true, preview: false },
      { key: "journals", name: "Journals", state: "preview", canUse: true, preview: true },
    ],
  });
});

test("feature access cache: one lookup per user within the TTL", async () => {
  const api = fakeApi();
  const cache = createFeatureAccessCache(api, 60_000);
  await cache.get("1");
  await cache.get("1");
  await cache.get("2");
  assert.deepEqual(api.calls, ["1", "2"]);
  assert.equal((await cache.get("2")).userId, "2");
});

test("feature access cache: clear() makes the next use look up again (/flag set)", async () => {
  const api = fakeApi();
  const cache = createFeatureAccessCache(api, 60_000);
  await cache.get("1");
  await cache.get("2");
  cache.clear();
  await cache.get("1");
  assert.deepEqual(api.calls, ["1", "2", "1"]);
});

test("feature access cache: a user idle past the TTL waits for a fresh answer", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  let state: FeatureState = "live";
  const calls: string[] = [];
  const api: IFeatureAccessApi = {
    async fetchFeatureAccess(userId) {
      calls.push(userId);
      return accessFor("journals", state, false);
    },
  };
  const cache = createFeatureAccessCache(api, 60_000);
  assert.equal((await cache.get("1")).features[0].state, "live");

  state = "off";
  t.mock.timers.tick(30_000);
  assert.equal((await cache.get("1")).features[0].state, "live");
  assert.equal(calls.length, 1);

  t.mock.timers.tick(61_000);
  assert.equal((await cache.get("1")).features[0].state, "off");
  assert.equal(calls.length, 2);
});

test("resolveFeatureGate: an unmapped command never asks the API", async () => {
  const api = fakeApi("off");
  const cache = createFeatureAccessCache(api);
  const decision = await resolveFeatureGate({ type: "command", name: "help" }, "1", cache);
  assert.equal(decision, "run");
  assert.deepEqual(api.calls, []);
});

test("resolveFeatureGate: a mapped command follows the user's access", async () => {
  const off = createFeatureAccessCache(fakeApi("off"));
  const target = { type: "command", name: "game-journal" } as const;
  assert.equal(await resolveFeatureGate(target, "1", off), "not_available");

  const staffPreview = { get: async () => accessFor("journals", "preview", true) };
  const component = { type: "component", customId: "game-journal-hmenu-add:1:2" } as const;
  assert.equal(await resolveFeatureGate(component, "1", staffPreview), "preview_note");
});

test("resolveFeatureGate: a failed lookup lets the command run", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const failing = { get: async (): Promise<IFeatureAccess> => { throw new Error("down"); } };
  const target = { type: "command", name: "giveaway" } as const;
  assert.equal(await resolveFeatureGate(target, "1", failing), "run");
});

test("resolveFeatureGate: a lookup slower than the wait lets the command run", async () => {
  const hanging = { get: () => new Promise<IFeatureAccess>(() => undefined) };
  const target = { type: "command", name: "giveaway" } as const;
  assert.equal(await resolveFeatureGate(target, "1", hanging, 5), "run");
});

test("feature gate copy: the refusal and the Preview note", () => {
  assert.equal(FEATURE_NOT_AVAILABLE_MESSAGE, "This feature isn't available yet.");
  assert.equal(FEATURE_PREVIEW_NOTE, "-# Preview - staff only");
});

function componentsJson(payload: { components?: unknown[] }): unknown[] {
  return (payload.components ?? []).map((component) =>
    typeof (component as { toJSON?: unknown }).toJSON === "function"
      ? (component as { toJSON(): unknown }).toJSON()
      : component);
}

test("addPreviewNote: a Components V2 reply gets the note as a text component", () => {
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent("Your journal"),
  );
  const flags = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
  const noted = addPreviewNote({ components: [container], flags });
  assert.equal(noted.flags, flags);
  const json = componentsJson(noted);
  assert.equal(json.length, 2);
  assert.deepEqual(json[1], { type: 10, content: "-# Preview - staff only" });
  assert.deepEqual(componentsJson(addPreviewNote(noted)), json);
});

test("addPreviewNote: plain text and content replies get the note appended", () => {
  assert.equal(addPreviewNote("Saved."), "Saved.\n-# Preview - staff only");
  const noted = addPreviewNote({ content: "Saved.", embeds: [] });
  assert.deepEqual(noted, { content: "Saved.\n-# Preview - staff only", embeds: [] });
  assert.deepEqual(addPreviewNote(noted), noted);
});

test("addPreviewNote: an edit that keeps the message body is left alone", () => {
  const flagsOnly = { flags: MessageFlags.IsComponentsV2 };
  assert.deepEqual(addPreviewNote(flagsOnly), flagsOnly);
  const embedsOnly = { embeds: [] };
  assert.deepEqual(addPreviewNote(embedsOnly), embedsOnly);
});

test("feature gate map: every mapped Feature is one of the API registry's 11 keys", async () => {
  const { FEATURE_COMMANDS, FEATURE_COMPONENT_PREFIXES } = await import(
    "../config/featureGate.js",
  );
  const registry = new Set([
    "game_index", "voting_gotm", "backlog", "collection", "now_playing", "game_completions",
    "reviews", "achievement_hub", "giveaways", "journals", "suggestions",
  ]);
  const mapped = [
    ...Object.values(FEATURE_COMMANDS),
    ...FEATURE_COMPONENT_PREFIXES.map(([, key]) => key),
  ];
  assert.deepEqual(mapped.filter((key) => !registry.has(key)), []);
});
