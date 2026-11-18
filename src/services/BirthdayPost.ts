import { DiscordAPIError, RESTJSONErrorCodes, userMention, type Client } from "discord.js";
import { DateTime } from "luxon";
import { HOME_GUILD_ID } from "../config/guilds.js";
import { fetchImageBuffer } from "./GameImageService.js";
import { bannerDescription, composeBirthdayBanner } from "./BirthdayBanner.js";
import { BIRTHDAY_TIME_ZONE } from "./UpcomingBirthdaysService.js";

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

function joinMentions(userIds: readonly string[]): string {
  const mentions = userIds.map((id) => userMention(id));
  if (mentions.length <= 1) return mentions.join("");
  return `${mentions.slice(0, -1).join(", ")} and ${mentions[mentions.length - 1]}`;
}

/** The message text: a heading that pings every member, then the closing line. */
export function birthdayPostContent(userIds: readonly string[]): string {
  return `## 🎂 Happy Birthday, ${joinMentions(userIds)}!\n${closingLine(userIds.length)}`;
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
  };
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
 * greeted on the wrong day; members who left the server since it was queued are left out.
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
  const fetched = await Promise.all(userIds.map((id) => deps.fetchMember(id)));
  const members = fetched.filter((m): m is IBirthdayMember => m !== null);
  const departed = userIds.length - members.length;
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
      name: "happy-birthday.png",
      data: banner,
      description: bannerDescription(members.map((m) => m.name)),
    }],
  });
  const greeted = members.length === 1 ? "1 member" : `${members.length} members`;
  const left = departed ? ` (${departed} no longer in the server left out)` : "";
  return `Greeted ${greeted} for ${clubDate}${left}.`;
}
