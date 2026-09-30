// Validates the `## Testing` section of a PR body file with the conductor's parser.
// Usage: npm run check:pr-testing -- <body-file>
// Exits 1 when the section is malformed, 2 on a usage or read error, 0 otherwise.

import * as fs from "fs";

import { checkPrTesting } from "../src/conductor/PrTestingCheck.ts";

const bodyPath = process.argv[2];
if (!bodyPath) {
  console.error("Usage: npm run check:pr-testing -- <body-file>");
  process.exit(2);
}

let body: string;
try {
  body = fs.readFileSync(bodyPath, "utf8");
} catch (err: unknown) {
  console.error(`Cannot read ${bodyPath}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}

const result = checkPrTesting(body);
const print = result.ok ? console.log : console.error;
for (const line of result.lines) print(line);
process.exit(result.ok ? 0 : 1);
