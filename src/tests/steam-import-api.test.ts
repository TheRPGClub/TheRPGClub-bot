import assert from "node:assert/strict";
import test from "node:test";
import { AxiosError, type InternalAxiosRequestConfig } from "axios";
import {
  mapSteamImportReview,
  summarizeSteamImportCounts,
} from "../classes/SteamCollectionImport.js";
import {
  buildSteamHeaderImageUrl,
  buildSteamIgdbSelectOptions,
  describeSteamImportError,
  getSteamImportErrorCode,
} from "../commands/collection/collection-steam-import.service.js";

function apiError(status: number, body: unknown): AxiosError {
  const config = { headers: {} } as InternalAxiosRequestConfig;
  const response = { status, statusText: "", headers: {}, config, data: body };
  return new AxiosError("failed", "ERR_BAD_REQUEST", config, null, response);
}

test("each Steam error code from the API maps to a reason for the member", () => {
  const cases: Array<[number, string]> = [
    [422, "invalid_identifier"],
    [422, "private_profile"],
    [502, "api_unavailable"],
    [502, "api_unauthorized"],
    [503, "api_rate_limited"],
    [503, "steam_not_configured"],
    [409, "import_not_active"],
    [409, "item_not_pending"],
    [404, "game_not_found"],
    [404, "igdb_game_not_found"],
    [422, "invalid_igdb_id"],
    [422, "igdb_not_configured"],
    [502, "igdb_request_failed"],
    [422, "title_required"],
  ];
  for (const [status, code] of cases) {
    const reason = describeSteamImportError(apiError(status, { error: code }));
    assert.ok(reason, `${code} has a reason`);
    assert.notEqual(reason?.includes(code), true, `${code} is not shown raw`);
  }
});

test("a 422 with no Steam code is the one-open-import rule", () => {
  const reason = describeSteamImportError(apiError(422, { error: "validation_failed" }));
  assert.match(reason ?? "", /already have an open Steam import/);
});

test("unknown failures have no member-facing reason", () => {
  assert.equal(describeSteamImportError(apiError(500, { error: "boom" })), null);
  assert.equal(describeSteamImportError(new Error("network")), null);
  assert.equal(getSteamImportErrorCode(apiError(500, null)), null);
});

test("an advance payload maps to a review with upper-cased statuses", () => {
  const review = mapSteamImportReview({
    import: {
      import_id: 7,
      user_id: "42",
      status: "active",
      current_index: 3,
      total_count: 10,
      steam_id64: "76561198000000000",
      steam_profile_ref: null,
      source_profile_name: "Example",
      test_mode: false,
      created_at: "2026-10-29T00:00:00Z",
      updated_at: "2026-10-29T00:00:00Z",
    },
    item: {
      item_id: 99,
      import_id: 7,
      row_index: 4,
      steam_app_id: 620,
      steam_app_name: "Portal 2",
      status: "pending",
      gamedb_game_id: null,
      collection_entry_id: null,
      result_reason: null,
      error_text: null,
    },
    candidates: [{ game_id: 12, title: "Portal 2" }],
    match_confidence: "fuzzy",
    counts: {
      import_id: 7,
      by_status: { pending: 6, added: 3 },
      by_result_reason: { auto_match: 3 },
    },
  });
  assert.equal(review.import.status, "ACTIVE");
  assert.equal(review.item?.status, "PENDING");
  assert.deepEqual(review.candidates, [{ gameId: 12, title: "Portal 2" }]);
  assert.equal(review.matchConfidence, "FUZZY");
  assert.deepEqual(review.counts.byResultReason, { AUTO_MATCH: 3 });
  assert.equal(summarizeSteamImportCounts(review.counts).pending, 6);
});

test("a null item stays null so the caller can advance again", () => {
  const review = mapSteamImportReview({
    import: {
      import_id: 7,
      user_id: "42",
      status: "completed",
      current_index: 10,
      total_count: 10,
      steam_id64: "1",
      steam_profile_ref: null,
      source_profile_name: null,
      test_mode: false,
      created_at: "2026-10-29T00:00:00Z",
      updated_at: "2026-10-29T00:00:00Z",
    },
    item: null,
    candidates: [],
    match_confidence: null,
    counts: { import_id: 7, by_status: {}, by_result_reason: {} },
  });
  assert.equal(review.item, null);
  assert.equal(review.matchConfidence, null);
});

test("IGDB candidates become select options with a year", () => {
  const options = buildSteamIgdbSelectOptions([
    {
      igdbId: 5,
      name: "Portal 2",
      summary: "A  puzzle\ngame",
      firstReleaseDate: new Date("2011-04-19T00:00:00Z"),
      alreadyImported: false,
    },
    {
      igdbId: 6,
      name: "Portal",
      summary: null,
      firstReleaseDate: null,
      alreadyImported: true,
    },
  ]);
  assert.equal(options[0].id, 5);
  assert.equal(options[0].label, "Portal 2 (2011)");
  assert.equal(options[0].description, "A puzzle game");
  assert.equal(options[1].label, "Portal (TBD)");
  assert.equal(options[1].description, "No summary");
});

test("the Steam header image comes from the public app CDN", () => {
  assert.equal(
    buildSteamHeaderImageUrl(620),
    "https://cdn.cloudflare.steamstatic.com/steam/apps/620/header.jpg",
  );
});
