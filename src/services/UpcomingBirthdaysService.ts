/**
 * `/birthdays` (spec api#396, bot#1558): the Upcoming Birthdays, the shared Birthdays in the
 * next 30 days, as a private reply. Design pick 2B, "Countdown": grouped into Today, This
 * week, Next week and Later, with a plain countdown on each date. The API decides who is
 * listed and when each Birthday falls (29 February, the year end); the bot only groups.
 */

import { ContainerBuilder } from "@discordjs/builders";
import { MessageFlags } from "discord-api-types/v10";
import { userMention } from "discord.js";
import { DateTime } from "luxon";

import { BIRTHDAY_TIME_ZONE } from "../config/birthdays.js";
import { DISCORD_V2_TEXT_MAX, MAX_CONTAINER_TEXT } from "../config/textLimits.js";
import {
  buildDivider,
  buildTextDisplay,
  type ISilentV2View,
} from "../functions/ComponentsV2Utils.js";
import { logWarn } from "../utilities/LogUtils.js";
import { joinWithAnd, plural } from "../utilities/TextUtils.js";
import { BIRTH_DATE_API, formatBirthDate } from "./BirthDateService.js";
import { apiGetOrThrow } from "./RpgClubApiClient.js";

/** One Upcoming Birthday: who, its day and month, and the club date it falls on. */
export interface IUpcomingBirthday {
  userId: string;
  displayName: string;
  month: number;
  day: number;
  /** YYYY-MM-DD in club time; a 29 February Birthday falls on 28 February in other years. */
  on: string;
  today: boolean;
}

/** The first shared Birthday after the 30 days, with no member. */
export interface INextBirthday {
  month: number;
  day: number;
  /** YYYY-MM-DD in club time. */
  on: string;
}

/** The Upcoming Birthdays and, past them, when the next shared one falls. */
export interface IUpcomingBirthdays {
  /** Soonest first. */
  birthdays: IUpcomingBirthday[];
  /** Null when nobody else shares, or when the API predates it. */
  next: INextBirthday | null;
}

export interface IBirthdaysApi {
  /** GET /api/v1/birthdays/upcoming. */
  listUpcoming(): Promise<IUpcomingBirthdays>;
  /** The member's own Birthday as "MM-DD" when they share it, else null. */
  getSharedBirthday(userId: string): Promise<string | null>;
}

type UpcomingBirthdayPayload = {
  user_id: string;
  display_name: string;
  month: number;
  day: number;
  on: string;
  today: boolean;
};

type UpcomingBirthdaysPayload = {
  data: UpcomingBirthdayPayload[];
  /** Added with the bot's empty state; an older API leaves it out. */
  next?: INextBirthday | null;
};

/** The upcoming read as the bot uses it. */
export function upcomingBirthdaysFrom(payload: UpcomingBirthdaysPayload): IUpcomingBirthdays {
  const next = payload.next
    ? { month: payload.next.month, day: payload.next.day, on: payload.next.on }
    : null;
  return {
    birthdays: payload.data.map((item) => ({
      userId: item.user_id,
      displayName: item.display_name,
      month: item.month,
      day: item.day,
      on: item.on,
      today: item.today,
    })),
    next,
  };
}

export const BIRTHDAYS_API: IBirthdaysApi = {
  async listUpcoming() {
    return upcomingBirthdaysFrom(
      await apiGetOrThrow<UpcomingBirthdaysPayload>("/api/v1/birthdays/upcoming"),
    );
  },
  async getSharedBirthday(userId) {
    // The member reads their own Birth Date document, so the bot acts as them.
    const document = await BIRTH_DATE_API.getBirthDate(userId, userId);
    if (!document.birthdayShared || !document.birthDate) return null;
    return document.birthDate.slice(-"MM-DD".length);
  },
};

export interface IUpcomingBirthdaysDeps {
  api?: IBirthdaysApi;
  now?: () => Date;
}

export type IUpcomingBirthdaysView = ISilentV2View;

type GroupName = "Today" | "This week" | "Next week" | "Later";

const GROUP_HEADINGS: Readonly<Record<GroupName, string>> = {
  "Today": "### 🎂 Today",
  "This week": "### This week",
  "Next week": "### Next week",
  "Later": "### Later",
};

const HEADING = "## Upcoming Birthdays";
const EMPTY_STATE = "Nobody's Birthday falls in the next 30 days.";

/** The empty state, naming the next shared Birthday when there is one. */
function emptyState(next: INextBirthday | null): string {
  if (!next) return EMPTY_STATE;
  const date = DateTime.fromISO(next.on, { zone: BIRTHDAY_TIME_ZONE });
  if (!date.isValid) return EMPTY_STATE;
  return `${EMPTY_STATE} The next shared one is on **${date.setLocale("en-GB").toFormat("d LLLL")}**.`;
}
const SHARE_NUDGE =
  "You're not sharing your Birthday. Turn it on with `/profile birth-date share:True`.";

function countdown(days: number): string {
  return days === 1 ? "tomorrow" : `in ${plural(days, "day")}`;
}

/** The group a date falls in: weeks run Monday to Sunday, in club time. */
function groupOf(on: DateTime, today: DateTime): GroupName {
  if (on <= today) return "Today";
  const weekStart = today.startOf("week");
  if (on < weekStart.plus({ weeks: 1 })) return "This week";
  if (on < weekStart.plus({ weeks: 2 })) return "Next week";
  return "Later";
}

/** One date's line in a group, and how many Birthdays it names. */
interface IDateLine {
  group: GroupName;
  text: string;
  count: number;
}

/** One line per date, naming everyone whose Birthday falls on it, soonest first. */
function dateLines(birthdays: IUpcomingBirthday[], now: Date): IDateLine[] {
  const today = DateTime.fromJSDate(now, { zone: BIRTHDAY_TIME_ZONE }).startOf("day");
  const byDate = new Map<string, IUpcomingBirthday[]>();
  for (const birthday of birthdays) {
    byDate.set(birthday.on, [...(byDate.get(birthday.on) ?? []), birthday]);
  }
  return [...byDate].map(([on, members]) => {
    const date = DateTime.fromISO(on, { zone: BIRTHDAY_TIME_ZONE }).startOf("day");
    const group = members.some((member) => member.today) ? "Today" : groupOf(date, today);
    const names = joinWithAnd(members.map((member) => userMention(member.userId)));
    const days = Math.round(date.diff(today, "days").days);
    const text = group === "Today"
      ? names
      : `${names} · ${date.setLocale("en-GB").toFormat("ccc d LLL")} · ${countdown(days)}`;
    return { group, text, count: members.length };
  });
}

/** Each group's text display: its heading, its dates, and "and N more" after the last. */
function groupTexts(lines: IDateLine[], hidden: number): string[] {
  const texts: string[] = [];
  for (const [group, heading] of Object.entries(GROUP_HEADINGS) as [GroupName, string][]) {
    const inGroup = lines.filter((line) => line.group === group).map((line) => line.text);
    if (inGroup.length) texts.push([heading, ...inGroup].join("\n"));
  }
  if (hidden > 0 && texts.length) {
    texts[texts.length - 1] += `\nand ${plural(hidden, "more Birthday")}.`;
  }
  return texts;
}

/**
 * The groups' text displays, leaving the latest dates out (and counting them) while one
 * would be cut short or the reply would be over Discord's text limit with the heading and
 * footer around it.
 */
function fittedGroupTexts(lines: IDateLine[], aroundLength: number): string[] {
  const shown = [...lines];
  let hidden = 0;
  let texts = groupTexts(shown, hidden);
  // A text display holds MAX_CONTAINER_TEXT; the newline between displays is counted too.
  const tooLong = (parts: string[]): boolean =>
    parts.some((part) => part.length > MAX_CONTAINER_TEXT) ||
    parts.reduce((sum, part) => sum + part.length + 1, aroundLength) > DISCORD_V2_TEXT_MAX;
  while (shown.length && tooLong(texts)) {
    hidden += shown.pop()?.count ?? 0;
    texts = groupTexts(shown, hidden);
  }
  return texts;
}

function footer(shared: string | null): string {
  return shared ? `You're sharing yours: ${formatBirthDate(shared)}.` : SHARE_NUDGE;
}

/**
 * The private `/birthdays` reply for the acting member. A failed Upcoming Birthdays read
 * throws for the command's error reply; the footer about the member's own sharing is left
 * out when their Birth Date can't be read, since the list is what they asked for.
 */
export async function buildUpcomingBirthdaysView(
  actingUserId: string,
  deps: IUpcomingBirthdaysDeps = {},
): Promise<IUpcomingBirthdaysView> {
  const api = deps.api ?? BIRTHDAYS_API;
  const now = deps.now?.() ?? new Date();
  const [upcoming, shared] = await Promise.all([
    api.listUpcoming(),
    api.getSharedBirthday(actingUserId).then(
      (birthday): { birthday: string | null } => ({ birthday }),
      (err: unknown) => {
        logWarn("UpcomingBirthdays.sharedBirthday", err);
        return null;
      },
    ),
  ]);

  const footerText = shared ? `-# ${footer(shared.birthday)}` : null;
  const lines = dateLines(upcoming.birthdays, now);
  const body = lines.length
    ? fittedGroupTexts(lines, HEADING.length + (footerText?.length ?? 0))
    : [emptyState(upcoming.next)];

  const container = new ContainerBuilder();
  for (const text of [HEADING, ...body]) {
    container.addTextDisplayComponents(buildTextDisplay(text));
  }
  if (footerText) {
    container
      .addSeparatorComponents(
        buildDivider(),
      )
      .addTextDisplayComponents(buildTextDisplay(footerText));
  }
  return {
    components: [container.toJSON()],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}
