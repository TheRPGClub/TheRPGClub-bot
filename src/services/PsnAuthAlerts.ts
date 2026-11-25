import { time, TimestampStyles } from "discord.js";
import { BotJobStepError, isTemporaryJobError } from "./BotJobErrors.js";
import { describeRequestError } from "../utilities/ApiErrorUtils.js";
import { logError } from "../utilities/LogUtils.js";

/** The API runbook the expiry alert links to (api#468). */
export const PSN_NPSSO_RUNBOOK_URL =
  "https://github.com/TheRPGClub/TheRPGClub-api/blob/main/docs/runbooks/psn-npsso.md";

/** Payload `{ expired_at, reminder }` of a `psn_auth_expired` job. */
export interface IPsnAuthExpired {
  expiredAt: Date;
  reminder: boolean;
}

/** Payload `{ expired_at, restored_at }` of a `psn_auth_restored` job. */
export interface IPsnAuthRestored {
  expiredAt: Date;
  restoredAt: Date;
}

function payloadTime(payload: Record<string, unknown>, field: string): Date {
  const value = payload[field];
  const parsed = typeof value === "string" ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid payload: ${field} must be an ISO 8601 time, got ${
      JSON.stringify(value)
    }.`);
  }
  return parsed;
}

export function parsePsnAuthExpired(payload: Record<string, unknown>): IPsnAuthExpired {
  const reminder = payload.reminder;
  if (typeof reminder !== "boolean") {
    throw new Error(`Invalid payload: reminder must be a boolean, got ${
      JSON.stringify(reminder)
    }.`);
  }
  return { expiredAt: payloadTime(payload, "expired_at"), reminder };
}

export function parsePsnAuthRestored(payload: Record<string, unknown>): IPsnAuthRestored {
  return {
    expiredAt: payloadTime(payload, "expired_at"),
    restoredAt: payloadTime(payload, "restored_at"),
  };
}

const MINUTE_MS = 60_000;
const DURATION_UNITS: readonly { label: string; ms: number }[] = [
  { label: "d", ms: 24 * 60 * MINUTE_MS },
  { label: "h", ms: 60 * MINUTE_MS },
  { label: "m", ms: MINUTE_MS },
];

/** A span as its two largest whole units ("2d 3h", "45m"); under a minute reads as such. */
export function formatPausedDuration(ms: number): string {
  if (ms < MINUTE_MS) return "under a minute";
  const first = DURATION_UNITS.findIndex((unit) => ms >= unit.ms);
  return DURATION_UNITS.slice(first, first + 2)
    .map((unit, i) => {
      const above = i === 0 ? Infinity : DURATION_UNITS[first].ms;
      return { label: unit.label, count: Math.floor((ms % above) / unit.ms) };
    })
    .filter((part) => part.count > 0)
    .map((part) => `${part.count}${part.label}`)
    .join(" ");
}

const FIX_STEPS = [
  `Fix ([runbook](<${PSN_NPSSO_RUNBOOK_URL}>)):`,
  "1. Signed in as the club account, copy a fresh NPSSO from " +
    "<https://ca.account.sony.com/api/v1/ssocookie>",
  "2. `fly secrets set -a therpgclub-api PSN_NPSSO=...`",
  "3. Log in once: `bin/rails runner 'Psn::Client.new.send(:access_token)'`",
  "4. Restart PSN sync: `Achievements::ProviderTickJob.perform_later(\"psn\")`",
  "-# Steps 3 and 4 usually happen on their own when the new secret restarts the API.",
];

/** The expiry alert (or its reminder) with the runbook's four fix steps. */
export function buildPsnAuthExpiredMessage(alert: IPsnAuthExpired, now: Date): string {
  const since = time(alert.expiredAt, TimestampStyles.ShortDateTime);
  const headline = alert.reminder
    ? `**PSN login still expired:** PSN sync has been paused for ${
      formatPausedDuration(now.getTime() - alert.expiredAt.getTime())
    }, since ${since}.`
    : `**PSN login expired:** PSN sync is paused since ${since}.`;
  return [headline, ...FIX_STEPS].join("\n");
}

export function buildPsnAuthRestoredMessage(alert: IPsnAuthRestored): string {
  const paused = alert.restoredAt.getTime() - alert.expiredAt.getTime();
  return `**PSN login restored** after ${formatPausedDuration(paused)}; ` +
    "PSN sync is running again.";
}

/** Where a PSN alert goes; an empty id means that target is not configured. */
export interface IPsnAlertTargets {
  channelId: string;
  ownerUserId: string;
}

/** How a PSN alert is sent: the two job surface methods it needs. */
export interface IPsnAlertSender {
  sendChannelMessage(
    channelId: string,
    content: string,
    pingUserIds: readonly string[],
  ): Promise<void>;
  sendDm(userId: string, content: string): Promise<void>;
}

type Outcome = { ok: true } | { ok: false; reason: string; err?: unknown };

async function attempt(
  target: string,
  missing: string,
  send: () => Promise<void>,
): Promise<Outcome> {
  if (!target) return { ok: false, reason: missing };
  try {
    await send();
    return { ok: true };
  } catch (err: unknown) {
    logError("PsnAuthAlerts", err);
    return { ok: false, reason: describeRequestError(err), err };
  }
}

/**
 * Posts the alert in the dev logs channel (pinging nobody) and DMs it to the owner. Each
 * goes out whether or not the other did; resolves with what happened when at least one
 * went through, and throws when neither did.
 */
export async function deliverPsnAuthAlert(
  content: string,
  sender: IPsnAlertSender,
  targets: IPsnAlertTargets,
): Promise<string> {
  const post = await attempt(
    targets.channelId,
    "no bot-dev channel is configured",
    () => sender.sendChannelMessage(targets.channelId, content, []),
  );
  const dm = await attempt(
    targets.ownerUserId,
    "BOT_OWNER_USER_ID is not set",
    () => sender.sendDm(targets.ownerUserId, content),
  );
  const postText = post.ok ? "Posted in the bot-dev channel" : `Not posted (${post.reason})`;
  const dmText = dm.ok ? "DMed the owner" : `not DMed to the owner (${dm.reason})`;
  const summary = `${postText}; ${dmText}.`;
  if (post.ok || dm.ok) return summary;
  const temporary = [post, dm].some((o) => !o.ok && o.err !== undefined
    && isTemporaryJobError(o.err));
  // Retried by the lease only when a send may succeed next time (Discord 5xx, rate limit).
  throw new BotJobStepError("PSN alert not delivered", new Error(summary), temporary);
}
