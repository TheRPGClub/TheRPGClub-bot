import assert from "node:assert/strict";
import test from "node:test";
import axios, { AxiosError, type AxiosAdapter } from "axios";

process.env.RPGCLUB_API_BASE_URL = "https://api.example.test";
process.env.RPGCLUB_BOT_API_TOKEN = "token";

const requested: Array<Record<string, unknown>> = [];

function round(roundNumber: number): unknown {
  return {
    round_number: roundNumber,
    gotm: {
      month_year: "March 2024",
      voting_results_message_id: "555",
      games: [
        { game_index: 1, gamedb_game_id: 8, thread_id: null, game: { title: "Beta" } },
        { game_index: 0, gamedb_game_id: 7, thread_id: "99", game: { title: "Alpha" } },
        { game_index: 2, gamedb_game_id: null, game: null },
      ],
    },
    nr_gotm: null,
  };
}

const adapter: AxiosAdapter = async (config) => {
  const params = (config.params ?? {}) as Record<string, unknown>;
  requested.push(params);
  if (params.kind === "missing_page" && Number(params.page) > 1) {
    const response = { data: {}, status: 404, statusText: "Not Found", headers: {}, config };
    throw new AxiosError("not found", "ERR_BAD_REQUEST", config, null, response);
  }
  const body = config.url?.endsWith("/current")
    ? { data: round(120) }
    : { data: [round(Number(params.page) * 10)], meta: { pages: 2, years: [2024] } };
  return { data: body, status: 200, statusText: "OK", headers: {}, config };
};
axios.defaults.adapter = adapter;

const { fetchCurrentGotmRound, fetchGotmRoundHistory } = await import(
  "../classes/GotmRounds.js",
);

test("fetchGotmRoundHistory reads every page and maps games in index order", async () => {
  requested.length = 0;
  const rounds = await fetchGotmRoundHistory({
    kind: "both",
    year: 2024,
    query: " alpha ",
    sort: "desc",
  });

  assert.deepEqual(rounds.map((r) => r.round), [10, 20]);
  assert.deepEqual(requested.map((p) => p.page), [1, 2]);
  assert.equal(requested[0]?.q, "alpha");
  const entry = rounds[0]?.gotmEntries[0];
  assert.equal(entry?.votingResultsMessageId, "555");
  assert.deepEqual(entry?.gameOfTheMonth.map((g) => [g.title, g.threadId]), [
    ["Alpha", "99"],
    ["Beta", null],
  ]);
  assert.deepEqual(rounds[0]?.nrGotmEntries, []);
});

test("fetchGotmRoundHistory sends the API kind and omits a blank query", async () => {
  requested.length = 0;
  await fetchGotmRoundHistory({ kind: "nr_gotm", year: 2024, query: "  ", sort: "asc" });

  assert.equal(requested[0]?.kind, "nr_gotm");
  assert.equal(requested[0]?.sort, "asc");
  assert.equal("q" in (requested[0] ?? {}), false);
});

test("fetchGotmRoundHistory throws when a later page is missing", async () => {
  await assert.rejects(
    fetchGotmRoundHistory({
      kind: "missing_page" as never,
      year: 2024,
      query: "",
      sort: "desc",
    }),
  );
});

test("fetchCurrentGotmRound maps the current round", async () => {
  const current = await fetchCurrentGotmRound();

  assert.equal(current?.round, 120);
  assert.equal(current?.gotmEntries[0]?.monthYear, "March 2024");
});
