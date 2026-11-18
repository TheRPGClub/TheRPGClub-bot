import assert from "node:assert/strict";
import test from "node:test";
import GameSearchService, { type IGameSearchDeps } from "../classes/GameSearchService.js";
import { GameDbSearchCommand } from "../commands/gamedb/gamedb-search.command.js";
import { encodeBase64Url } from "../functions/CustomIdUtils.js";

const OWNER = "333333333333333333";

function release(platform: string, region: string) {
  return {
    release_id: 1,
    platform_id: 1,
    platform_name: `${platform} full name`,
    platform_abbreviation: platform,
    region_id: 1,
    region_code: region,
    region_name: region === "WW" ? "Worldwide" : region,
    format: null,
    source: "igdb",
  };
}

function entry(
  gameId: number,
  title: string,
  date: string | null,
  precision: string,
  releases = [release("PS5", "WW")],
) {
  return {
    game: { game_id: gameId, title, cover_url: null },
    date,
    date_precision: precision,
    section: "",
    first_released_on: null,
    first_released_precision: null,
    releases,
  };
}

/** A fake API client that only serves the Release Calendar. */
function fakeApi(upcoming: unknown[]): IGameSearchDeps {
  const respond = (path: string) => {
    if (path !== "/api/v1/upcoming_releases") throw new Error(`unexpected GET ${path}`);
    return { data: upcoming, meta: { page: 1, pages: 1, next: null } };
  };
  return {
    get: async <T>(path: string) => respond(path) as T,
    getOrThrow: async <T>(path: string) => respond(path) as T,
    synonymsFor: async () => [],
    accentedSpellings: async () => [],
    relationsFor: async () => null,
    listGames: async () => [],
  };
}

function fakePageClick(customId: string): any {
  const calls: Array<{ method: string; opts?: any }> = [];
  const interaction: any = {
    customId,
    channelId: "999999999999999999",
    user: { id: OWNER },
    replied: false,
    deferred: false,
    calls,
    deferUpdate: async () => {
      calls.push({ method: "deferUpdate" });
      interaction.deferred = true;
    },
    reply: async (opts: any) => {
      calls.push({ method: "reply", opts });
      interaction.replied = true;
    },
    editReply: async (opts: any) => {
      calls.push({ method: "editReply", opts });
    },
    followUp: async (opts: any) => {
      calls.push({ method: "followUp", opts });
    },
    isMessageComponent: () => true,
    isModalSubmit: () => false,
    isRepliable: () => true,
  };
  return interaction;
}

function renderedJson(opts: any): any[] {
  return (opts.components ?? []).map((c: any) => (c.toJSON ? c.toJSON() : c));
}

function listText(opts: any): string {
  return JSON.stringify(renderedJson(opts)[0]);
}

function selectOptions(opts: any): Array<{ label: string; description?: string }> {
  const select = renderedJson(opts).find((row: any) =>
    row.components?.some?.((c: any) => c.options));
  return select.components[0].options;
}

const upcomingEntries = [
  ...Array.from({ length: 10 }, (_, i) =>
    entry(i + 1, `Filler ${i + 1}`, "2027-01-15", "day")),
  entry(11, "Mana Quest", "2027-07-01", "quarter", [
    release("PS5", "NA"),
    release("PS5", "JP"),
    release("Switch", "WW"),
  ]),
  entry(12, "Someday", null, "tba"),
];

test("the next page of upcoming results shows vague dates and regions", async (t) => {
  const api = fakeApi(upcomingEntries);
  const realSearch = GameSearchService.searchUpcomingReleases.bind(GameSearchService);
  // The command cannot take deps, so its search is pointed at the fake API client.
  const search = t.mock.method(
    GameSearchService,
    "searchUpcomingReleases",
    (query: string, filters: any) => realSearch(query, filters, api),
  );
  const interaction = fakePageClick(
    `gamedb-search-page:${OWNER}:0:${encodeBase64Url("")}:u:next`,
  );

  await new GameDbSearchCommand().handleSearchPage(interaction);

  assert.equal(search.mock.callCount(), 1, "the upcoming filter survives the custom id");
  const edit = interaction.calls.find((c: any) => c.method === "editReply");
  assert.ok(edit, "the results message is edited");
  const text = listText(edit.opts);
  assert.match(text, /Page 2\/2/);
  assert.match(text, /`Q3 2027` \*\*Mana Quest \(2027\)\*\* - PS5 \(NA, JP\), Switch/);
  assert.match(text, /`TBA` \*\*Someday \(Unknown Year\)\*\* - PS5/);
  assert.doesNotMatch(text, /07\/01\/2027/, "a quarter is never shown as a day");

  const options = selectOptions(edit.opts);
  assert.deepEqual(options.map((o) => o.description), [
    "Q3 2027 - PS5 (NA, JP), Switch",
    "TBA - PS5",
  ]);
});

test("an upcoming search that the API rejects reports the request and response", async (t) => {
  const error: any = new Error("Request failed with status code 500");
  error.isAxiosError = true;
  error.config = { method: "get", url: "/api/v1/upcoming_releases", params: { page: 1 } };
  error.response = { status: 500, data: { error: "boom" } };
  t.mock.method(GameSearchService, "searchUpcomingReleases", async () => {
    throw error;
  });
  const interaction = fakePageClick(
    `gamedb-search-page:${OWNER}:0:${encodeBase64Url("")}:u:next`,
  );

  await new GameDbSearchCommand().handleSearchPage(interaction);

  const sent = interaction.calls.filter((c: any) => c.method !== "deferUpdate");
  const text = JSON.stringify(sent.map((c: any) => renderedJson(c.opts)));
  assert.match(text, /upcoming_releases/);
  assert.match(text, /boom/);
});
