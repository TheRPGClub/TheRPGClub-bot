// Lists open PRs for the `/test-guild` skill: which can be deployed to the test guild,
// and which one holds it now according to its sticky preview comment.
// Usage: npm run test-guild:status -- <file from gh pr list --json
//   number,title,body,isCrossRepository,comments>
// Exits 2 on a usage or read error, 0 otherwise.

import * as fs from "fs";

import { summarizePullRequests } from "./preview/status.mjs";

const listPath = process.argv[2];
if (!listPath) {
  console.error("Usage: npm run test-guild:status -- <gh pr list json file>");
  process.exit(2);
}

let rows: ReturnType<typeof summarizePullRequests>;
try {
  rows = summarizePullRequests(JSON.parse(fs.readFileSync(listPath, "utf8")));
} catch (err: unknown) {
  console.error(`Cannot read ${listPath}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}

const holders = rows.filter((row) => row.preview !== "none");
console.log(holders.length
  ? `Test guild: ${holders.map((row) => `#${row.number} (${row.preview})`).join(", ")}`
  : "Test guild: no preview running");
for (const row of rows) {
  let deployable = "deployable";
  if (row.fork) deployable = "fork, never deployed";
  else if (row.testing === "malformed") deployable = "Testing section malformed";
  else if (row.testing !== "ok") deployable = "no Testing steps";
  console.log(`#${row.number}\t${deployable}\tpreview: ${row.preview}\t${row.title}`);
}
