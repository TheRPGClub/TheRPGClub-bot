import assert from "node:assert/strict";
import test from "node:test";
import GameSearchService, { type IGameSearchDeps } from "../classes/GameSearchService.js";

type ApiCall = { path: string; params: Record<string, unknown> };

function release(platform: string, region: string, extra: Record<string, unknown> = {}) {
  return {
    release_id: 1,
    platform_id: 1,
    platform_name: platform,
    platform_abbreviation: platform,
    region_id: 1,
    region_code: region,
    region_name: region === "WW" ? "Worldwide" : region,
    format: null,
    source: "igdb",
    ...extra,
  };
}

function entry(
  gameId: number,
  title: string,
  date: string | null,
  precision: string,
  releases = [release("PS5", "WW")],
  firstReleasedOn: string | null = null,
) {
  return {
    game: { game_id: gameId, title, cover_url: null },
    date,
    date_precision: precision,
    section: "",
    first_released_on: firstReleasedOn,
    first_released_precision: firstReleasedOn ? "day" : null,
    releases,
  };
}

function apiGame(id: number, title: string, initialReleaseDate: string | null = null) {
  return { game_id: id, title, initial_release_date: initialReleaseDate };
}

interface IFakeApi {
  calls: ApiCall[];
  relationCalls: number[];
  deps: IGameSearchDeps;
}

/**
 * A fake API client: `upcoming` pages are served in order, `/games` answers by `q`
 * (or for every query when keyed "*"), and `companies` holds each game's relations.
 */
function fakeApi(options: {
  upcoming?: unknown[][];
  games?: Record<string, unknown[]>;
  companies?: Record<number, Array<{ company_id: number; role: string }>>;
  allGames?: Array<{ id: number; title: string; initialReleaseDate: Date | null }>;
} = {}): IFakeApi {
  const calls: ApiCall[] = [];
  const relationCalls: number[] = [];
  const upcomingPages = options.upcoming ?? [[]];
  const respond = (path: string, config?: { params?: Record<string, unknown> }) => {
    const params = config?.params ?? {};
    calls.push({ path, params });
    if (path === "/api/v1/upcoming_releases") {
      const page = Number(params.page ?? 1);
      const next = page < upcomingPages.length ? page + 1 : null;
      return {
        data: upcomingPages[page - 1] ?? [],
        meta: { page, pages: upcomingPages.length, next },
      };
    }
    if (path === "/api/v1/games") {
      const key = String(params.q ?? "*");
      return { data: options.games?.[key] ?? options.games?.["*"] ?? [], meta: { next: null } };
    }
    throw new Error(`unexpected GET ${path}`);
  };
  return {
    calls,
    relationCalls,
    deps: {
      get: async <T>(path: string, config?: any) => respond(path, config) as T,
      getOrThrow: async <T>(path: string, config?: any) => respond(path, config) as T,
      synonymsFor: async () => [],
      accentedSpellings: async () => [],
      relationsFor: async (gameId: number) => {
        relationCalls.push(gameId);
        return { companies: options.companies?.[gameId] ?? [] } as any;
      },
      listGames: async () => options.allGames ?? [],
    },
  };
}

function upcomingCalls(api: IFakeApi): ApiCall[] {
  return api.calls.filter((call) => call.path === "/api/v1/upcoming_releases");
}

test("upcoming only asks the Release Calendar for each game's next entry", async () => {
  const api = fakeApi({
    upcoming: [[
      entry(1, "Chrono Cross 2", "2027-03-14", "day"),
      entry(2, "Mana Quest", "2027-07-01", "quarter"),
    ]],
  });

  const rows = await GameSearchService.searchUpcomingReleases(
    "", { upcomingRelease: true }, api.deps,
  );

  assert.deepEqual(rows.map((row) => row.id), [1, 2]);
  assert.equal(api.calls.length, 1, "no /games download");
  assert.equal(api.relationCalls.length, 0, "no relations call per game");
  assert.equal(upcomingCalls(api)[0].params.per_game, "next");
  assert.equal(rows[1].datePrecision, "quarter");
  assert.equal(rows[1].date?.toISOString(), "2027-07-01T00:00:00.000Z");
});

test("a title narrows the Release Calendar to the matching games' ids", async () => {
  const api = fakeApi({
    games: { chrono: [apiGame(1, "Chrono Cross 2", "2027-03-14"), apiGame(7, "Chrono Trigger")] },
    upcoming: [[entry(1, "Chrono Cross 2", "2027-03-14", "day")]],
  });

  const rows = await GameSearchService.searchUpcomingReleases(
    "chrono", { upcomingRelease: true, platformId: 3 }, api.deps,
  );

  const [call] = upcomingCalls(api);
  assert.equal(call.params.game_id, "1,7", "ids comma-separated, never repeated plainly");
  assert.equal(call.params.platform_id, "3");
  assert.deepEqual(rows.map((row) => row.title), ["Chrono Cross 2"]);
});

test("a title with no GameDB match never asks the Release Calendar", async () => {
  const api = fakeApi({ games: { "*": [] } });

  const rows = await GameSearchService.searchUpcomingReleases(
    "nothing", { upcomingRelease: true }, api.deps,
  );

  assert.deepEqual(rows, []);
  assert.equal(upcomingCalls(api).length, 0);
});

test("too many resolved games are matched locally instead of sent as ids", async () => {
  const many = Array.from({ length: 600 }, (_, i) =>
    ({ id: i + 1, title: `Game ${i + 1}`, initialReleaseDate: new Date("2027-01-01") }));
  const api = fakeApi({
    allGames: many,
    upcoming: [[
      entry(5, "Game 5", "2027-02-01", "month"),
      entry(9000, "Elsewhere", "2027-03-01", "month"),
    ]],
  });

  const rows = await GameSearchService.searchUpcomingReleases(
    "", { upcomingRelease: true, year: 2027 }, api.deps,
  );

  assert.equal(upcomingCalls(api)[0].params.game_id, undefined);
  assert.deepEqual(rows.map((row) => row.id), [5]);
});

test("developer and publisher narrow the results, checking only upcoming games", async () => {
  const api = fakeApi({
    games: { "*": [apiGame(1, "Ours"), apiGame(2, "Theirs"), apiGame(3, "Released")] },
    upcoming: [[
      entry(1, "Ours", "2027-05-01", "month"),
      entry(2, "Theirs", "2027-06-01", "month"),
    ]],
    companies: {
      1: [{ company_id: 10, role: "Developer" }, { company_id: 20, role: "Publisher" }],
      2: [{ company_id: 20, role: "Developer" }, { company_id: 10, role: "Publisher" }],
    },
  });

  const rows = await GameSearchService.searchUpcomingReleases(
    "", { upcomingRelease: true, developerId: 10, publisherId: 20 }, api.deps,
  );

  const gamesCall = api.calls.find((call) => call.path === "/api/v1/games");
  assert.deepEqual(gamesCall?.params.company_id, [10, 20]);
  assert.equal(upcomingCalls(api)[0].params.game_id, "1,2,3");
  assert.deepEqual(rows.map((row) => row.id), [1]);
  assert.deepEqual(api.relationCalls.sort(), [1, 2], "the released game is never checked");
});

test("year keeps only games first released that year", async () => {
  const api = fakeApi({
    games: {
      mana: [apiGame(1, "Mana 2026", "2026-05-01T00:00:00Z"), apiGame(2, "Mana 2027", null)],
    },
    upcoming: [[entry(1, "Mana 2026", "2027-01-01", "year")]],
  });

  await GameSearchService.searchUpcomingReleases(
    "mana", { upcomingRelease: true, year: 2026 }, api.deps,
  );

  assert.equal(upcomingCalls(api)[0].params.game_id, "1");
});

test("every Release Calendar page is read, in calendar order", async () => {
  const api = fakeApi({
    upcoming: [
      [entry(1, "First", "2027-01-05", "day")],
      [entry(2, "Second", null, "tba")],
    ],
  });

  const rows = await GameSearchService.searchUpcomingReleases(
    "", { upcomingRelease: true }, api.deps,
  );

  assert.deepEqual(upcomingCalls(api).map((call) => call.params.page), [1, 2]);
  assert.deepEqual(rows.map((row) => row.id), [1, 2]);
  assert.equal(rows[1].date, null);
  assert.equal(rows[1].datePrecision, "tba");
});

test("a row keeps its Releases' platforms and regions", async () => {
  const api = fakeApi({
    upcoming: [[entry(1, "Ports", "2027-03-01", "day", [
      release("PS5", "NA"),
      release("PS5", "JP"),
      release("Switch", "WW"),
    ], "2025-10-10")]],
  });

  const [row] = await GameSearchService.searchUpcomingReleases(
    "", { upcomingRelease: true }, api.deps,
  );

  assert.deepEqual(
    row.releases.map((r) => `${r.platformAbbreviation}/${r.regionCode}`),
    ["PS5/NA", "PS5/JP", "Switch/WW"],
  );
  assert.equal(row.initialReleaseDate?.toISOString(), "2025-10-10T00:00:00.000Z");
});

test("a row's year label reads the game's own first release, as a plain search does", async () => {
  const api = fakeApi({
    games: { mana: [apiGame(1, "Mana Quest", "2025-06-01")] },
    upcoming: [[entry(1, "Mana Quest", "2027-07-01", "quarter", undefined, "2026-02-02")]],
  });

  const [row] = await GameSearchService.searchUpcomingReleases(
    "mana", { upcomingRelease: true }, api.deps,
  );

  assert.equal(row.initialReleaseDate?.toISOString(), "2025-06-01T00:00:00.000Z");
});

test("with no title or company, the year label still reads the game's first release", async () => {
  const api = fakeApi({
    allGames: [
      { id: 1, title: "Mana Quest", initialReleaseDate: new Date("2025-06-01") },
      { id: 2, title: "Undated", initialReleaseDate: null },
    ],
    upcoming: [[
      entry(1, "Mana Quest", "2027-07-01", "quarter", undefined, "2026-02-02"),
      entry(2, "Undated", "2027-08-01", "month", undefined, "2026-03-03"),
      entry(3, "Not Cached", "2027-09-01", "month"),
    ]],
  });

  const rows = await GameSearchService.searchUpcomingReleases(
    "", { upcomingRelease: true }, api.deps,
  );

  assert.deepEqual(
    rows.map((row) => row.initialReleaseDate?.toISOString()),
    ["2025-06-01T00:00:00.000Z", "2026-03-03T00:00:00.000Z", "2027-09-01T00:00:00.000Z"],
  );
});

test("a platform with no title goes to the Release Calendar without game ids", async () => {
  const api = fakeApi({ upcoming: [[entry(1, "Chrono Cross 2", "2027-03-14", "day")]] });

  await GameSearchService.searchUpcomingReleases(
    "", { upcomingRelease: true, platformId: 3 }, api.deps,
  );

  assert.deepEqual(upcomingCalls(api).map((call) => call.params), [
    { per_game: "next", per: 100, platform_id: "3", page: 1 },
  ]);
});
