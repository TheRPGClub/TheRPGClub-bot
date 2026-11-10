import assert from "node:assert/strict";
import test from "node:test";
import axios, { AxiosError, type AxiosAdapter } from "axios";

process.env.RPGCLUB_API_BASE_URL = "https://api.example.test";
process.env.RPGCLUB_BOT_API_TOKEN = "token";

const NOT_FOUND_BODY = { error: "not_found", path: "unknown route" };

const adapter: AxiosAdapter = async (config) => {
  const response = { data: NOT_FOUND_BODY, status: 404, statusText: "", headers: {}, config };
  throw new AxiosError("Request failed with status code 404", "ERR_BAD_REQUEST", config, null,
    response);
};
axios.defaults.adapter = adapter;

const { FEATURE_ACCESS_API } = await import("../services/FeatureAccessService.js");
const { FEATURE_FLAG_API } = await import("../services/FeatureFlagService.js");
const { buildApiErrorMessage } = await import("../utilities/ApiErrorUtils.js");

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  assert.fail("expected a rejection");
}

test("/flag list: a 404 keeps the full request and response for the error reply", async () => {
  const err = await rejection(FEATURE_FLAG_API.listFeatureFlags("42"));

  assert.equal(axios.isAxiosError(err), true);
  const message = buildApiErrorMessage("Could not list the Feature Flags", err);
  assert.match(message, /\/api\/v1\/features/);
  assert.match(message, /acting_user_id/);
  assert.match(message, /not_found/);
});

test("Feature access lookup: a 404 keeps the full request and response", async () => {
  const err = await rejection(FEATURE_ACCESS_API.fetchFeatureAccess("42"));

  assert.equal(axios.isAxiosError(err), true);
  const message = buildApiErrorMessage("Could not read Feature access", err);
  assert.match(message, /\/api\/v1\/users\/42\/feature_access/);
  assert.match(message, /not_found/);
});
