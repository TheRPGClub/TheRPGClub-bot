import assert from "node:assert/strict";
import test from "node:test";
import { mapDueData } from "../classes/GameReleaseAnnouncement.js";
import { buildAnnouncementPreface } from "../services/GameReleaseAnnouncementService.js";

test("the announcement card announces the plain YYYY-MM-DD date of the due Release", () => {
  const candidate = mapDueData({
    id: 9,
    release_id: 3,
    game_id: 77,
    title: "Chrono Cross",
    release_date: "2027-03-05",
    announce_at: "2027-02-26T00:00:00.000Z",
    platform_name: "PlayStation 5",
    platform_abbreviation: "PS5",
    igdb_url: null,
  });

  // 1804204800 is 2027-03-05T00:00:00Z.
  assert.equal(
    buildAnnouncementPreface(candidate),
    "## Upcoming Game Release\n<t:1804204800:F> (<t:1804204800:R>)",
  );
});
