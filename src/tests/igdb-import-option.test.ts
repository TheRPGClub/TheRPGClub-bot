import assert from "node:assert/strict";
import test from "node:test";
import { DISCORD_SELECT_OPTIONS_MAX } from "../config/textLimits.js";
import {
  buildSelectOptions,
  IGDB_IMPORT_OPTION_VALUE,
  withIgdbImportOption,
} from "../functions/uiComponents.js";

function games(count: number): { label: string; value: string }[] {
  return Array.from({ length: count }, (_, i) => ({ label: `Mario ${i}`, value: String(i) }));
}

test("the IGDB import option survives a search with more matches than a menu holds", () => {
  const options = buildSelectOptions(withIgdbImportOption(games(40)));
  assert.equal(options.length, DISCORD_SELECT_OPTIONS_MAX);
  assert.equal(options.at(-1)?.data.value, IGDB_IMPORT_OPTION_VALUE);
});

test("a short result list keeps every game and ends with the import option", () => {
  const options = withIgdbImportOption(games(3));
  assert.deepEqual(options.map((o) => o.value), ["0", "1", "2", IGDB_IMPORT_OPTION_VALUE]);
});
