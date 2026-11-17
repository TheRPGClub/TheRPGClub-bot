import assert from "node:assert/strict";
import test from "node:test";
import { formatReleaseDate } from "../functions/DateFormatUtils.js";
import { mapReleaseFromApi } from "../functions/GameMappers.js";

const API_RELEASE = {
  release_id: 1,
  game_id: 10,
  platform_id: 4,
  region_id: 1,
  format: null,
  notes: null,
};

test("a day Release keeps the exact-day format", () => {
  assert.equal(formatReleaseDate(new Date("2027-03-05"), "day"), "03/05/2027");
});

test("a month Release shows its month and year", () => {
  assert.equal(formatReleaseDate(new Date("2027-03-01"), "month"), "Mar 2027");
});

test("a quarter Release shows its quarter and year", () => {
  assert.equal(formatReleaseDate(new Date("2027-07-01"), "quarter"), "Q3 2027");
  assert.equal(formatReleaseDate(new Date("2027-01-01"), "quarter"), "Q1 2027");
  assert.equal(formatReleaseDate(new Date("2027-10-01"), "quarter"), "Q4 2027");
});

test("a year Release shows only its year", () => {
  assert.equal(formatReleaseDate(new Date("2027-01-01"), "year"), "2027");
});

test("a tba Release, or any Release with no date, shows TBA", () => {
  assert.equal(formatReleaseDate(null, "tba"), "TBA");
  assert.equal(formatReleaseDate(null, "day"), "TBA");
});

test("the first day of a period reads as that period whatever the host time zone", () => {
  const original = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  try {
    assert.equal(formatReleaseDate(new Date("2027-07-01"), "quarter"), "Q3 2027");
    assert.equal(formatReleaseDate(new Date("2027-01-01"), "year"), "2027");
    assert.equal(formatReleaseDate(new Date("2027-03-01"), "month"), "Mar 2027");
    assert.equal(formatReleaseDate(new Date("2027-03-05"), "day"), "03/05/2027");
  } finally {
    process.env.TZ = original;
  }
});

test("a Release from the API keeps its Date Precision and its plain date", () => {
  const release = mapReleaseFromApi({
    ...API_RELEASE,
    release_date: "2027-07-01",
    date_precision: "quarter",
  });
  assert.equal(release.datePrecision, "quarter");
  assert.equal(release.releaseDate?.toISOString(), "2027-07-01T00:00:00.000Z");
});

test("a Release without a Date Precision reads as day when dated and tba when not", () => {
  const dated = mapReleaseFromApi({ ...API_RELEASE, release_date: "2027-03-05" });
  const undated = mapReleaseFromApi({ ...API_RELEASE, release_date: null });
  assert.equal(dated.datePrecision, "day");
  assert.equal(undated.datePrecision, "tba");
});

test("an unknown Date Precision is never shown as a day", () => {
  const release = mapReleaseFromApi({
    ...API_RELEASE,
    release_date: "2027-07-01",
    date_precision: "decade",
  });
  assert.equal(release.datePrecision, "tba");
});
