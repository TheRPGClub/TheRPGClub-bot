import assert from "node:assert/strict";
import test from "node:test";
import { ContainerBuilder, MessageFlags, TextDisplayBuilder } from "discord.js";

import { safeV2TextContent } from "../functions/ComponentsV2Utils.js";
import {
  addPreviewNote,
  decideFeatureGate,
  FEATURE_NOT_AVAILABLE_MESSAGE,
  FEATURE_PREVIEW_NOTE,
  featureKeyFor,
  resolveFeatureGate,
  type FeatureState,
  type IFeatureAccess,
  type IFeatureFlag,
  type IFeatureGateSource,
} from "../functions/FeatureGate.js";
import {
  createFeatureAccessCache,
  createFeatureFlagCache,
  toFeatureAccess,
  type FeatureAccessPayload,
  type IFeatureAccessApi,
} from "../services/FeatureAccessService.js";

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
    assert.equal(decideFeatureGate(state, staff), expected);
  });
}

test("decideFeatureGate: no state (unmapped, unlisted or unread) always runs", () => {
  assert.equal(decideFeatureGate(null, false), "run");
  assert.equal(decideFeatureGate(null, null), "run");
});

test("decideFeatureGate: Preview with an unknown staff answer is refused (fails closed)",
  () => {
    assert.equal(decideFeatureGate("preview", null), "not_available");
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

/** The api#350 lookup's answer for one user: `states` for every Feature, and `staff`. */
function accessFor(
  userId: string,
  states: Record<string, FeatureState>,
  staff = false,
): IFeatureAccess {
  return {
    userId,
    staff,
    features: Object.entries(states).map(([key, state]) => ({
      key,
      name: key,
      state,
      canUse: state === "live" || (state === "preview" && staff),
      preview: staff && state === "preview",
    })),
  };
}

/** A fake API client that answers like api#350 and records whom it was asked about. */
function fakeApi(
  states: () => Record<string, FeatureState> = () => ({ journals: "live" }),
  staffIds: readonly string[] = [],
): IFeatureAccessApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async fetchFeatureAccess(userId: string): Promise<IFeatureAccess> {
      calls.push(userId);
      return accessFor(userId, states(), staffIds.includes(userId));
    },
  };
}

/** A gate source over the real caches and a fake API, as the bot wires them. */
function gateSource(api: IFeatureAccessApi): IFeatureGateSource {
  const flags = createFeatureFlagCache(() => "bot", api);
  const access = createFeatureAccessCache(api);
  return { flags: () => flags.flags(), isStaff: async (id) => (await access.get(id)).staff };
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

test("feature flag cache: one club-wide lookup, through the bot's own user", async () => {
  const api = fakeApi(() => ({ journals: "off", reviews: "live" }));
  const cache = createFeatureFlagCache(() => "bot", api, 60_000);
  assert.deepEqual(await cache.flags(), [
    { key: "journals", name: "journals", state: "off" },
    { key: "reviews", name: "reviews", state: "live" },
  ]);
  await cache.flags();
  assert.deepEqual(api.calls, ["bot"]);
});

test("feature flag cache: refresh() reads the flags again at once (/flag set)", async () => {
  let state: FeatureState = "live";
  const api = fakeApi(() => ({ journals: state }));
  const cache = createFeatureFlagCache(() => "bot", api, 60_000);
  assert.equal((await cache.flags())[0].state, "live");
  state = "off";
  cache.refresh();
  assert.equal(api.calls.length, 2, "refresh() starts the new read itself");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await cache.flags())[0].state, "off");
  assert.equal(api.calls.length, 2);
});

test("feature flag cache: refresh() keeps the last flags until the new read lands",
  async (t) => {
    t.mock.method(console, "error", () => undefined);
    let fail = false;
    const flags = fakeApi(() => ({ journals: "off" }));
    const api: IFeatureAccessApi = {
      async fetchFeatureAccess(userId) {
        if (fail) throw new Error("API down");
        return flags.fetchFeatureAccess(userId);
      },
    };
    const cache = createFeatureFlagCache(() => "bot", api, 60_000);
    assert.equal((await cache.flags())[0].state, "off");
    fail = true;
    cache.refresh();
    assert.equal((await cache.flags())[0].state, "off", "no wait while the read is out");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal((await cache.flags())[0].state, "off", "a failed read keeps the last flags");
  });

test("feature flag cache: with no flags yet, a failed read backs off before the next",
  async (t) => {
    t.mock.method(console, "error", () => undefined);
    t.mock.timers.enable({ apis: ["Date"], now: 0 });
    let calls = 0;
    const api: IFeatureAccessApi = {
      async fetchFeatureAccess() {
        calls += 1;
        throw new Error("API down");
      },
    };
    const cache = createFeatureFlagCache(() => "bot", api, 60_000, 30_000);
    await assert.rejects(cache.flags(), /API down/);
    await assert.rejects(cache.flags(), /API down/);
    assert.equal(calls, 1, "the next interaction does not wait on another read");
    t.mock.timers.tick(30_001);
    await assert.rejects(cache.flags(), /API down/);
    assert.equal(calls, 2);
  });

test("feature flag cache: past the TTL the old flags answer at once while it refreshes",
  async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: 0 });
    let state: FeatureState = "live";
    const api = fakeApi(() => ({ journals: state }));
    const cache = createFeatureFlagCache(() => "bot", api, 60_000);
    await cache.flags();
    state = "off";
    t.mock.timers.tick(61_000);
    assert.equal((await cache.flags())[0].state, "live");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal((await cache.flags())[0].state, "off");
  });

test("feature flag cache: before the bot logs in there are no flags to read", async () => {
  const api = fakeApi();
  const cache = createFeatureFlagCache(() => null, api);
  await assert.rejects(cache.flags(), /before the bot logs in/);
  cache.refresh();
  assert.deepEqual(api.calls, []);
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

test("resolveFeatureGate: an unmapped command never asks the API", async () => {
  const api = fakeApi(() => ({ journals: "off" }));
  const decision = await resolveFeatureGate(
    { type: "command", name: "help" },
    "1",
    gateSource(api),
  );
  assert.equal(decision, "run");
  assert.deepEqual(api.calls, []);
});

test("resolveFeatureGate: Live and Off read only the club-wide flags, never the member",
  async () => {
    const target = { type: "command", name: "game-journal" } as const;
    const off = fakeApi(() => ({ journals: "off" }));
    assert.equal(await resolveFeatureGate(target, "member", gateSource(off)), "not_available");
    const live = fakeApi(() => ({ journals: "live" }));
    const source = gateSource(live);
    assert.equal(await resolveFeatureGate(target, "member", source), "run");
    assert.equal(await resolveFeatureGate(target, "other", source), "run");
    assert.deepEqual([...off.calls, ...live.calls], ["bot", "bot"]);
  });

test("resolveFeatureGate: Preview asks who is staff", async () => {
  const api = fakeApi(() => ({ journals: "preview" }), ["admin"]);
  const source = gateSource(api);
  const component = { type: "component", customId: "game-journal-hmenu-add:1:2" } as const;
  assert.equal(await resolveFeatureGate(component, "admin", source), "preview_note");
  assert.equal(await resolveFeatureGate(component, "member", source), "not_available");
  assert.deepEqual(api.calls, ["bot", "admin", "member"]);
});

test("resolveFeatureGate: a failed flag lookup lets the command run", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const failing: IFeatureGateSource = {
    flags: async () => {
      throw new Error("down");
    },
    isStaff: async () => false,
  };
  const target = { type: "command", name: "giveaway" } as const;
  assert.equal(await resolveFeatureGate(target, "1", failing), "run");
});

test("resolveFeatureGate: a lookup slower than the wait lets the command run", async (t) => {
  t.mock.method(console, "warn", () => undefined);
  const target = { type: "command", name: "giveaway" } as const;
  const hangingFlags: IFeatureGateSource = {
    flags: () => new Promise<readonly IFeatureFlag[]>(() => undefined),
    isStaff: async () => false,
  };
  assert.equal(await resolveFeatureGate(target, "1", hangingFlags, 5), "run");
});

test("resolveFeatureGate: a Preview staff lookup that never answers refuses", async (t) => {
  t.mock.method(console, "warn", () => undefined);
  const target = { type: "command", name: "giveaway" } as const;
  const hangingStaff: IFeatureGateSource = {
    flags: async () => [{ key: "giveaways", name: "Giveaways", state: "preview" }],
    isStaff: () => new Promise<boolean>(() => undefined),
  };
  assert.equal(
    await resolveFeatureGate(target, "1", hangingStaff, 5, 5),
    "not_available",
  );
});

test("resolveFeatureGate: a slow flag read leaves the staff lookup its own wait", async () => {
  const target = { type: "command", name: "giveaway" } as const;
  const later = <T>(value: T, ms: number): Promise<T> =>
    new Promise((resolve) => setTimeout(() => resolve(value), ms));
  const slowFlags: IFeatureGateSource = {
    flags: () => later([{ key: "giveaways", name: "Giveaways", state: "preview" }], 30),
    isStaff: () => later(true, 30),
  };
  assert.equal(await resolveFeatureGate(target, "1", slowFlags, 40, 40), "preview_note");
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

test("addPreviewNote: a V2 reply already at 40 components is left without the note", () => {
  const container = new ContainerBuilder();
  for (let i = 0; i < 39; i += 1) {
    const row = new TextDisplayBuilder().setContent(safeV2TextContent(`Row ${i}`, 10));
    container.addTextDisplayComponents(row);
  }
  const full = { components: [container], flags: MessageFlags.IsComponentsV2 };
  assert.deepEqual(componentsJson(addPreviewNote(full)), componentsJson(full));

  const room = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent("Row"),
  );
  const noted = addPreviewNote({ components: [room], flags: MessageFlags.IsComponentsV2 });
  assert.equal(componentsJson(noted).length, 2);
});

test("addPreviewNote: a V2 reply with no text room left is left without the note", () => {
  const text = new TextDisplayBuilder().setContent(safeV2TextContent("x".repeat(3990), 4000));
  const full = { components: [text], flags: MessageFlags.IsComponentsV2 };
  assert.equal(componentsJson(addPreviewNote(full)).length, 1);
});

test("addPreviewNote: a content reply at 2000 characters is left without the note", () => {
  const long = "x".repeat(1990);
  assert.equal(addPreviewNote(long), long);
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
