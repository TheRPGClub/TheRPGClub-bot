import assert from "node:assert/strict";
import test from "node:test";
import { AxiosError, AxiosHeaders, type AxiosResponse } from "axios";

import { featureKeyFor } from "../functions/FeatureGate.js";
import {
  FEATURE_FLAG_STAFF_ONLY_MESSAGE,
  featureFlagChoices,
  listFeatureFlagsReply,
  setFeatureFlagReply,
  type IFeatureFlagApi,
  type IFeatureFlagEntry,
  type IFeatureFlagUpdate,
} from "../services/FeatureFlagService.js";

function apiError(status: number, body: unknown, method = "patch"): AxiosError {
  const config = {
    method,
    url: "/api/v1/features/reviews",
    headers: new AxiosHeaders(),
    data: JSON.stringify({ data: { state: "off", acting_user_id: "42" } }),
  };
  const response = {
    status,
    statusText: "",
    data: body,
    headers: {},
    config,
  } as AxiosResponse;
  return new AxiosError("Request failed", "ERR_BAD_REQUEST", config, null, response);
}

function entry(overrides: Partial<IFeatureFlagEntry> = {}): IFeatureFlagEntry {
  return {
    key: "reviews",
    name: "Reviews",
    state: "preview",
    core: false,
    hideable: true,
    lastChange: null,
    ...overrides,
  };
}

interface IFakeFlagApi extends IFeatureFlagApi {
  sets: { key: string; update: IFeatureFlagUpdate }[];
  listedFor: string[];
}

function fakeApi(options: {
  set?: { entry: IFeatureFlagEntry; changed: boolean };
  setError?: unknown;
  list?: IFeatureFlagEntry[];
  listError?: unknown;
} = {}): IFakeFlagApi {
  const api: IFakeFlagApi = {
    sets: [],
    listedFor: [],
    listFeatureFlags: async (actingUserId) => {
      api.listedFor.push(actingUserId);
      if (options.listError) throw options.listError;
      return options.list ?? [];
    },
    setFeatureFlag: async (key, update) => {
      api.sets.push({ key, update });
      if (options.setError) throw options.setError;
      return options.set ?? { entry: entry(), changed: false };
    },
  };
  return api;
}

function cacheSpy(): { refresh: () => void; refreshes: number } {
  const spy = {
    refreshes: 0,
    refresh: () => {
      spy.refreshes += 1;
    },
  };
  return spy;
}

const previewChange = {
  fromState: "live" as const,
  toState: "preview" as const,
  changedBy: "42",
  changedByName: "Ada",
  reason: "Testing",
  changedAt: "2026-11-10T15:00:00Z",
};

test("setFeatureFlagReply: names the acting user and refreshes the flag cache", async () => {
  const api = fakeApi({ set: { entry: entry({ lastChange: previewChange }), changed: true } });
  const cache = cacheSpy();
  const text = await setFeatureFlagReply(
    { actingUserId: "42", key: "reviews", state: "preview", reason: "Testing" },
    { api, refreshFlagCache: cache.refresh },
  );
  assert.deepEqual(api.sets, [{
    key: "reviews",
    update: { state: "preview", reason: "Testing", actingUserId: "42" },
  }]);
  assert.equal(cache.refreshes, 1);
  assert.equal(
    text,
    "Reviews (`reviews`) is now **Preview** (was Live). " +
      "The change is announced in the admin channel.",
  );
});

test("setFeatureFlagReply: the state it already has says so and changes nothing", async () => {
  const api = fakeApi({ set: { entry: entry(), changed: false } });
  const cache = cacheSpy();
  const text = await setFeatureFlagReply(
    { actingUserId: "42", key: "reviews", state: "preview", reason: null },
    { api, refreshFlagCache: cache.refresh },
  );
  assert.equal(text, "Reviews (`reviews`) is already **Preview**. Nothing changed.");
});

/** The friendly line, then the full request and response as JSON blocks (CLAUDE.md). */
function assertRefusal(text: string, friendly: string, status: number): void {
  assert.ok(text.startsWith(friendly), text);
  assert.match(text, /Request:\n```json/);
  assert.match(text, /"url": "\/api\/v1\/features\/reviews"/);
  assert.match(text, /"acting_user_id"/);
  assert.match(text, new RegExp(`Response:\\n\`\`\`json[\\s\\S]*"status": ${status}`));
}

test("setFeatureFlagReply: a non-staff user gets the polite refusal with the full exchange",
  async () => {
    const api = fakeApi({ setError: apiError(403, { error: "forbidden" }) });
    const cache = cacheSpy();
    const text = await setFeatureFlagReply(
      { actingUserId: "7", key: "reviews", state: "off", reason: null },
      { api, refreshFlagCache: cache.refresh },
    );
    assertRefusal(text, FEATURE_FLAG_STAFF_ONLY_MESSAGE, 403);
    assert.match(text, /"error": "forbidden"/);
    assert.equal(cache.refreshes, 0);
  });

test("setFeatureFlagReply: an unknown Feature key is named back with the full exchange",
  async () => {
    const api = fakeApi({ setError: apiError(404, { error: "not_found" }) });
    const cache = cacheSpy();
    const text = await setFeatureFlagReply(
      { actingUserId: "42", key: "nope", state: "off", reason: null },
      { api, refreshFlagCache: cache.refresh },
    );
    assertRefusal(text, "There is no Feature `nope`. Pick one from the list.", 404);
    assert.equal(cache.refreshes, 0);
  });

test("setFeatureFlagReply: other API errors are thrown for the full error reply", async () => {
  const error = apiError(422, { error: "reason is too long" });
  const api = fakeApi({ setError: error });
  const cache = cacheSpy();
  await assert.rejects(
    setFeatureFlagReply(
      { actingUserId: "42", key: "reviews", state: "off", reason: "x" },
      { api, refreshFlagCache: cache.refresh },
    ),
    (err: unknown) => err === error,
  );
  assert.equal(cache.refreshes, 0);
});

test("listFeatureFlagsReply: every Feature with its state, Core first", async () => {
  const api = fakeApi({
    list: [
      entry({ key: "game_index", name: "Game Index", state: "live", core: true, hideable: false,
        lastChange: { ...previewChange, fromState: "preview", toState: "live",
          changedBy: "system", changedByName: null, reason: null } }),
      entry({ key: "reviews", name: "Reviews", state: "preview", lastChange: previewChange }),
      entry({ key: "journals", name: "Journals", state: "off" }),
    ],
  });
  const text = await listFeatureFlagsReply("42", { api });
  assert.deepEqual(api.listedFor, ["42"]);
  assert.equal(text, [
    "**Feature Flags**",
    "",
    "**Core Features**",
    "- Game Index (`game_index`): **Live**",
    "",
    "**Hideable Features**",
    "- Reviews (`reviews`): **Preview**, set <t:1794322800:R> by <@42> (Ada): Testing",
    "- Journals (`journals`): **Off**",
  ].join("\n"));
});

test("listFeatureFlagsReply: a non-staff user gets the polite refusal with the full exchange",
  async () => {
    const api = fakeApi({ listError: apiError(403, { error: "forbidden" }, "get") });
    const text = await listFeatureFlagsReply("7", { api });
    assertRefusal(text, FEATURE_FLAG_STAFF_ONLY_MESSAGE, 403);
    assert.match(text, /"method": "GET"/);
  });

test("listFeatureFlagsReply: other API errors are thrown for the full error reply", async () => {
  const error = apiError(500, { error: "boom" }, "get");
  const api = fakeApi({ listError: error });
  await assert.rejects(listFeatureFlagsReply("42", { api }), (err: unknown) => err === error);
});

const REGISTRY = [
  { key: "game_index", name: "Game Index", state: "live" as const },
  { key: "voting_gotm", name: "Voting & GOTM", state: "live" as const },
  { key: "reviews", name: "Reviews", state: "preview" as const },
  { key: "journals", name: "Journals", state: "off" as const },
];

test("featureFlagChoices: offers every registry Feature with its state, key as value", () => {
  assert.deepEqual(featureFlagChoices("", REGISTRY), [
    { name: "Game Index (Live)", value: "game_index" },
    { name: "Voting & GOTM (Live)", value: "voting_gotm" },
    { name: "Reviews (Preview)", value: "reviews" },
    { name: "Journals (Off)", value: "journals" },
  ]);
});

test("featureFlagChoices: matches the typed text against name or key", () => {
  assert.deepEqual(featureFlagChoices("gotm", REGISTRY), [
    { name: "Voting & GOTM (Live)", value: "voting_gotm" },
  ]);
  assert.deepEqual(featureFlagChoices("JOUR", REGISTRY), [
    { name: "Journals (Off)", value: "journals" },
  ]);
  assert.deepEqual(featureFlagChoices("game_i", REGISTRY), [
    { name: "Game Index (Live)", value: "game_index" },
  ]);
});

test("/flag is never feature-gated", () => {
  assert.equal(featureKeyFor({ type: "command", name: "flag" }), null);
});
