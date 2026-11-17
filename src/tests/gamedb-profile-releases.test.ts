import assert from "node:assert/strict";
import test from "node:test";
import GameProfileService from "../classes/GameProfileService.js";
import { buildGameProfile, isGameReleased } from "../commands/gamedb/gamedb-profile.service.js";
import {
  mapGameProfileFromApi,
  type GameProfileApiData,
  type RelationReleaseApiData,
} from "../functions/GameProfileMapper.js";

const GAME_ID = 77;

function apiRelease(
  id: number,
  platformName: string,
  regionName: string,
  releaseDate: string | null,
  datePrecision: string,
): RelationReleaseApiData {
  return {
    release_id: id,
    game_id: GAME_ID,
    platform_id: id,
    region_id: id,
    format: null,
    release_date: releaseDate,
    date_precision: datePrecision,
    notes: null,
    platform_name: platformName,
    region_name: regionName,
    platform_code: null,
    region_code: null,
  };
}

function apiProfile(
  releases: RelationReleaseApiData[],
  initialReleaseDate: string | null = null,
): GameProfileApiData {
  return {
    game: {
      game_id: GAME_ID,
      title: "Chrono Cross",
      description: "A game.",
      initial_release_date: initialReleaseDate,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    relations: {
      releases,
      platforms: [],
      collection: null,
      companies: [],
      franchises: [],
      genres: [],
      engines: [],
      modes: [],
      perspectives: [],
      themes: [],
      alternates: [],
    },
    now_playing: [],
    completions: [],
    threads: [],
    primary_image: null,
    associations: {
      gotm_wins: [],
      nr_gotm_wins: [],
      gotm_nominations: [],
      nr_gotm_nominations: [],
    },
    collection_owners: [],
    hltb: null,
  };
}

function collectText(node: unknown, out: string[]): string[] {
  if (Array.isArray(node)) {
    node.forEach((child) => collectText(child, out));
  } else if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (typeof record.content === "string") out.push(record.content);
    Object.values(record).forEach((child) => collectText(child, out));
  }
  return out;
}

async function renderReleaseRows(t: any, releases: RelationReleaseApiData[]): Promise<string[]> {
  t.mock.method(GameProfileService, "getGameProfile", async (gameId: number) =>
    mapGameProfileFromApi(apiProfile(releases), gameId),
  );
  const profile = await buildGameProfile(GAME_ID, { includeInlineButtons: false });
  assert.ok(profile, "the profile renders");
  const text = collectText(profile.components.map((c) => c.toJSON()), []).join("\n");
  const releasesBlock = text.split("**Releases**")[1];
  assert.ok(releasesBlock, "the profile has a Releases table");
  return releasesBlock
    .split("\n")
    .filter((line) => line.startsWith("> **``"))
    .map((line) => line.replace(/\s+/g, " ").replace(/^> \*\*`` /, "").replace("``**", "|"));
}

test("the Releases table shows each Release at its Date Precision", async (t) => {
  const rows = await renderReleaseRows(t, [
    apiRelease(1, "PlayStation 5", "Worldwide", "2027-03-05", "day"),
    apiRelease(2, "Nintendo Switch 2", "Worldwide", "2027-04-01", "month"),
    apiRelease(3, "Xbox Series X|S", "Worldwide", "2027-07-01", "quarter"),
    apiRelease(4, "PC (Microsoft Windows)", "Worldwide", "2028-01-01", "year"),
    apiRelease(5, "Nintendo Switch", "Worldwide", null, "tba"),
  ]);

  const labels = rows.map((row) => row.split("|")[0].trim());
  assert.deepEqual(labels, ["03/05/2027", "Apr 2027", "Q3 2027", "2028", "TBA"]);
});

test("rows group Releases that share a date and Date Precision, with regions", async (t) => {
  const rows = await renderReleaseRows(t, [
    apiRelease(1, "PlayStation 5", "Japan", "2027-07-01", "quarter"),
    apiRelease(2, "PlayStation 5", "North America", "2027-07-01", "quarter"),
    apiRelease(3, "PlayStation 5", "Europe", "2027-07-01", "day"),
  ]);

  assert.equal(rows.length, 2);
  const [dayRow, quarterRow] = rows;
  assert.match(dayRow, /^07\/01\/2027 \|/);
  assert.match(dayRow, /PlayStation 5 \(Europe\)/);
  assert.match(quarterRow, /^Q3 2027 \|/);
  assert.match(quarterRow, /PlayStation 5 \(Japan\), PlayStation 5 \(North America\)/);
});

test("rows sort vague Releases where their period places them", async (t) => {
  const rows = await renderReleaseRows(t, [
    apiRelease(1, "A", "Worldwide", null, "tba"),
    apiRelease(2, "B", "Worldwide", "2027-01-01", "year"),
    apiRelease(3, "C", "Worldwide", "2027-10-01", "quarter"),
    apiRelease(4, "D", "Worldwide", "2027-12-31", "day"),
    apiRelease(5, "E", "Worldwide", "2027-12-01", "month"),
    apiRelease(6, "F", "Worldwide", "2027-12-01", "day"),
    apiRelease(7, "G", "Worldwide", "2027-06-15", "day"),
    apiRelease(8, "H", "Worldwide", "2027-04-01", "quarter"),
  ]);

  const labels = rows.map((row) => row.split("|")[0].trim());
  assert.deepEqual(labels, [
    "06/15/2027",
    "Q2 2027",
    "Dec 2027",
    "12/01/2027",
    "12/31/2027",
    "Q4 2027",
    "2027",
    "TBA",
  ]);
});

test("a game's earliest release date counts only day Releases", () => {
  const profile = mapGameProfileFromApi(
    apiProfile([
      apiRelease(1, "PlayStation 5", "Worldwide", "2020-01-01", "year"),
      apiRelease(2, "PlayStation 5", "Worldwide", "2999-03-05", "day"),
    ]),
    GAME_ID,
  );
  assert.equal(isGameReleased(profile.game, profile.releases), false);
});
