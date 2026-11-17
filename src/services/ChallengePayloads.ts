import type { IChallenge, IChallengeMember, IChallengeRun } from "./ChallengeApi.js";
import type { IChallengeEdition } from "./ChallengeEditionApi.js";

// The Challenge job payloads' parts (ChallengeAnnounceJobPayload, ChallengeDmJobPayload),
// read and checked once for every post and DM. A part a payload must carry throws an error
// naming what is wrong, which fails the job with it.

function invalid(field: string, what: string, value: unknown): Error {
  return new Error(`Invalid payload: ${field} must be ${what}, got ${JSON.stringify(value)}.`);
}

/** The `challenge` of a job payload. */
export function payloadChallenge(payload: Record<string, unknown>): IChallenge {
  const challenge = payload.challenge as Partial<IChallenge> | undefined;
  if (
    !challenge || typeof challenge !== "object" ||
    typeof challenge.id !== "number" || typeof challenge.name !== "string"
  ) {
    throw invalid("challenge", "a Challenge", challenge);
  }
  return challenge as IChallenge;
}

/** The `run` of a job payload. */
export function payloadRun(payload: Record<string, unknown>): IChallengeRun {
  const run = payload.run as Partial<IChallengeRun> | undefined;
  if (
    !run || typeof run !== "object" || typeof run.id !== "number" ||
    !run.user || typeof run.started_at !== "string" || !run.progress
  ) {
    throw invalid("run", "a Challenge Run", run);
  }
  return run as IChallengeRun;
}

/** The `edition` of a job payload. */
export function payloadEdition(payload: Record<string, unknown>): IChallengeEdition {
  const edition = payload.edition as Partial<IChallengeEdition> | undefined;
  if (
    !edition || typeof edition !== "object" ||
    typeof edition.id !== "number" || typeof edition.year !== "number" ||
    !edition.challenge || typeof edition.challenge.name !== "string" ||
    typeof edition.signup_cutoff_on !== "string" ||
    typeof edition.pick_deadline_on !== "string" || typeof edition.reveal_on !== "string"
  ) {
    throw invalid("edition", "an Edition", edition);
  }
  return edition as IChallengeEdition;
}

/** The `user_id` a DM goes to. */
export function payloadUserId(payload: Record<string, unknown>): string {
  const userId = payload.user_id;
  if (typeof userId !== "string" || !/^\d+$/.test(userId)) {
    throw invalid("user_id", "a Discord user ID", userId);
  }
  return userId;
}

/** A member at `field` (a recipient). */
export function payloadMember(payload: Record<string, unknown>, field: string):
  IChallengeMember {
  const member = payload[field] as Partial<IChallengeMember> | null | undefined;
  if (
    !member || typeof member !== "object" ||
    typeof member.user_id !== "string" || typeof member.username !== "string"
  ) {
    throw invalid(field, "a member", member);
  }
  return member as IChallengeMember;
}

/** The payload's whole number at `key`, or 0 when it has none. */
export function payloadCount(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
}
