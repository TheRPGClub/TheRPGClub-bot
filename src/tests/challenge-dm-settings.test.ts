import assert from "node:assert/strict";
import test from "node:test";
import {
  challengeDmsReply,
  type ChallengeDmsResult,
  type IChallengeSettingsApi,
} from "../services/ChallengeDmSettings.js";
import {
  DEFAULT_WEBSITE_BASE_URL,
  resolveWebsiteBaseUrl,
} from "../config/website.js";
import { apiError, textOf } from "./challengeFixtures.js";

// /challenge dms on|off (bot#1548): the member's Challenge DM opt-out, through
// GET/PATCH /users/:id/challenge_settings, with a fake API.

interface IFakeSettingsApi extends IChallengeSettingsApi {
  calls: string[];
}

function fakeApi(options: { dms?: boolean; error?: unknown } = {}): IFakeSettingsApi {
  let dms = options.dms ?? true;
  const api: IFakeSettingsApi = {
    calls: [],
    getDms: async (userId) => {
      api.calls.push(`get ${userId}`);
      if (options.error) throw options.error;
      return dms;
    },
    setDms: async (userId, value) => {
      api.calls.push(`set ${userId} ${value}`);
      if (options.error) throw options.error;
      dms = value;
      return dms;
    },
  };
  return api;
}

function shown(result: ChallengeDmsResult): string {
  return "error" in result ? result.error : textOf(result.view.components);
}

test("/challenge dms with no choice shows the member's setting", async () => {
  const api = fakeApi({ dms: true });
  const result = await challengeDmsReply({ userId: "222" }, { api });

  assert.deepEqual(api.calls, ["get 222"]);
  assert.match(shown(result), /^## Challenge DMs are on$/m);
  assert.match(shown(result), /^-# Turn them off with \/challenge dms set:off$/m);

  const off = await challengeDmsReply({ userId: "222" }, { api: fakeApi({ dms: false }) });
  assert.match(shown(off), /^## Challenge DMs are off$/m);
  assert.match(shown(off), /set:on$/m);
});

test("/challenge dms off turns the member's Challenge DMs off", async () => {
  const api = fakeApi({ dms: true });
  const result = await challengeDmsReply({ userId: "222", set: "off" }, { api });

  assert.deepEqual(api.calls, ["set 222 false"]);
  assert.ok("view" in result);
  assert.match(shown(result), /^## Challenge DMs turned off$/m);
  assert.match(shown(result), /won't DM you Challenge reminders/);
});

test("/challenge dms on turns them back on", async () => {
  const api = fakeApi({ dms: false });
  const result = await challengeDmsReply({ userId: "222", set: "on" }, { api });

  assert.deepEqual(api.calls, ["set 222 true"]);
  assert.match(shown(result), /^## Challenge DMs turned on$/m);
});

test("/challenge dms shows a refusal with the request and response", async () => {
  const error = apiError(
    404,
    { error: "feature_unavailable", message: "Challenges aren't available to you yet." },
    {
      method: "patch",
      url: "/api/v1/users/222/challenge_settings",
      data: { data: { dms: false } },
    },
  );
  const result = await challengeDmsReply({ userId: "222", set: "off" }, {
    api: fakeApi({ error }),
  });

  assert.ok("error" in result);
  assert.match(result.error, /^Challenges aren't available to you yet\./);
  assert.match(result.error, /challenge_settings/);
  assert.match(result.error, /feature_unavailable/);
});

test("WEBSITE_BASE_URL: an override is used without its trailing slash", () => {
  assert.equal(resolveWebsiteBaseUrl(" https://staging.example/ "), "https://staging.example");
  assert.equal(resolveWebsiteBaseUrl(undefined), DEFAULT_WEBSITE_BASE_URL);
  assert.equal(resolveWebsiteBaseUrl(""), DEFAULT_WEBSITE_BASE_URL);
  assert.equal(resolveWebsiteBaseUrl("not a url"), DEFAULT_WEBSITE_BASE_URL);
});
