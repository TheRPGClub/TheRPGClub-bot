/**
 * `/birthdays` (spec api#396, bot#1558): the Upcoming Birthdays, the shared Birthdays in the
 * next 30 days, as a private reply. Design pick 2B, "Countdown": grouped into Today, This
 * week, Next week and Later, with a plain countdown on each date. The API decides who is
 * listed and when each Birthday falls (29 February, the year end); the bot only groups.
 */

import { ContainerBuilder, SeparatorBuilder } from "@discordjs/builders";
import {
  MessageFlags,
  SeparatorSpacingSize,
  type APIMessageTopLevelComponent,
} from "discord-api-types/v10";
import { userMention } from "discord.js";
import { DateTime } from "luxon";

import { DISCORD_V2_TEXT_MAX, MAX_CONTAINER_TEXT } from "../config/textLimits.js";
import { buildTextDisplay } from "../functions/ComponentsV2Utils.js";
import { VOTE_TIME_ZONE } from "../functions/VoteDateUtils.js";
import { logWarn } from "../utilities/LogUtils.js";
import { plural } from "../utilities/TextUtils.js";
import { apiGetOrThrow } from "./RpgClubApiClient.js";

/** The club's day decides which Birthdays are today, as the API's Birthdays::TIME_ZONE. */
export const BIRTHDAY_TIME_ZONE = VOTE_TIME_ZONE;

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

/** A shared Birthday's day and month. */
export interface ISharedBirthday {
  month: number;
  day: number;
}

export interface IBirthdaysApi {
  /** GET /api/v1/birthdays/upcoming, soonest first. */
  listUpcoming(): Promise<IUpcomingBirthday[]>;
  /** The member's own Birthday when they share it, else null (their Birth Date document). */
  getSharedBirthday(userId: string): Promise<ISharedBirthday | null>;
}

type UpcomingBirthdayPayload = {
  user_id: string;
  display_name: string;
  month: number;
  day: number;
  on: string;
  today: boolean;
};

type BirthDatePayload = {
  birth_date: string | null;
  birthday_shared?: boolean;
};

/** The day and month of "1990-05-04" or "05-04", or null for anything else. */
function birthdayOf(birthDate: string | null): ISharedBirthday | null {
  const match = birthDate?.match(/(\d{2})-(\d{2})$/);
  if (!match) return null;
  return { month: Number(match[1]), day: Number(match[2]) };
}

export const BIRTHDAYS_API: IBirthdaysApi = {
  async listUpcoming() {
    const payload = await apiGetOrThrow<{ data: UpcomingBirthdayPayload[] }>(
      "/api/v1/birthdays/upcoming",
    );
    return payload.data.map((item) => ({
      userId: item.user_id,
      displayName: item.display_name,
      month: item.month,
      day: item.day,
      on: item.on,
      today: item.today,
    }));
  },
  async getSharedBirthday(userId) {
    // The member reads their own Birth Date document, so the bot acts as them.
    const query = new URLSearchParams({ acting_user_id: userId });
    const payload = await apiGetOrThrow<{ data: BirthDatePayload }>(
      `/api/v1/users/${encodeURIComponent(userId)}/birth_date?${query.toString()}`,
    );
    return payload.data.birthday_shared ? birthdayOf(payload.data.birth_date) : null;
  },
};

export interface IUpcomingBirthdaysDeps {
  api?: IBirthdaysApi;
  now?: () => Date;
}

export interface IUpcomingBirthdaysView {
  components: APIMessageTopLevelComponent[];
  flags: number;
  allowedMentions: { parse: [] };
}

type GroupName = "Today" | "This week" | "Next week" | "Later";

const GROUP_HEADINGS: Readonly<Record<GroupName, string>> = {
  "Today": "### 🎂 Today",
  "This week": "### This week",
  "Next week": "### Next week",
  "Later": "### Later",
};

const HEADING = "## Upcoming Birthdays";
const EMPTY_STATE = "Nobody's Birthday falls in the next 30 days.";
const SHARE_NUDGE =
  "You're not sharing your Birthday. Turn it on with `/profile birth-date share:True`.";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "4 May" for a Birthday, the day and month in words. */
export function birthdayInWords(birthday: ISharedBirthday): string {
  return `${birthday.day} ${MONTHS[birthday.month - 1] ?? birthday.month}`;
}

/** "<@1>", "<@1> and <@2>", "<@1>, <@2> and <@3>". */
function mentionList(userIds: string[]): string {
  const mentions = userIds.map((id) => userMention(id));
  if (mentions.length <= 1) return mentions.join("");
  return `${mentions.slice(0, -1).join(", ")} and ${mentions[mentions.length - 1]}`;
}

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
    const names = mentionList(members.map((member) => member.userId));
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

function footer(shared: ISharedBirthday | null): string {
  return shared ? `You're sharing yours: ${birthdayInWords(shared)}.` : SHARE_NUDGE;
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
  const [birthdays, shared] = await Promise.all([
    api.listUpcoming(),
    api.getSharedBirthday(actingUserId).then(
      (birthday): { birthday: ISharedBirthday | null } => ({ birthday }),
      (err: unknown) => {
        logWarn("UpcomingBirthdays.sharedBirthday", err);
        return null;
      },
    ),
  ]);

  const footerText = shared ? `-# ${footer(shared.birthday)}` : null;
  const lines = dateLines(birthdays, now);
  const body = lines.length
    ? fittedGroupTexts(lines, HEADING.length + (footerText?.length ?? 0))
    : [EMPTY_STATE];

  const container = new ContainerBuilder();
  for (const text of [HEADING, ...body]) {
    container.addTextDisplayComponents(buildTextDisplay(text));
  }
  if (footerText) {
    container
      .addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
      )
      .addTextDisplayComponents(buildTextDisplay(footerText));
  }
  return {
    components: [container.toJSON()],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}
