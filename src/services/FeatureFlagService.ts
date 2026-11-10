/**
 * Feature Flags for staff (spec api#347, bot#1522): `/flag list`, `/flag set` and the
 * admin-channel announcement of a flag change. The API decides who may list or change a
 * flag (ADR 0005); the bot only names the acting Discord user and shows the answer.
 */

import axios from "axios";
import { userMention } from "discord.js";

import { DISCORD_AUTOCOMPLETE_CHOICES_MAX } from "../config/textLimits.js";
import type { FeatureState } from "../functions/FeatureGate.js";
import { buildApiErrorMessage } from "../utilities/ApiErrorUtils.js";
import { refreshFeatureFlagCache } from "./FeatureAccessService.js";
import { apiGetOrThrow, apiPatchOrThrow } from "./RpgClubApiClient.js";

export const FEATURE_STATES: readonly FeatureState[] = ["off", "preview", "live"];

export const FEATURE_STATE_LABELS: Readonly<Record<FeatureState, string>> = {
  off: "Off",
  preview: "Preview",
  live: "Live",
};

/** The `changed_by` of a change the API made itself (the seed migration). */
const SYSTEM_CHANGER = "system";

export function isFeatureState(value: unknown): value is FeatureState {
  return typeof value === "string" && (FEATURE_STATES as readonly string[]).includes(value);
}

/** Who changed a flag: the Discord user (mentioned, never pinged) or "system". */
function describeChanger(changedBy: string, changedByName: string | null): string {
  if (changedBy === SYSTEM_CHANGER) return SYSTEM_CHANGER;
  const mention = userMention(changedBy);
  return changedByName && changedByName !== changedBy
    ? `${mention} (${changedByName})`
    : mention;
}

/** The `feature_flag_changed` bot job payload (api#351), camelCased. */
export interface IFeatureFlagChangeNotice {
  key: string;
  name: string;
  fromState: FeatureState;
  toState: FeatureState;
  changedBy: string;
  changedByName: string | null;
  reason: string | null;
}

/** The admin-channel post for a flag change: what, from, to, who and why. */
export function buildFeatureFlagChangedNotice(change: IFeatureFlagChangeNotice): string {
  return [
    `**Feature Flag changed:** ${change.name} (\`${change.key}\`) is now ` +
      `**${FEATURE_STATE_LABELS[change.toState]}** ` +
      `(was ${FEATURE_STATE_LABELS[change.fromState]}).`,
    `Changed by ${describeChanger(change.changedBy, change.changedByName)}.`,
    `Reason: ${change.reason?.trim() || "none given"}`,
  ].join("\n");
}

/** The private reply when the API says the acting user is not an Admin or Superadmin. */
export const FEATURE_FLAG_STAFF_ONLY_MESSAGE =
  "Only Admins and Superadmins can manage Feature Flags.";

export interface IFeatureFlagLastChange {
  fromState: FeatureState;
  toState: FeatureState;
  changedBy: string;
  changedByName: string | null;
  reason: string | null;
  changedAt: string;
}

/** One Feature on the staff list (`FeatureFlagEntry` in the API's swagger), camelCased. */
export interface IFeatureFlagEntry {
  key: string;
  name: string;
  state: FeatureState;
  core: boolean;
  hideable: boolean;
  lastChange: IFeatureFlagLastChange | null;
}

export interface IFeatureFlagUpdate {
  state: FeatureState;
  reason: string | null;
  /** The Discord user acting through the bot; the API checks their stored roles. */
  actingUserId: string;
}

export interface IFeatureFlagApi {
  /** GET /api/v1/features. Throws the AxiosError on 403 (not staff). */
  listFeatureFlags(actingUserId: string): Promise<IFeatureFlagEntry[]>;
  /** PATCH /api/v1/features/:key. Throws the AxiosError on 403 and 404 (no such key). */
  setFeatureFlag(
    key: string,
    update: IFeatureFlagUpdate,
  ): Promise<{ entry: IFeatureFlagEntry; changed: boolean }>;
}

type FeatureFlagLastChangePayload = {
  from_state: FeatureState;
  to_state: FeatureState;
  changed_by: string;
  changed_by_name: string | null;
  reason: string | null;
  changed_at: string;
};

type FeatureFlagEntryPayload = {
  key: string;
  name: string;
  state: FeatureState;
  core: boolean;
  hideable: boolean;
  last_change: FeatureFlagLastChangePayload | null;
};

function toFeatureFlagEntry(payload: FeatureFlagEntryPayload): IFeatureFlagEntry {
  const change = payload.last_change;
  return {
    key: payload.key,
    name: payload.name,
    state: payload.state,
    core: payload.core,
    hideable: payload.hideable,
    lastChange: change
      ? {
        fromState: change.from_state,
        toState: change.to_state,
        changedBy: change.changed_by,
        changedByName: change.changed_by_name,
        reason: change.reason,
        changedAt: change.changed_at,
      }
      : null,
  };
}

const FEATURES_PATH = "/api/v1/features";

export const FEATURE_FLAG_API: IFeatureFlagApi = {
  async listFeatureFlags(actingUserId) {
    // The list answers 200 for staff and 403 otherwise; a 404 (an API that predates it) is
    // thrown as is, so the error reply shows the full request and response. The query is
    // in the path because the error reply shows the request's url, not its params.
    const query = new URLSearchParams({ acting_user_id: actingUserId });
    const payload = await apiGetOrThrow<{ data: FeatureFlagEntryPayload[] }>(
      `${FEATURES_PATH}?${query.toString()}`,
    );
    return payload.data.map(toFeatureFlagEntry);
  },
  async setFeatureFlag(key, update) {
    type Payload = { data: FeatureFlagEntryPayload; meta: { changed: boolean } };
    const payload = await apiPatchOrThrow<Payload>(
      `${FEATURES_PATH}/${encodeURIComponent(key)}`,
      {
        data: {
          state: update.state,
          reason: update.reason,
          acting_user_id: update.actingUserId,
        },
      },
    );
    return { entry: toFeatureFlagEntry(payload.data), changed: payload.meta.changed };
  },
};

function responseStatus(err: unknown): number | null {
  return axios.isAxiosError(err) ? err.response?.status ?? null : null;
}

/**
 * The reply for an API refusal staff can act on: the friendly line, then the full request
 * and response (CLAUDE.md), with no dev ping since nothing is broken.
 */
function refusalReply(friendly: string, err: unknown): string {
  return buildApiErrorMessage(friendly, err, { devPing: false });
}

function featureLabel(feature: { key: string; name: string }): string {
  return `${feature.name} (\`${feature.key}\`)`;
}

export interface IFeatureFlagDeps {
  api?: IFeatureFlagApi;
  /** Re-reads the bot's club-wide Feature Flags, so the change shows in the bot at once. */
  refreshFlagCache?: () => void;
}

/**
 * `/flag set`: asks the API to change the flag for the acting user and returns the private
 * reply. A 403 gets the polite staff-only line and an unknown key (404) is named back, each
 * with the full request and response; any other API error is thrown for the command's
 * error reply. After any successful answer the bot re-reads its Feature Flags.
 */
export async function setFeatureFlagReply(
  input: { actingUserId: string; key: string; state: FeatureState; reason: string | null },
  deps: IFeatureFlagDeps = {},
): Promise<string> {
  const api = deps.api ?? FEATURE_FLAG_API;
  const refreshFlagCache = deps.refreshFlagCache ?? refreshFeatureFlagCache;
  let result: Awaited<ReturnType<IFeatureFlagApi["setFeatureFlag"]>>;
  try {
    result = await api.setFeatureFlag(input.key, {
      state: input.state,
      reason: input.reason,
      actingUserId: input.actingUserId,
    });
  } catch (err: unknown) {
    const status = responseStatus(err);
    if (status === 403) return refusalReply(FEATURE_FLAG_STAFF_ONLY_MESSAGE, err);
    if (status === 404) {
      return refusalReply(`There is no Feature \`${input.key}\`. Pick one from the list.`, err);
    }
    throw err;
  }
  refreshFlagCache();

  const { entry, changed } = result;
  const stateLabel = FEATURE_STATE_LABELS[entry.state];
  if (!changed) return `${featureLabel(entry)} is already **${stateLabel}**. Nothing changed.`;
  const from = entry.lastChange
    ? ` (was ${FEATURE_STATE_LABELS[entry.lastChange.fromState]})`
    : "";
  return `${featureLabel(entry)} is now **${stateLabel}**${from}. ` +
    "The change is announced in the admin channel.";
}

/** Longest reason shown on a `/flag list` line; the announcement carries it in full. */
const LIST_REASON_MAX = 120;

function describeLastChange(change: IFeatureFlagLastChange | null): string {
  // The seed's "system" rows say nothing staff need; only show a person's change.
  if (!change || change.changedBy === SYSTEM_CHANGER) return "";
  const seconds = Math.floor(Date.parse(change.changedAt) / 1000);
  const when = Number.isFinite(seconds) ? ` <t:${seconds}:R>` : "";
  const reason = change.reason?.trim();
  const shortReason = reason && reason.length > LIST_REASON_MAX
    ? `${reason.slice(0, LIST_REASON_MAX - 3)}...`
    : reason;
  return `, set${when} by ${describeChanger(change.changedBy, change.changedByName)}` +
    (shortReason ? `: ${shortReason}` : "");
}

function featureListLine(entry: IFeatureFlagEntry): string {
  return `- ${featureLabel(entry)}: **${FEATURE_STATE_LABELS[entry.state]}**` +
    describeLastChange(entry.lastChange);
}

/**
 * `/flag list`: every Feature with its state and last change, Core Features first, as the
 * private reply. A 403 gets the polite staff-only line with the full request and response;
 * any other API error is thrown for the command's error reply.
 */
export async function listFeatureFlagsReply(
  actingUserId: string,
  deps: Pick<IFeatureFlagDeps, "api"> = {},
): Promise<string> {
  const api = deps.api ?? FEATURE_FLAG_API;
  let entries: IFeatureFlagEntry[];
  try {
    entries = await api.listFeatureFlags(actingUserId);
  } catch (err: unknown) {
    if (responseStatus(err) === 403) return refusalReply(FEATURE_FLAG_STAFF_ONLY_MESSAGE, err);
    throw err;
  }
  const lines = ["**Feature Flags**"];
  const sections: [string, IFeatureFlagEntry[]][] = [
    ["Core Features", entries.filter((entry) => entry.core)],
    ["Hideable Features", entries.filter((entry) => !entry.core)],
  ];
  for (const [title, sectionEntries] of sections) {
    if (!sectionEntries.length) continue;
    lines.push("", `**${title}**`, ...sectionEntries.map(featureListLine));
  }
  return lines.join("\n");
}

/** A Feature as autocomplete needs it (the club-wide flags fit). */
export interface IFeatureChoiceSource {
  key: string;
  name: string;
  state: FeatureState;
}

/**
 * Autocomplete for `/flag set feature:`: registry Features whose name or key contains the
 * typed text (any case), labelled with their current state, with the key as the value.
 */
export function featureFlagChoices(
  query: string,
  features: readonly IFeatureChoiceSource[],
): { name: string; value: string }[] {
  const needle = query.trim().toLowerCase();
  return features
    .filter((feature) => !needle ||
      feature.name.toLowerCase().includes(needle) ||
      feature.key.includes(needle))
    .slice(0, DISCORD_AUTOCOMPLETE_CHOICES_MAX)
    .map((feature) => ({
      name: `${feature.name} (${FEATURE_STATE_LABELS[feature.state]})`,
      value: feature.key,
    }));
}
