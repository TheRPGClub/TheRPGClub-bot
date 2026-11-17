/**
 * A member's Birth Date (spec api#376, bot#1549): `/profile birth-date`. The API owns the
 * rules (ADR 0005): who may read or set it, the two-changes-a-month limit and staff
 * bypassing it. The bot only names the acting Discord user and shows the answer, privately,
 * since only the member and staff may see the full date.
 */

import axios from "axios";
import { userMention } from "discord.js";

import { buildApiErrorMessage } from "../utilities/ApiErrorUtils.js";
import { apiGetOrThrow, apiPutOrThrow } from "./RpgClubApiClient.js";

export interface IBirthDateDocument {
  userId: string;
  /** YYYY-MM-DD, or null until the member enters it. */
  birthDate: string | null;
  /** How many more times the member may set or change it this month (club time zone). */
  changesLeftThisMonth: number;
  /** YYYY-MM-DD when no changes are left this month, else null. */
  nextChangeOn: string | null;
}

export interface IBirthDateApi {
  /** GET /api/v1/users/:user_id/birth_date. Throws the AxiosError on 403. */
  getBirthDate(userId: string, actingUserId: string): Promise<IBirthDateDocument>;
  /**
   * PUT /api/v1/users/:user_id/birth_date; null removes it. Throws the AxiosError on 403,
   * 404 (staff naming an unknown member) and 422 (the limit, or a date it won't take).
   */
  setBirthDate(
    userId: string,
    birthDate: string | null,
    actingUserId: string,
  ): Promise<IBirthDateDocument>;
}

type BirthDatePayload = {
  user_id: string;
  birth_date: string | null;
  changes_left_this_month: number;
  next_change_on: string | null;
};

function toBirthDateDocument(payload: BirthDatePayload): IBirthDateDocument {
  return {
    userId: payload.user_id,
    birthDate: payload.birth_date,
    changesLeftThisMonth: payload.changes_left_this_month,
    nextChangeOn: payload.next_change_on,
  };
}

function birthDatePath(userId: string): string {
  return `/api/v1/users/${encodeURIComponent(userId)}/birth_date`;
}

export const BIRTH_DATE_API: IBirthDateApi = {
  async getBirthDate(userId, actingUserId) {
    // The query is in the path because the error reply shows the request's url, not its
    // params.
    const query = new URLSearchParams({ acting_user_id: actingUserId });
    const payload = await apiGetOrThrow<{ data: BirthDatePayload }>(
      `${birthDatePath(userId)}?${query.toString()}`,
    );
    return toBirthDateDocument(payload.data);
  },
  async setBirthDate(userId, birthDate, actingUserId) {
    const payload = await apiPutOrThrow<{ data: BirthDatePayload }>(birthDatePath(userId), {
      data: { birth_date: birthDate, acting_user_id: actingUserId },
    });
    return toBirthDateDocument(payload.data);
  },
};

/** What the member asked for: see it, set it to a typed date, or remove it. */
export type BirthDateAction =
  | { kind: "view" }
  | { kind: "set"; date: string }
  | { kind: "remove" };

export interface IBirthDateInput {
  actingUserId: string;
  targetUserId: string;
  action: BirthDateAction;
}

export interface IBirthDateDeps {
  api?: IBirthDateApi;
}

export const BIRTH_DATE_FORMAT_HINT = "Enter it as YYYY-MM-DD, for example 1990-05-04.";

/** "4 May 1990" for "1990-05-04", the way the API words dates; the input if it isn't one. */
export function formatBirthDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function changesLeftLine(document: IBirthDateDocument, own: boolean): string {
  const who = own ? "You" : "They";
  if (document.changesLeftThisMonth <= 0 && document.nextChangeOn) {
    return `${who} can change it again on ${formatBirthDate(document.nextChangeOn)}.`;
  }
  const count = document.changesLeftThisMonth;
  return `${who} can change it ${count} more ${count === 1 ? "time" : "times"} this month.`;
}

function viewReply(document: IBirthDateDocument, own: boolean, targetUserId: string): string {
  const left = changesLeftLine(document, own);
  if (!document.birthDate) {
    return own
      ? "You haven't entered a Birth Date. " +
        `Set it with \`/profile birth-date date:YYYY-MM-DD\`. ${left}`
      : `${userMention(targetUserId)} hasn't entered a Birth Date. ${left}`;
  }
  const date = `**${formatBirthDate(document.birthDate)}**`;
  return own
    ? `Your Birth Date is ${date}. Only you and staff can see it. ${left}`
    : `${userMention(targetUserId)}'s Birth Date is ${date}. ${left}`;
}

function changedReply(document: IBirthDateDocument, own: boolean, targetUserId: string): string {
  const subject = own ? "Your Birth Date" : `${userMention(targetUserId)}'s Birth Date`;
  const what = document.birthDate
    ? `is now **${formatBirthDate(document.birthDate)}**`
    : "is removed";
  const after = own
    ? changesLeftLine(document, true)
    : "Staff changes don't count toward the member's two a month.";
  return `${subject} ${what}. ${after}`;
}

function responseOf(err: unknown): { status: number; data: unknown } | null {
  if (!axios.isAxiosError(err) || !err.response) return null;
  return { status: err.response.status, data: err.response.data };
}

function bodyString(data: unknown, key: string): string | null {
  if (!data || typeof data !== "object") return null;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * The friendly line for a refusal the member or staff can act on, or null for an error the
 * command's error reply should show.
 */
function refusalLine(err: unknown, targetUserId: string): string | null {
  const response = responseOf(err);
  if (!response) return null;
  const message = bodyString(response.data, "error");
  if (response.status === 403) return "Only staff can see or set another member's Birth Date.";
  if (response.status === 404) {
    return `${userMention(targetUserId)} isn't in the club's member records yet.`;
  }
  if (response.status !== 422) return null;
  const nextChangeOn = bodyString(response.data, "next_change_on");
  if (nextChangeOn) {
    return message ?? "You've used this month's changes. " +
      `You can change your Birth Date again on ${formatBirthDate(nextChangeOn)}.`;
  }
  const reason = message ? `: ${message.replace(/\.$/, "")}` : "";
  return `That Birth Date wasn't saved${reason}. ${BIRTH_DATE_FORMAT_HINT}`;
}

/**
 * `/profile birth-date`: shows, sets or removes the target's Birth Date as the acting
 * member and returns the private reply. API refusals (403, 404, 422 with the limit's date)
 * get a friendly line plus the full request and response, with no dev ping since nothing
 * is broken; any other API error is thrown for the command's error reply.
 */
export async function birthDateReply(
  input: IBirthDateInput,
  deps: IBirthDateDeps = {},
): Promise<string> {
  const api = deps.api ?? BIRTH_DATE_API;
  const own = input.actingUserId === input.targetUserId;
  const { action } = input;
  try {
    if (action.kind === "view") {
      const document = await api.getBirthDate(input.targetUserId, input.actingUserId);
      return viewReply(document, own, input.targetUserId);
    }
    const birthDate = action.kind === "set" ? action.date.trim() : null;
    const document = await api.setBirthDate(input.targetUserId, birthDate, input.actingUserId);
    return changedReply(document, own, input.targetUserId);
  } catch (err: unknown) {
    const friendly = refusalLine(err, input.targetUserId);
    if (!friendly) throw err;
    return buildApiErrorMessage(friendly, err, { devPing: false });
  }
}
