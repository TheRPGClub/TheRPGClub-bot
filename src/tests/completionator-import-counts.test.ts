import assert from "node:assert/strict";
import test from "node:test";
import axios, { type AxiosAdapter } from "axios";

process.env.RPGCLUB_API_BASE_URL = "https://api.example.test";
process.env.RPGCLUB_BOT_API_TOKEN = "token";

let byStatus: Record<string, number> = {};
const adapter: AxiosAdapter = async (config) => ({
  data: { data: { import_id: 1, by_status: byStatus } },
  status: 200,
  statusText: "OK",
  headers: {},
  config,
});
axios.defaults.adapter = adapter;

const { countImportItems } = await import("../classes/CompletionatorImport.js");

test("countImportItems reads the added and failed keys", async () => {
  byStatus = { pending: 4, added: 2, updated: 1, skipped: 3, failed: 1 };
  assert.deepEqual(await countImportItems(1), {
    pending: 4,
    skipped: 3,
    added: 2,
    updated: 1,
    failed: 1,
  });
});

test("countImportItems falls back to the legacy imported and error keys", async () => {
  byStatus = { imported: 5, error: 2 };
  const counts = await countImportItems(1);
  assert.equal(counts.added, 5);
  assert.equal(counts.failed, 2);
});
