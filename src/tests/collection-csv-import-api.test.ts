import assert from "node:assert/strict";
import test from "node:test";
import axios, {
  AxiosError,
  type AxiosAdapter,
  type InternalAxiosRequestConfig,
} from "axios";

process.env.RPGCLUB_API_BASE_URL = "https://api.example.test";
process.env.RPGCLUB_BOT_API_TOKEN = "token";

type Recorded = { method: string; url: string; body: unknown; timeout: number | undefined };

const requests: Recorded[] = [];
let nextResponse: { status: number; data: unknown } = { status: 200, data: {} };

const adapter: AxiosAdapter = async (config) => {
  requests.push({
    method: String(config.method).toUpperCase(),
    url: String(config.url),
    body: typeof config.data === "string" ? JSON.parse(config.data) : config.data,
    timeout: config.timeout,
  });
  const response = {
    data: nextResponse.data,
    status: nextResponse.status,
    statusText: "",
    headers: {},
    config,
  };
  if (nextResponse.status >= 400) {
    throw new AxiosError("failed", "ERR_BAD_REQUEST", config, null, response);
  }
  return response;
};
axios.defaults.adapter = adapter;

const {
  advanceCollectionCsvImport,
  applyCollectionCsvImportItem,
  mapCsvImportReview,
  remapCollectionCsvImportItem,
  startCollectionCsvImport,
  summarizeCsvImportCounts,
} = await import("../classes/CollectionCsvImport.js");
const {
  buildCsvIgdbSelectOptions,
  buildCsvValidationLines,
  describeCsvImportError,
  getCsvImportErrorCode,
  readCsvValidationProblems,
} = await import("../commands/collection/collection-csv-import.service.js");

function apiError(status: number, body: unknown): AxiosError {
  const config = { headers: {} } as InternalAxiosRequestConfig;
  const response = { status, statusText: "", headers: {}, config, data: body };
  return new AxiosError("failed", "ERR_BAD_REQUEST", config, null, response);
}

const IMPORT_ROW = {
  import_id: 7,
  user_id: "42",
  status: "active",
  current_index: 3,
  total_count: 10,
  source_file_name: "games.csv",
  source_file_size: 120,
  template_version: null,
  test_mode: false,
  created_at: "2026-10-29T00:00:00Z",
  updated_at: "2026-10-29T00:00:00Z",
};

const ITEM_ROW = {
  item_id: 99,
  import_id: 7,
  row_index: 4,
  raw_title: "Portal 2",
  raw_platform: "Switch",
  raw_ownership_type: null,
  raw_note: null,
  raw_gamedb_id: null,
  raw_igdb_id: null,
  platform_id: 5,
  ownership_type: "Digital",
  note: null,
  status: "pending",
  gamedb_game_id: null,
  collection_entry_id: null,
  result_reason: null,
  error_text: null,
};

test("each review-time error code from the API maps to a reason for the member", () => {
  const cases: Array<[number, string]> = [
    [409, "import_not_active"],
    [409, "item_not_pending"],
    [404, "game_not_found"],
    [404, "igdb_game_not_found"],
    [422, "game_id_or_igdb_id_required"],
    [422, "invalid_igdb_id"],
    [422, "igdb_not_configured"],
    [502, "igdb_request_failed"],
    [422, "title_required"],
  ];
  for (const [status, code] of cases) {
    const reason = describeCsvImportError(apiError(status, { error: code }));
    assert.ok(reason, `${code} has a reason`);
    assert.equal(reason?.includes(code), false, `${code} is not shown raw`);
  }
});

test("unknown failures and inherited object keys have no member-facing reason", () => {
  assert.equal(describeCsvImportError(apiError(500, { error: "boom" })), null);
  assert.equal(describeCsvImportError(apiError(500, { error: "constructor" })), null);
  assert.equal(describeCsvImportError(new Error("network")), null);
  assert.equal(getCsvImportErrorCode(apiError(500, null)), null);
});

test("an invalid_csv response lists each problem by line and column", () => {
  const problems = readCsvValidationProblems(apiError(422, {
    error: "invalid_csv",
    errors: [
      { row_index: 1, column: "title", message: "Missing required column." },
      { row_index: 4, column: "platform", message: "Platform not recognized." },
    ],
  }));
  assert.deepEqual(problems, [
    { rowIndex: 1, column: "title", message: "Missing required column." },
    { rowIndex: 4, column: "platform", message: "Platform not recognized." },
  ]);
  assert.deepEqual(buildCsvValidationLines(problems ?? []), [
    "- Line 1, title: Missing required column.",
    "- Line 4, platform: Platform not recognized.",
  ]);
});

test("other failures are not read as validation problems", () => {
  assert.equal(readCsvValidationProblems(apiError(422, { error: "title_required" })), null);
  assert.equal(readCsvValidationProblems(new Error("network")), null);
  assert.deepEqual(readCsvValidationProblems(apiError(422, { error: "invalid_csv" })), []);
});

test("a long problem list is cut with a count of the rest", () => {
  const problems = Array.from({ length: 15 }, (_, index) => ({
    rowIndex: index + 2,
    column: "title",
    message: "Bad value.",
  }));
  const lines = buildCsvValidationLines(problems);
  assert.equal(lines.length, 13);
  assert.equal(lines.at(-1), "- ...and 3 more");
});

test("an advance payload maps to a review with upper-cased statuses", () => {
  const review = mapCsvImportReview({
    import: IMPORT_ROW,
    item: ITEM_ROW,
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
  assert.equal(review.item?.platformId, 5);
  assert.deepEqual(review.candidates, [{ gameId: 12, title: "Portal 2" }]);
  assert.equal(review.matchConfidence, "FUZZY");
  assert.deepEqual(review.counts.byResultReason, { AUTO_MATCH: 3 });
  assert.equal(summarizeCsvImportCounts(review.counts).pending, 6);
});

test("a null item stays null so the caller can advance again", () => {
  const review = mapCsvImportReview({
    import: { ...IMPORT_ROW, status: "completed" },
    item: null,
    candidates: [],
    match_confidence: null,
    counts: { import_id: 7, by_status: {}, by_result_reason: {} },
  });
  assert.equal(review.item, null);
  assert.equal(review.matchConfidence, null);
});

test("IGDB candidates become select options with a UTC year", () => {
  const options = buildCsvIgdbSelectOptions([
    {
      igdbId: 5,
      name: "Portal 2",
      summary: "A  puzzle\ngame",
      firstReleaseDate: new Date("2011-01-01T00:00:00Z"),
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
  assert.equal(options[0]?.label, "Portal 2 (2011)");
  assert.equal(options[0]?.description, "A puzzle game");
  assert.equal(options[1]?.label, "Portal (TBD)");
  assert.equal(options[1]?.description, "No summary");
});

test("starting an import sends the raw file and allows a long request", async () => {
  requests.length = 0;
  nextResponse = { status: 201, data: { data: IMPORT_ROW } };
  const session = await startCollectionCsvImport({
    userId: "42",
    csvText: "title\nPortal 2\n",
    sourceFileName: "games.csv",
    testMode: true,
  });
  assert.equal(session.importId, 7);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.method, "POST");
  assert.equal(requests[0]?.url, "/api/v1/users/42/collection_csv_imports");
  assert.deepEqual(requests[0]?.body, {
    data: { csv_text: "title\nPortal 2\n", source_file_name: "games.csv", test_mode: true },
  });
  assert.ok((requests[0]?.timeout ?? 0) > 20_000);
});

test("a rejected file surfaces the invalid_csv problems to the caller", async () => {
  nextResponse = {
    status: 422,
    data: {
      error: "invalid_csv",
      errors: [{ row_index: 3, column: "igdb_id", message: "Use one id column only." }],
    },
  };
  await assert.rejects(
    () => startCollectionCsvImport({ userId: "42", csvText: "x", sourceFileName: null }),
    (error: unknown) => {
      assert.equal(readCsvValidationProblems(error)?.[0]?.rowIndex, 3);
      return true;
    },
  );
});

test("advance, apply and remap call the item endpoints with the right bodies", async () => {
  requests.length = 0;
  const review = { import: IMPORT_ROW, item: ITEM_ROW, candidates: [], match_confidence: null,
    counts: { import_id: 7, by_status: {}, by_result_reason: {} } };

  nextResponse = { status: 200, data: { data: review } };
  await advanceCollectionCsvImport(7);
  nextResponse = { status: 200, data: { data: ITEM_ROW } };
  await applyCollectionCsvImportItem(99, { gameId: 12 });
  await applyCollectionCsvImportItem(99, { igdbId: 1942 });
  nextResponse = { status: 200, data: { data: review } };
  await remapCollectionCsvImportItem(99, "Portal Two");

  assert.deepEqual(
    requests.map((request) => [request.method, request.url, request.body]),
    [
      ["POST", "/api/v1/collection_csv_imports/7/advance", undefined],
      ["POST", "/api/v1/collection_csv_import_items/99/apply", { data: { game_id: 12 } }],
      ["POST", "/api/v1/collection_csv_import_items/99/apply", { data: { igdb_id: 1942 } }],
      ["POST", "/api/v1/collection_csv_import_items/99/remap", { data: { title: "Portal Two" } }],
    ],
  );
  assert.ok((requests[0]?.timeout ?? 0) > 20_000);
});

test("an invalid_csv with no per line problems still tells the member something", () => {
  const lines = buildCsvValidationLines([]);
  assert.equal(lines.length, 1);
  assert.match(lines[0] ?? "", /template/);
});
