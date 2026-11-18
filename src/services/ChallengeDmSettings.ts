import { apiGetOrThrow, apiPatchOrThrow } from "./RpgClubApiClient.js";
import { challengeRefusalText } from "./ChallengeApi.js";
import { challengeTextView, type IChallengeView } from "./ChallengeBrowse.js";
import { commandMention } from "./CommandMentionService.js";

// /challenge dms on|off (spec api#376, bot#1548): the member's Challenge DM opt-out. On
// until they turn it off; the API then stops queueing their reminder DMs (a Season ending
// soon, a Secret Santa pick due). The API decides who may read and change it.

/** GET/PATCH /users/:user_id/challenge_settings, for the member themself. */
export interface IChallengeSettingsApi {
  /** Whether the member keeps Challenge DMs on. Throws the AxiosError on a refusal. */
  getDms(userId: string): Promise<boolean>;
  /** Turns them on or off; returns the stored value. Throws the AxiosError on a refusal. */
  setDms(userId: string, dms: boolean): Promise<boolean>;
}

interface IChallengeSettings {
  user_id: string;
  dms: boolean;
}

function settingsPath(userId: string): string {
  return `/api/v1/users/${encodeURIComponent(userId)}/challenge_settings`;
}

export const CHALLENGE_SETTINGS_API: IChallengeSettingsApi = {
  async getDms(userId) {
    const payload = await apiGetOrThrow<{ data: IChallengeSettings }>(settingsPath(userId));
    return payload.data.dms;
  },
  async setDms(userId, dms) {
    const payload = await apiPatchOrThrow<{ data: IChallengeSettings }>(
      settingsPath(userId),
      { data: { dms } },
    );
    return payload.data.dms;
  },
};

export type ChallengeDmsChoice = "on" | "off";

export interface IChallengeDmsDeps {
  api?: IChallengeSettingsApi;
}

/** What to show: a view, or an error (the API's refusal with its request and response). */
export type ChallengeDmsResult = { view: IChallengeView } | { error: string };

const WHAT_THEY_ARE = "Challenge reminders, such as a Season of your Run ending in 7 days";

function turnHint(dms: boolean): string {
  const command = commandMention("challenge dms");
  return dms
    ? `-# Turn them off with ${command} set:off`
    : `-# Turn them on with ${command} set:on`;
}

function settingText(dms: boolean, changed: boolean): string {
  const heading = changed
    ? `## Challenge DMs turned ${dms ? "on" : "off"}`
    : `## Challenge DMs are ${dms ? "on" : "off"}`;
  let line: string;
  if (dms) {
    line = `The bot ${changed ? "will DM" : "DMs"} you ${WHAT_THEY_ARE}.`;
  } else {
    line = changed
      ? "The bot won't DM you Challenge reminders any more."
      : "The bot doesn't DM you Challenge reminders.";
  }
  return [heading, line, turnHint(dms)].join("\n");
}

/**
 * /challenge dms [set:on|off]: with no choice, shows the member's setting; with one,
 * changes it. Refusals are shown as the API words them, with the request and response.
 */
export async function challengeDmsReply(
  input: { userId: string; set?: ChallengeDmsChoice },
  deps: IChallengeDmsDeps = {},
): Promise<ChallengeDmsResult> {
  const api = deps.api ?? CHALLENGE_SETTINGS_API;
  if (!input.set) {
    try {
      return { view: challengeTextView(settingText(await api.getDms(input.userId), false)) };
    } catch (err: unknown) {
      return { error: challengeRefusalText(err, "Could not read your Challenge DM setting.") };
    }
  }
  try {
    const dms = await api.setDms(input.userId, input.set === "on");
    return { view: challengeTextView(settingText(dms, true)) };
  } catch (err: unknown) {
    return { error: challengeRefusalText(err, "Could not change your Challenge DM setting.") };
  }
}
