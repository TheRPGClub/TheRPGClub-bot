import test from "node:test";
import assert from "node:assert/strict";
import type { Client } from "discord.js";

// Preview mode is read once at module load, so SetPresence must be imported dynamically
// below this assignment.
process.env.PREVIEW_PR = "1297";
process.env.PREVIEW_SHA = "a606242f0c1d2e3b4a5968778695a4b3c2d1e0f9";

const { default: BotPresenceHistory } = await import("../classes/BotPresenceHistory.js");
const { setPresence, updateBotPresence } = await import("../functions/SetPresence.js");

import type { AnyRepliable } from "../functions/InteractionUtils.js";

function fakeClient(seen: string[]): Client {
  return {
    user: {
      setPresence: (data: { activities: { name: string }[] }) => {
        seen.push(data.activities[0].name);
      },
    },
  } as unknown as Client;
}

test("updateBotPresence sets the PR status without reading BotPresenceHistory", async (t) => {
  const read = t.mock.method(BotPresenceHistory, "getLatestPresenceActivity", async () => "GOTM");
  const seen: string[] = [];
  await updateBotPresence(fakeClient(seen));
  assert.deepEqual(seen, ["Testing PR #1297 (a606242)"]);
  assert.equal(read.mock.callCount(), 0);
});

test("setPresence changes the status in a preview but never saves it", async (t) => {
  const save = t.mock.method(BotPresenceHistory, "savePresence", async () => undefined);
  const seen: string[] = [];
  const interaction = {
    client: fakeClient(seen),
    user: { id: "1", tag: "tester" },
  } as unknown as AnyRepliable;
  await setPresence(interaction, "Conductor check");
  assert.deepEqual(seen, ["Conductor check"]);
  assert.equal(save.mock.callCount(), 0);
});
