/**
 * A member's Birth Date and Birthday sharing (spec api#376 and api#396, bot#1549 and
 * bot#1557): `/profile birth-date`. The API owns the rules (ADR 0005): who may read or set
 * it, the two-changes-a-month limit and staff bypassing it, and that only the member can
 * share their Birthday. The bot only names the acting Discord user and shows the answer,
 * privately, since only the member and staff may see the full date.
 *
 * The reply is design 3B, a small settings panel: the Birth Date in words, whether the
 * Birthday is shared, and buttons that change it in place. Every custom ID names the
 * member, and the clicking user is who acts, so the buttons work after a restart.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ContainerBuilder,
  LabelBuilder,
  ModalBuilder,
  SectionBuilder,
  SeparatorBuilder,
  TextInputBuilder,
} from "@discordjs/builders";
import {
  ButtonStyle,
  MessageFlags,
  SeparatorSpacingSize,
  TextInputStyle,
  type APIMessageTopLevelComponent,
} from "discord-api-types/v10";
import axios from "axios";
import { userMention } from "discord.js";

import { BIRTH_DATE_PREFIX } from "../config/customIdPrefixes.js";
import { buildTextContainer, buildTextDisplay } from "../functions/ComponentsV2Utils.js";
import { buildApiErrorMessage } from "../utilities/ApiErrorUtils.js";
import { plural } from "../utilities/TextUtils.js";
import { commandMention } from "./CommandMentionService.js";
import { apiGetOrThrow, apiPutOrThrow } from "./RpgClubApiClient.js";

export interface IBirthDateDocument {
  userId: string;
  /** "1990-05-04", or "05-04" without the year; null until the member enters it. */
  birthDate: string | null;
  /** Whether the member shares their Birthday (the day and month, never the year). */
  birthdayShared: boolean;
  /** How many more times the member may set or change it this month (club time zone). */
  changesLeftThisMonth: number;
  /** YYYY-MM-DD when no changes are left this month, else null. */
  nextChangeOn: string | null;
}

/** One PUT: a Birth Date (null removes it), sharing, or both. A missing key is unchanged. */
export interface IBirthDateChange {
  birthDate?: string | null;
  birthdayShared?: boolean;
}

export interface IBirthDateApi {
  /** GET /api/v1/users/:user_id/birth_date. Throws the AxiosError on 403. */
  getBirthDate(userId: string, actingUserId: string): Promise<IBirthDateDocument>;
  /**
   * PUT /api/v1/users/:user_id/birth_date, all or nothing. Throws the AxiosError on 403
   * (not the member or staff, or staff sharing someone else's Birthday), 404 (staff naming
   * an unknown member) and 422 (the limit, a date it won't take, or sharing without one).
   */
  updateBirthDate(
    userId: string,
    change: IBirthDateChange,
    actingUserId: string,
  ): Promise<IBirthDateDocument>;
}

type BirthDatePayload = {
  user_id: string;
  birth_date: string | null;
  birthday_shared: boolean;
  changes_left_this_month: number;
  next_change_on: string | null;
};

function toBirthDateDocument(payload: BirthDatePayload): IBirthDateDocument {
  return {
    userId: payload.user_id,
    birthDate: payload.birth_date,
    birthdayShared: payload.birthday_shared === true,
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
  async updateBirthDate(userId, change, actingUserId) {
    const data: Record<string, unknown> = {};
    if ("birthDate" in change) data.birth_date = change.birthDate ?? null;
    if (change.birthdayShared !== undefined) data.birthday_shared = change.birthdayShared;
    data.acting_user_id = actingUserId;
    const payload = await apiPutOrThrow<{ data: BirthDatePayload }>(birthDatePath(userId), {
      data,
    });
    return toBirthDateDocument(payload.data);
  },
};

/** For a Challenge's birth-year Run, which needs the year. */
export const BIRTH_DATE_FORMAT_HINT = "Enter it as YYYY-MM-DD, for example 1990-05-04.";
/** For /profile birth-date, where the year is optional. */
export const BIRTH_DATE_ENTRY_HINT =
  "Enter it as YYYY-MM-DD, or leave out the year: MM-DD or 4 May.";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/**
 * "4 May 1990" for "1990-05-04" and "4 May" for "05-04", the way the API words dates; the
 * input if it isn't one. Replies always state a Birth Date in words, so a misread shows.
 */
export function formatBirthDate(value: string): string {
  const match = /^(?:(\d{4})-)?(\d{2})-(\d{2})$/.exec(value);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  if (!match || !month) return value;
  const dayMonth = `${Number(match[3])} ${month}`;
  return match[1] ? `${dayMonth} ${match[1]}` : dayMonth;
}

const pad = (part: string): string => part.padStart(2, "0");

/** The month a word names: its full name, or the first three letters or more of it. */
function monthNumber(word: string): number | null {
  if (word.length < 3) return null;
  const index = MONTHS.findIndex((name) => name.toLowerCase().startsWith(word));
  return index < 0 ? null : index + 1;
}

const ORDINAL = "(?:st|nd|rd|th)?";
const DAY_FIRST = new RegExp(`^(\\d{1,2})${ORDINAL}(?: of)? ([a-z]+)\\.?(?:,? (\\d{4}))?$`);
const MONTH_FIRST = new RegExp(`^([a-z]+)\\.? (\\d{1,2})${ORDINAL}(?:,? (\\d{4}))?$`);

/**
 * What the member typed as the Birth Date the API takes: "1990-05-04" or, without a year,
 * "05-04". Reads YYYY-MM-DD, MM-DD, and a day and month in words ("4 May", "May 4", with
 * or without the year). Null for anything else; the API decides whether the day is real.
 */
export function parseBirthDateInput(typed: string): string | null {
  const text = typed.trim().toLowerCase().replace(/\s+/g, " ");
  const numeric = /^(?:(\d{4})-)?(\d{1,2})-(\d{1,2})$/.exec(text);
  if (numeric) {
    const dayMonth = `${pad(numeric[2])}-${pad(numeric[3])}`;
    return numeric[1] ? `${numeric[1]}-${dayMonth}` : dayMonth;
  }
  const dayFirst = DAY_FIRST.exec(text);
  const monthFirst = dayFirst ? null : MONTH_FIRST.exec(text);
  const parts = dayFirst
    ? { day: dayFirst[1], month: dayFirst[2], year: dayFirst[3] }
    : monthFirst && { day: monthFirst[2], month: monthFirst[1], year: monthFirst[3] };
  const month = parts ? monthNumber(parts.month) : null;
  if (!parts || !month) return null;
  const dayMonth = `${pad(String(month))}-${pad(parts.day)}`;
  return parts.year ? `${parts.year}-${dayMonth}` : dayMonth;
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
 * command's error reply should show. `hint` is how to enter a date the API won't take.
 */
export function birthDateRefusalLine(
  err: unknown,
  targetUserId: string,
  hint = BIRTH_DATE_FORMAT_HINT,
): string | null {
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
  return `That Birth Date wasn't saved${reason}. ${hint}`;
}

/** The API's refusal of sharing without a Birth Date: its message, or null. */
function sharingNeedsBirthDate(err: unknown): string | null {
  const response = responseOf(err);
  if (response?.status !== 422) return null;
  if (bodyString(response.data, "error") !== "birth_date_required") return null;
  return bodyString(response.data, "message") ??
    "Enter your Birth Date before you share your Birthday.";
}

// Custom IDs: `birth-date-v1:<action>:<member's Discord ID>`.

const BIRTH_DATE_ACTIONS = [
  "share-on", "share-off", "date", "date-modal", "remove", "remove-yes", "keep",
] as const;

type BirthDateButtonAction = (typeof BIRTH_DATE_ACTIONS)[number];

function buildBirthDateId(action: BirthDateButtonAction, userId: string): string {
  return `${BIRTH_DATE_PREFIX}:${action}:${userId}`;
}

export function parseBirthDateId(
  customId: string,
): { action: BirthDateButtonAction; userId: string } | null {
  const match = new RegExp(`^${BIRTH_DATE_PREFIX}:([a-z-]+):(\\d{1,25})$`).exec(customId);
  const action = BIRTH_DATE_ACTIONS.find((known) => known === match?.[1]);
  return match && action ? { action, userId: match[2] } : null;
}

// The panel.

/** What to show: a Components V2 view, edited in place by its buttons. */
export interface IBirthDateView {
  components: APIMessageTopLevelComponent[];
  flags: number;
  allowedMentions: { parse: [] };
}

/** Who acts (the clicking or typing member) and whose Birth Date it is. */
export interface IBirthDateTarget {
  actingUserId: string;
  targetUserId: string;
}

export interface IBirthDateDeps {
  api?: IBirthDateApi;
}

function view(container: ContainerBuilder, buttons: ButtonBuilder[] = []): IBirthDateView {
  const components: APIMessageTopLevelComponent[] = [container.toJSON()];
  if (buttons.length) {
    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons).toJSON());
  }
  return { components, flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

function textView(content: string): IBirthDateView {
  return view(buildTextContainer(content));
}

function separator(): SeparatorBuilder {
  return new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true);
}

function button(
  label: string,
  style: ButtonStyle,
  action: BirthDateButtonAction,
  userId: string,
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(buildBirthDateId(action, userId))
    .setLabel(label)
    .setStyle(style);
}

const isOwn = (target: IBirthDateTarget): boolean =>
  target.actingUserId === target.targetUserId;

function footer(document: IBirthDateDocument, own: boolean): string {
  const left = document.changesLeftThisMonth;
  const next = document.nextChangeOn ? formatBirthDate(document.nextChangeOn) : null;
  if (own) {
    const changes = left <= 0 && next
      ? `No Birth Date changes left until ${next}`
      : `${plural(left, "Birth Date change")} left this month`;
    return `-# ${changes} · sharing doesn't count`;
  }
  const changes = left <= 0 && next
    ? `They can change it again on ${next}`
    : `${plural(left, "Birth Date change")} left for them this month`;
  return `-# ${changes} · staff changes don't count`;
}

/** Whether the Birthday is shared, with the button that flips it (staff only stop it). */
function sharingBlock(
  document: IBirthDateDocument,
  dayMonth: string,
  target: IBirthDateTarget,
): SectionBuilder | ReturnType<typeof buildTextDisplay> {
  const own = isOwn(target);
  const shared = document.birthdayShared;
  const status = `**Birthday: ${shared ? "Shared" : "Not shared"}**`;
  let detail: string;
  if (shared) {
    detail = `Members see ${dayMonth} in Upcoming Birthdays, and ` +
      `${own ? "you get" : "they get"} a Birthday Post.`;
  } else {
    detail = own
      ? "Members don't see it, and there's no Birthday Post for you."
      : `Members don't see it. Only ${userMention(target.targetUserId)} can share it.`;
  }
  const text = buildTextDisplay(`${status}\n-# ${detail}`);
  if (!shared && !own) return text;
  return new SectionBuilder()
    .addTextDisplayComponents(text)
    .setButtonAccessory(shared
      ? button("Stop sharing", ButtonStyle.Secondary, "share-off", target.targetUserId)
      : button("Share it", ButtonStyle.Success, "share-on", target.targetUserId));
}

function panel(
  document: IBirthDateDocument,
  target: IBirthDateTarget,
  notice?: string,
): IBirthDateView {
  const own = isOwn(target);
  const userId = target.targetUserId;
  const heading = own ? "### Your Birth Date" : `### ${userMention(userId)}'s Birth Date`;
  const container = new ContainerBuilder();
  if (notice) {
    container.addTextDisplayComponents(buildTextDisplay(notice));
    container.addSeparatorComponents(separator());
  }

  if (!document.birthDate) {
    const lines = own
      ? [
        "-# Only you and staff ever see your Birth Date. " +
          "Shared, members see just the day and month.",
      ]
      : ["-# Only they and staff see it, and only they can share their Birthday."];
    if (document.changesLeftThisMonth <= 0 && document.nextChangeOn) {
      lines.push(`-# ${own ? "You" : "They"} can enter it again on ` +
        `${formatBirthDate(document.nextChangeOn)}.`);
    }
    container
      .addTextDisplayComponents(buildTextDisplay(own
        ? `${heading}\nNot entered yet. Sharing your Birthday needs one; the year is optional.`
        : `${heading}\nNot entered yet.`))
      .addSeparatorComponents(separator())
      .addTextDisplayComponents(buildTextDisplay(lines.join("\n")));
    return view(container, [button("Enter Birth Date", ButtonStyle.Primary, "date", userId)]);
  }

  const dayMonth = formatBirthDate(document.birthDate.slice(-5));
  const date = document.birthDate.length === 5
    ? `**${dayMonth}** · no year`
    : `**${formatBirthDate(document.birthDate)}**`;
  container.addTextDisplayComponents(buildTextDisplay(
    `${heading}\n${date}\n-# Only ${own ? "you" : "they"} and staff see this.`,
  ));
  container.addSeparatorComponents(separator());
  const sharing = sharingBlock(document, dayMonth, target);
  if (sharing instanceof SectionBuilder) container.addSectionComponents(sharing);
  else container.addTextDisplayComponents(sharing);
  container
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(buildTextDisplay(footer(document, own)));
  return view(container, [
    button("Change date", ButtonStyle.Secondary, "date", userId),
    button("Remove Birth Date", ButtonStyle.Danger, "remove", userId),
  ]);
}

/** The refusal with its request and response (no dev ping: nothing is broken). */
function refusalNotice(friendly: string, err: unknown): string {
  return buildApiErrorMessage(friendly, err, { devPing: false });
}

/** The panel as it stands, under `notice`; a refusal of the read itself replaces it. */
async function panelReply(
  target: IBirthDateTarget,
  api: IBirthDateApi,
  notice?: string,
): Promise<IBirthDateView> {
  try {
    return panel(await api.getBirthDate(target.targetUserId, target.actingUserId), target,
      notice);
  } catch (err: unknown) {
    const friendly = birthDateRefusalLine(err, target.targetUserId, BIRTH_DATE_ENTRY_HINT);
    if (!friendly) throw err;
    return textView(refusalNotice(friendly, err));
  }
}

function changedNotice(
  change: IBirthDateChange,
  document: IBirthDateDocument,
  target: IBirthDateTarget,
): string | undefined {
  if (!("birthDate" in change)) return undefined;
  const whose = isOwn(target) ? "Your" : `${userMention(target.targetUserId)}'s`;
  return document.birthDate
    ? `Saved. ${whose} Birth Date is now **${formatBirthDate(document.birthDate)}**.`
    : `${whose} Birth Date is removed.`;
}

/**
 * Applies `change` and shows the panel. A refusal the member can act on is shown above the
 * panel with the request and response; sharing without a Birth Date shows the API's hint
 * on the empty panel; any other API error is thrown for the command's error reply.
 */
async function changeReply(
  target: IBirthDateTarget,
  change: IBirthDateChange,
  api: IBirthDateApi,
): Promise<IBirthDateView> {
  try {
    const document = await api.updateBirthDate(target.targetUserId, change,
      target.actingUserId);
    return panel(document, target, changedNotice(change, document, target));
  } catch (err: unknown) {
    const needsDate = sharingNeedsBirthDate(err);
    if (needsDate) return panelReply(target, api, needsDate);
    const status = responseOf(err)?.status;
    const sharingSomeoneElses = change.birthdayShared === true && !isOwn(target);
    if (status === 403 && sharingSomeoneElses) {
      return panelReply(target, api, refusalNotice(
        `Only ${userMention(target.targetUserId)} can share their Birthday. ` +
          "Staff can stop sharing it, but never turn it on.",
        err,
      ));
    }
    const friendly = birthDateRefusalLine(err, target.targetUserId, BIRTH_DATE_ENTRY_HINT);
    if (!friendly) throw err;
    if (status !== 422) return textView(refusalNotice(friendly, err));
    return panelReply(target, api, refusalNotice(friendly, err));
  }
}

function unreadableNotice(typed: string): string {
  const shown = typed.replace(/`/g, "").slice(0, 40);
  return `That isn't a date the bot can read: \`${shown}\`. ${BIRTH_DATE_ENTRY_HINT}`;
}

export interface IBirthDateCommandInput extends IBirthDateTarget {
  /** What the member typed in `date:`. */
  date?: string;
  remove?: boolean;
  share?: boolean;
}

/**
 * `/profile birth-date`: shows the target's panel, after setting or removing the Birth
 * Date and turning sharing on or off as asked, all in one update.
 */
export async function birthDateCommandReply(
  input: IBirthDateCommandInput,
  deps: IBirthDateDeps = {},
): Promise<IBirthDateView> {
  const api = deps.api ?? BIRTH_DATE_API;
  const typed = input.date?.trim() ?? "";
  if (typed && input.remove) return textView("Pick a date or remove, not both.");
  if (input.remove && input.share) {
    return textView("Removing a Birth Date stops sharing its Birthday, so pick one.");
  }
  const change: IBirthDateChange = {};
  if (typed) {
    const birthDate = parseBirthDateInput(typed);
    if (!birthDate) return panelReply(input, api, unreadableNotice(typed));
    change.birthDate = birthDate;
  } else if (input.remove) {
    change.birthDate = null;
  }
  if (input.share !== undefined) change.birthdayShared = input.share;
  if (!("birthDate" in change) && change.birthdayShared === undefined) {
    return panelReply(input, api);
  }
  return changeReply(input, change, api);
}

function outOfDate(what: "button" | "form"): IBirthDateView {
  return textView(`This ${what} is out of date. ` +
    `Run ${commandMention("profile birth-date")} again.`);
}

/** The asking member's confirmation before a Birth Date is removed. */
function removeConfirmView(target: IBirthDateTarget): IBirthDateView {
  const text = isOwn(target)
    ? "Remove your Birth Date? Your Birthday stops being shared, and it counts as one " +
      "of this month's two Birth Date changes."
    : `Remove ${userMention(target.targetUserId)}'s Birth Date? ` +
      "Their Birthday stops being shared.";
  return view(buildTextContainer(text), [
    button("Remove it", ButtonStyle.Danger, "remove-yes", target.targetUserId),
    button("Keep it", ButtonStyle.Secondary, "keep", target.targetUserId),
  ]);
}

/**
 * A panel button other than Change date (which opens the modal): share, stop sharing,
 * remove (asks first) or keep. Returns the panel to edit in place.
 */
export async function birthDateButtonReply(
  input: { customId: string; actingUserId: string },
  deps: IBirthDateDeps = {},
): Promise<IBirthDateView> {
  const api = deps.api ?? BIRTH_DATE_API;
  const parsed = parseBirthDateId(input.customId);
  if (!parsed) return outOfDate("button");
  const target = { actingUserId: input.actingUserId, targetUserId: parsed.userId };
  switch (parsed.action) {
    case "share-on":
      return changeReply(target, { birthdayShared: true }, api);
    case "share-off":
      return changeReply(target, { birthdayShared: false }, api);
    case "remove":
      return removeConfirmView(target);
    case "remove-yes":
      return changeReply(target, { birthDate: null }, api);
    case "keep":
      return panelReply(target, api);
    default:
      return outOfDate("button");
  }
}

/** The custom ID of the Birth Date modal's one field. */
export const BIRTH_DATE_ENTRY_FIELD = "birth-date-entry";

/** The modal behind Change date and Enter Birth Date, or null for another custom ID. */
export function buildBirthDateEntryModal(
  customId: string,
  actingUserId: string,
): ModalBuilder | null {
  const parsed = parseBirthDateId(customId);
  if (parsed?.action !== "date") return null;
  const own = parsed.userId === actingUserId;
  return new ModalBuilder()
    .setCustomId(buildBirthDateId("date-modal", parsed.userId))
    .setTitle(own ? "Your Birth Date" : "Their Birth Date")
    .addLabelComponents(new LabelBuilder()
      .setLabel("Birth Date")
      .setDescription("YYYY-MM-DD, or leave out the year: MM-DD or 4 May.")
      .setTextInputComponent(new TextInputBuilder()
        .setCustomId(BIRTH_DATE_ENTRY_FIELD)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("4 May")
        .setMaxLength(40)
        .setRequired(true)));
}

/** The modal's answer: sets the Birth Date it names, then shows the panel in place. */
export async function birthDateModalReply(
  input: { customId: string; actingUserId: string; date: string },
  deps: IBirthDateDeps = {},
): Promise<IBirthDateView> {
  const parsed = parseBirthDateId(input.customId);
  if (parsed?.action !== "date-modal") return outOfDate("form");
  return birthDateCommandReply(
    { actingUserId: input.actingUserId, targetUserId: parsed.userId, date: input.date },
    deps,
  );
}
