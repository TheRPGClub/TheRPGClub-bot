import { DiscordAPIError, RESTJSONErrorCodes, userMention, type Client } from "discord.js";
import { DateTime } from "luxon";
import { BIRTHDAY_TIME_ZONE } from "../config/birthdays.js";
import { HOME_GUILD_ID } from "../config/guilds.js";
import { logError } from "../utilities/LogUtils.js";
import { joinWithAnd } from "../utilities/TextUtils.js";
import { isTemporaryJobError } from "./BotJobErrors.js";
import { fetchImageBuffer } from "./GameImageService.js";
import { bannerDescription, composeBirthdayBanner } from "./BirthdayBanner.js";

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
  /** Today's club day, as an ISO date. */
  clubToday(): string;
  /** The member in the home server; null when they are no longer in it. */
  fetchMember(userId: string): Promise<IBirthdayMember | null>;
  /** Posts to a text channel. Throws the discord.js error, or when it can't hold posts. */
  postMessage(channelId: string, post: IBirthdayPost): Promise<void>;
  /**
   * The members the bot's own Birthday Posts for `clubDate` in the channel already greeted,
   * read from Discord so it survives a restart. Throws the discord.js error.
   */
  greetedOn(channelId: string, clubDate: string): Promise<ReadonlySet<string>>;
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
  return `## 🎂 Happy Birthday, ${joinWithAnd(userIds.map((id) => userMention(id)))}!\n${closingLine(userIds.length)}`;
}

/** "18 November", for the banner's top line. */
export function clubDateLabel(clubDate: string): string {
  return DateTime.fromISO(clubDate, { zone: BIRTHDAY_TIME_ZONE }).toFormat("d LLLL");
}

function isUnknownMember(err: unknown): boolean {
  return err instanceof DiscordAPIError &&
    (err.code === RESTJSONErrorCodes.UnknownMember || err.code === RESTJSONErrorCodes.UnknownUser);
}

export function createBirthdayPostDeps(client: Client): IBirthdayPostDeps {
  return {
    clubToday: () => DateTime.now().setZone(BIRTHDAY_TIME_ZONE).toISODate() ?? "",
    fetchMember: async (userId) => {
      try {
        const guild = await client.guilds.fetch(HOME_GUILD_ID);
        const member = await guild.members.fetch(userId);
        const avatarUrl = member.displayAvatarURL({
          extension: "png",
          size: 512,
          forceStatic: true,
        });
        return { userId, name: member.displayName, avatar: await fetchImageBuffer(avatarUrl) };
      } catch (err: unknown) {
        if (isUnknownMember(err)) return null;
        throw err;
      }
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
  };
}

/**
 * Who the day's earlier Birthday Posts greeted. A scan that fails for good (the bot can't
 * read the channel's history) is logged and counts as nobody, so the Birthday still goes
 * out; a temporary failure is thrown for the lease to retry.
 */
async function alreadyGreeted(
  channelId: string,
  clubDate: string,
  deps: IBirthdayPostDeps,
): Promise<ReadonlySet<string>> {
  try {
    return await deps.greetedOn(channelId, clubDate);
  } catch (err: unknown) {
    if (isTemporaryJobError(err)) throw err;
    logError("BirthdayPost.alreadyGreeted", err);
    return new Set();
  }
}

function payloadUserIds(payload: Record<string, unknown>): string[] {
  const ids = payload.user_ids;
  if (
    !Array.isArray(ids) || !ids.length ||
    !ids.every((id) => typeof id === "string" && /^\d+$/.test(id))
  ) {
    throw new Error(`Invalid payload: user_ids must be a non-empty array of Discord user ids, ` +
      `got ${JSON.stringify(ids)}.`);
  }
  return [...new Set(ids as string[])];
}

function payloadClubDate(payload: Record<string, unknown>): string {
  const value = payload.club_date;
  if (typeof value !== "string" || !DateTime.fromISO(value).isValid) {
    throw new Error(`Invalid payload: club_date must be an ISO date, got ${
      JSON.stringify(value)
    }.`);
  }
  return value;
}

/**
 * Payload `{ club_date, user_ids }` (BirthdayPostJobPayload): posts the Birthday Post in
 * `channelId`. A job whose club day has passed in New York is dropped, so nobody is
 * greeted on the wrong day; members who left the server since it was queued, or whom an
 * earlier Birthday Post that day already greeted, are left out.
 * Returns the job's result text.
 */
export async function postBirthdays(
  payload: Record<string, unknown>,
  channelId: string,
  deps: IBirthdayPostDeps,
): Promise<string> {
  const clubDate = payloadClubDate(payload);
  const userIds = payloadUserIds(payload);
  const today = deps.clubToday();
  if (clubDate !== today) {
    return `Not posted: the Birthday Post was for ${clubDate}, and today is ${today} ` +
      "in New York.";
  }
  // The job is delivered at least once: a repeat of one that posted (its ack lost) finds
  // its members greeted and posts nothing, while a later job that day greets only the rest.
  const greeted = await alreadyGreeted(channelId, clubDate, deps);
  const due = userIds.filter((id) => !greeted.has(id));
  if (!due.length) {
    return "Not posted: every member was already greeted in the Birthday channel for " +
      `${clubDate} (a repeat of a job that posted).`;
  }
  const fetched = await Promise.all(due.map((id) => deps.fetchMember(id)));
  const members = fetched.filter((m): m is IBirthdayMember => m !== null);
  const departed = due.length - members.length;
  const repeated = userIds.length - due.length;
  if (!members.length) {
    return "Not posted: none of the members are in the server any more.";
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
  const notes = [
    ...(departed ? [`${departed} no longer in the server`] : []),
    ...(repeated ? [`${repeated} already greeted today`] : []),
  ];
  const left = notes.length ? ` (${notes.join(", ")} left out)` : "";
  return `Greeted ${count} for ${clubDate}${left}.`;
}
