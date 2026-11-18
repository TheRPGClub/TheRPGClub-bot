import {
  channelMention,
  DiscordAPIError,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
  userMention,
  type Client,
} from "discord.js";
import { DateTime } from "luxon";
import { BIRTHDAY_TIME_ZONE } from "../config/birthdays.js";
import { BIRTHDAY_TEST_CHANNEL_ID, BOT_DEV_CHANNEL_ID } from "../config/channels.js";
import { HOME_GUILD_ID } from "../config/guilds.js";
import { describeRequestError } from "../utilities/ApiErrorUtils.js";
import { logError } from "../utilities/LogUtils.js";
import { joinWithAnd } from "../utilities/TextUtils.js";
import { BotJobStepError, isTemporaryJobError } from "./BotJobErrors.js";
import { fetchImageBuffer } from "./GameImageService.js";
import { bannerDescription, composeBirthdayBanner } from "./BirthdayBanner.js";
import { BIRTHDAYS_API, type IBirthdaysApi } from "./UpcomingBirthdaysService.js";

// The Birthday Post (spec api#396, bot#1559): one message a club day in the general chat
// channel greeting every member whose shared Birthday it is. Design picks 1A + 1C: plain
// message text that pings each member and closes with a line from the club, over a
// generated "HAPPY BIRTHDAY" banner with their avatars.

/** A member being greeted, as Discord has them now. */
export interface IBirthdayMember {
  userId: string;
  /** Their name in the server: nickname, else global name, else username. */
  name: string;
  /** Their avatar, or null when it could not be downloaded (an initial is drawn). */
  avatar: Buffer | null;
}

/** The message as the bot sends it: plain content, the banner attached. */
export interface IBirthdayPost {
  content: string;
  /** Only these members' mentions ping. */
  pingUserIds: string[];
  files: { name: string; data: Buffer; description: string }[];
}

/** What the Birthday Post reads and posts; tests pass a fake. */
export interface IBirthdayPostDeps {
  /** Today's club day, as an ISO date. Throws when the clock can't give one. */
  clubToday(): string;
  /** The member in the home server; null when they are no longer in it. */
  fetchMember(userId: string): Promise<IBirthdayMember | null>;
  /**
   * The members whose shared Birthday falls on `clubDate`, read from the API's Upcoming
   * Birthdays now (active members who share only). Throws when it can't be read.
   */
  sharingOn(clubDate: string): Promise<ReadonlySet<string>>;
  /** Posts to a text channel. Throws the discord.js error, or when it can't hold posts. */
  postMessage(channelId: string, post: IBirthdayPost): Promise<void>;
  /**
   * The members the bot's own Birthday Posts for `clubDate` in the channel already greeted,
   * read from Discord so it survives a restart. Throws the discord.js error, or when the bot
   * lacks the permission to read the channel's history (Discord would answer that with an
   * empty list, which would look like nobody greeted).
   */
  greetedOn(channelId: string, clubDate: string): Promise<ReadonlySet<string>>;
  /** Warns staff in the bot-dev channel. Never throws: a failed warning is logged. */
  warnStaff(message: string): Promise<void>;
}

/** Pages of 100 messages read back for the day's Birthday Posts, at most. */
const GREETED_SCAN_PAGES = 5;
const MESSAGES_PER_PAGE = 100;
const MENTION_PATTERN = /<@!?(\d+)>/g;

/** The banner's file name, carrying the club day so that day's posts can be found again. */
export function bannerFileName(clubDate: string): string {
  return `happy-birthday-${clubDate}.png`;
}

const NUMBER_WORDS = ["", "", "", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/**
 * The post's last line: "Have a great day, from everyone at the club.", and with several
 * members "Have a great day, all three of you, from everyone at the club."
 */
export function closingLine(count: number): string {
  if (count <= 1) return "Have a great day, from everyone at the club.";
  const who = count === 2 ? "both of you" : `all ${NUMBER_WORDS[count] ?? count} of you`;
  return `Have a great day, ${who}, from everyone at the club.`;
}

/** The message text: a heading that pings every member, then the closing line. */
export function birthdayPostContent(userIds: readonly string[]): string {
  const mentions = joinWithAnd(userIds.map((id) => userMention(id)));
  return `## 🎂 Happy Birthday, ${mentions}!\n${closingLine(userIds.length)}`;
}

/** "18 November", for the banner's top line. */
export function clubDateLabel(clubDate: string): string {
  return DateTime.fromISO(clubDate, { zone: BIRTHDAY_TIME_ZONE }).toFormat("d LLLL");
}

function isUnknownMember(err: unknown): boolean {
  return err instanceof DiscordAPIError &&
    (err.code === RESTJSONErrorCodes.UnknownMember || err.code === RESTJSONErrorCodes.UnknownUser);
}

/** The permissions the redelivery guard needs to see the channel's earlier messages. */
const HISTORY_PERMISSIONS: readonly [bigint, string][] = [
  [PermissionFlagsBits.ViewChannel, "View Channel"],
  [PermissionFlagsBits.ReadMessageHistory, "Read Message History"],
];

/** What the live deps read besides Discord; tests pass fakes. */
export interface IBirthdayPostSources {
  api?: Pick<IBirthdaysApi, "listUpcoming">;
  fetchImage?: (url: string) => Promise<Buffer | null>;
}

export function createBirthdayPostDeps(
  client: Client,
  sources: IBirthdayPostSources = {},
): IBirthdayPostDeps {
  const api = sources.api ?? BIRTHDAYS_API;
  const fetchImage = sources.fetchImage ?? fetchImageBuffer;
  return {
    clubToday: () => {
      const today = DateTime.now().setZone(BIRTHDAY_TIME_ZONE).toISODate();
      if (!today) throw new Error(`The clock gives no date in ${BIRTHDAY_TIME_ZONE}.`);
      return today;
    },
    fetchMember: async (userId) => {
      try {
        const guild = await client.guilds.fetch(HOME_GUILD_ID);
        const member = await guild.members.fetch(userId);
        const avatarUrl = member.displayAvatarURL({
          extension: "png",
          size: 512,
          forceStatic: true,
        });
        return { userId, name: member.displayName, avatar: await fetchImage(avatarUrl) };
      } catch (err: unknown) {
        if (isUnknownMember(err)) return null;
        throw err;
      }
    },
    sharingOn: async (clubDate) => {
      const { birthdays } = await api.listUpcoming();
      return new Set(birthdays.filter((b) => b.on === clubDate).map((b) => b.userId));
    },
    postMessage: async (channelId, post) => {
      const channel = await client.channels.fetch(channelId);
      if (!channel || !channel.isSendable()) {
        throw new Error(`Channel ${channelId} is missing or the bot cannot post in it.`);
      }
      await channel.send({
        content: post.content,
        files: post.files.map((file) => ({
          attachment: file.data,
          name: file.name,
          description: file.description,
        })),
        allowedMentions: { users: post.pingUserIds },
      });
    },
    greetedOn: async (channelId, clubDate) => {
      const greeted = new Set<string>();
      const channel = await client.channels.fetch(channelId);
      // A missing channel is postMessage's to report.
      if (!channel || !channel.isTextBased()) return greeted;
      if (!channel.isDMBased() && client.user) {
        const permissions = channel.permissionsFor(client.user);
        const missing = HISTORY_PERMISSIONS
          .filter(([flag]) => !permissions?.has(flag))
          .map(([, name]) => name);
        if (missing.length) {
          throw new Error(
            `The bot lacks ${joinWithAnd(missing)} in ${channelMention(channelId)}.`,
          );
        }
      }
      const dayStart = DateTime.fromISO(clubDate, { zone: BIRTHDAY_TIME_ZONE }).toMillis();
      const fileName = bannerFileName(clubDate);
      let before: string | undefined;
      for (let page = 0; page < GREETED_SCAN_PAGES; page++) {
        const batch = await channel.messages.fetch({
          limit: MESSAGES_PER_PAGE,
          ...(before ? { before } : {}),
        });
        for (const message of batch.values()) {
          const ours = message.author.id === client.user?.id &&
            message.attachments.some((file) => file.name === fileName);
          if (!ours) continue;
          for (const match of message.content.matchAll(MENTION_PATTERN)) greeted.add(match[1]!);
        }
        const oldest = batch.last();
        if (!oldest || batch.size < MESSAGES_PER_PAGE || oldest.createdTimestamp < dayStart) {
          break;
        }
        before = oldest.id;
      }
      return greeted;
    },
    warnStaff: async (message) => {
      try {
        const channel = await client.channels.fetch(BOT_DEV_CHANNEL_ID);
        if (!channel?.isSendable()) {
          throw new Error(
            `Channel ${BOT_DEV_CHANNEL_ID} is missing or the bot cannot post in it.`,
          );
        }
        await channel.send({ content: message, allowedMentions: { parse: [] } });
      } catch (err: unknown) {
        logError("BirthdayPost.warnStaff", err);
      }
    },
  };
}

/** Who the day's earlier Birthday Posts greeted, or why that could not be checked. */
interface IGreetedCheck {
  greeted: ReadonlySet<string>;
  /** Set when the channel's history could not be read, so nobody counts as greeted. */
  unchecked: string | null;
}

/**
 * Who the day's earlier Birthday Posts greeted. A scan that fails for good (the bot can't
 * read the channel's history) counts as nobody greeted, so the Birthday still goes out,
 * and staff are warned in the bot-dev channel, since a repeat of the job could then greet
 * members twice. A temporary failure is thrown for the lease to retry.
 */
async function alreadyGreeted(
  channelId: string,
  clubDate: string,
  deps: IBirthdayPostDeps,
): Promise<IGreetedCheck> {
  try {
    return { greeted: await deps.greetedOn(channelId, clubDate), unchecked: null };
  } catch (err: unknown) {
    if (isTemporaryJobError(err)) throw err;
    logError("BirthdayPost.alreadyGreeted", err);
    const reason = describeRequestError(err);
    await deps.warnStaff(
      `The Birthday Post for ${clubDate} could not read ${channelMention(channelId)}'s ` +
        `history to check who an earlier post that day greeted, so it posts without ` +
        `checking, and a repeat of the job could greet members twice. ${reason}\n` +
        "The bot needs View Channel and Read Message History there.",
    );
    return { greeted: new Set(), unchecked: reason };
  }
}

const SNOWFLAKE = /^\d+$/;

function payloadUserIds(payload: Record<string, unknown>): string[] {
  const ids = payload.user_ids;
  if (
    !Array.isArray(ids) || !ids.length ||
    !ids.every((id) => typeof id === "string" && SNOWFLAKE.test(id))
  ) {
    throw new Error(`Invalid payload: user_ids must be a non-empty array of Discord user ids, ` +
      `got ${JSON.stringify(ids)}.`);
  }
  return [...new Set(ids as string[])];
}

function payloadClubDate(payload: Record<string, unknown>): string {
  const value = payload.club_date;
  if (typeof value !== "string" || DateTime.fromISO(value).toISODate() !== value) {
    throw new Error(`Invalid payload: club_date must be an ISO date (YYYY-MM-DD), got ${
      JSON.stringify(value)
    }.`);
  }
  return value;
}

function payloadChannelId(payload: Record<string, unknown>): string {
  const value = payload.channel_id;
  if (typeof value !== "string" || !SNOWFLAKE.test(value)) {
    throw new Error("Invalid payload: channel_id must be a Discord channel id, got " +
      `${JSON.stringify(value)}.`);
  }
  return value;
}

/**
 * Where the post goes: the payload's channel (the API's general chat), unless the bot runs
 * in the test guild, where it always posts in the test guild's own Birthday channel, so a
 * dev bot can never ping the real general chat.
 */
function postChannel(payloadChannel: string, testChannelId: string | null): string {
  if (testChannelId === null) return payloadChannel;
  if (!testChannelId) {
    throw new Error("The test guild has no Birthday channel (BIRTHDAY_CHANNEL_ID), so " +
      "nothing was posted.");
  }
  return testChannelId;
}

/**
 * Payload `{ club_date, user_ids, channel_id }` (BirthdayPostJobPayload): posts the
 * Birthday Post in `channel_id`, or in `testChannelId` when the bot runs in the test guild.
 * A job whose club day has passed in New York is dropped, so nobody is greeted on the wrong
 * day. Left out: members an earlier Birthday Post that day already greeted, members who
 * left the server, and, read from the API right before posting, members no longer sharing
 * a Birthday that day (stopped by them or a Moderator since the job was queued).
 * Returns the job's result text.
 */
export async function postBirthdays(
  payload: Record<string, unknown>,
  deps: IBirthdayPostDeps,
  testChannelId: string | null = BIRTHDAY_TEST_CHANNEL_ID,
): Promise<string> {
  const clubDate = payloadClubDate(payload);
  const userIds = payloadUserIds(payload);
  const channelId = postChannel(payloadChannelId(payload), testChannelId);
  const today = deps.clubToday();
  if (clubDate !== today) {
    return `Not posted: the Birthday Post was for ${clubDate}, and today is ${today} ` +
      "in New York.";
  }
  // The job is delivered at least once: a repeat of one that posted (its ack lost) finds
  // its members greeted and posts nothing more.
  const { greeted, unchecked } = await alreadyGreeted(channelId, clubDate, deps);
  const due = userIds.filter((id) => !greeted.has(id));
  if (!due.length) {
    return "Not posted: every member was already greeted in the Birthday channel for " +
      `${clubDate} (a repeat of a job that posted).`;
  }
  const fetched = await Promise.all(due.map((id) => deps.fetchMember(id)));
  const present = fetched.filter((m): m is IBirthdayMember => m !== null);
  if (!present.length) {
    return "Not posted: none of the members are in the server any more.";
  }
  // Read last, right before posting: a Birthday whose sharing was stopped after the job
  // was queued must not be pinged. Unread, nobody is posted, and the lease retries it.
  let sharing: ReadonlySet<string>;
  try {
    sharing = await deps.sharingOn(clubDate);
  } catch (err: unknown) {
    throw new BotJobStepError("Reading today's Upcoming Birthdays to check who still shares",
      err, true);
  }
  const members = present.filter((m) => sharing.has(m.userId));
  if (!members.length) {
    return `Not posted: none of the members share a Birthday on ${clubDate} any more ` +
      "(they stopped sharing, or a Moderator stopped it, since the job was queued).";
  }
  const banner = await composeBirthdayBanner({
    dateLabel: clubDateLabel(clubDate),
    members,
  });
  const ids = members.map((m) => m.userId);
  await deps.postMessage(channelId, {
    content: birthdayPostContent(ids),
    pingUserIds: ids,
    files: [{
      name: bannerFileName(clubDate),
      data: banner,
      description: bannerDescription(members.map((m) => m.name)),
    }],
  });
  const count = members.length === 1 ? "1 member" : `${members.length} members`;
  const departed = due.length - present.length;
  const repeated = userIds.length - due.length;
  const stopped = present.length - members.length;
  const notes = [
    ...(departed ? [`${departed} no longer in the server`] : []),
    ...(stopped ? [`${stopped} no longer sharing`] : []),
    ...(repeated ? [`${repeated} already greeted today`] : []),
  ];
  const left = notes.length ? ` (${notes.join(", ")} left out)` : "";
  const warning = unchecked
    ? ` Not checked for an earlier post that day: ${unchecked} Staff were warned.`
    : "";
  return `Greeted ${count} for ${clubDate}${left}.${warning}`;
}
