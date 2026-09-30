// Prints, as JSON, which of a PR body's Testing steps `/conduct-auto` may perform in the
// tester's Discord web session and which it hands back, plus the test channel's URL.
// Usage: npm run -s conduct:drive-plan -- <body-file>
// Exits 1 when there is nothing to drive, 2 on a usage or read error, 0 otherwise.

import * as fs from "fs";

import { TEST_GUILD_IDS, TEST_GUILD_SNOWFLAKE } from "../src/config/testGuild.ts";
import { buildDrivePlan } from "../src/conductor/DrivePlan.ts";

const bodyPath = process.argv[2];
if (!bodyPath) {
  console.error("Usage: npm run -s conduct:drive-plan -- <body-file>");
  process.exit(2);
}

let body: string;
try {
  body = fs.readFileSync(bodyPath, "utf8");
} catch (err: unknown) {
  console.error(`Cannot read ${bodyPath}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}

const plan = buildDrivePlan(body);
if (plan.kind === "none") {
  console.error(plan.reason);
  process.exit(1);
}

const testChannelId = TEST_GUILD_IDS.BOT_DEV_CHANNEL_ID;
if (!testChannelId) {
  console.error("src/config/testGuild.ts has no BOT_DEV_CHANNEL_ID for the test guild.");
  process.exit(2);
}
const channelUrl = `https://discord.com/channels/${TEST_GUILD_SNOWFLAKE}/${testChannelId}`;
console.log(JSON.stringify({ channelUrl, steps: plan.steps }, null, 2));
