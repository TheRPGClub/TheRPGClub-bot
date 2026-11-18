import {
  ActionRowBuilder,
  ButtonBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
} from "@discordjs/builders";
import {
  ButtonStyle,
  MessageFlags,
  type APIMessageTopLevelComponent,
} from "discord-api-types/v10";
import type { Client, MessageCreateOptions } from "discord.js";
import { buildTextContainer, buildTextDisplay } from "../functions/ComponentsV2Utils.js";
import {
  clubToday,
  describePool,
  describePoolTarget,
  describeSchedule,
  escapeChallengeText,
  hostLabel,
} from "../functions/ChallengeCopy.js";
import {
  COUNTS_PAST_PLAY_LINE,
  describeSlotsRange,
  describeSlotsTarget,
} from "../functions/ChallengeSlotsCopy.js";
import {
  buildChallengeRunId,
  buildChallengeShowId,
} from "../functions/ChallengeCustomIds.js";
import { DISCORD_SELECT_LABEL_MAX } from "../config/textLimits.js";
import { logError } from "../utilities/LogUtils.js";
import { fetchImageBuffer } from "./GameImageService.js";
import { composeYearStrip, stripTiles } from "./ChallengeSlotsImage.js";
import { getUserEmojiString } from "./UserEmojiService.js";
import {
  CHALLENGE_API,
  poolDefinitionOf,
  type IChallenge,
  type IGameSummary,
  type IPage,
  type IPoolDefinition,
} from "./ChallengeApi.js";
import { CHALLENGE_EDITION_API, type ISignupPost } from "./ChallengeEditionApi.js";
import {
  buildSignUpButton,
  editionRuleLine,
  signupEditionOf,
  storeSignupPost,
} from "./ChallengeSignupPosts.js";
import { payloadChallenge } from "./ChallengePayloads.js";

// The #challenges posts (spec api#376). This file holds the new-Challenge post
// (`challenge_created`, design 1B "Cover wall", with a year strip for Slots), the post
// type and the jobs' deps; the other events live in their own files.

/** A Components V2 post; mentions in it never ping. */
export interface IChallengePost {
  components: APIMessageTopLevelComponent[];
  flags: number;
  allowedMentions: { parse: [] };
  /** Images the post shows by `attachment://<name>`. */
  files?: { name: string; data: Buffer }[];
  /** A message in the same channel to reply to; posts plainly when it is gone. */
  replyTo?: string;
}

/**
 * What the Challenge jobs may do: post in a channel, DM a member, read games, their
 * covers and members' avatar emojis, and store an Edition's sign-up post.
 */
export interface IChallengeJobDeps {
  /**
   * Posts to a text channel and returns the posted message's ID. Throws the discord.js
   * error, or when the channel can't hold posts.
   */
  postMessage(channelId: string, post: IChallengePost): Promise<string | void>;
  /** Stores where an Edition's sign-up opening post is (PUT .../signup_post). */
  storeSignupPost(editionId: number, post: ISignupPost): Promise<void>;
  /** The games a Pool resolves to, for its covers when the payload carries none. */
  poolPreview(pool: IPoolDefinition, page: number, per: number): Promise<IPage<IGameSummary>>;
  /** The image at a game's `cover_url`, or null (errors logged, never thrown). */
  coverImage(url: string): Promise<Buffer | null>;
  /** DMs a member. Throws the discord.js error (closed DMs: code 50007). */
  sendDm(userId: string, post: IChallengePost): Promise<void>;
  /** The member's avatar emoji (`<:name:id>`), or null when they have none yet. */
  memberEmoji(userId: string): string | null;
}

/** A post as discord.js sends it: files attached, and a reply that never fails the send. */
function discordMessage(post: IChallengePost): MessageCreateOptions {
  const { files, replyTo, ...message } = post;
  return {
    ...message,
    ...(files?.length
      ? { files: files.map((file) => ({ attachment: file.data, name: file.name })) }
      : {}),
    ...(replyTo ? { reply: { messageReference: replyTo, failIfNotExists: false } } : {}),
  };
}

export function createChallengeJobDeps(client: Client): IChallengeJobDeps {
  return {
    postMessage: async (channelId, post) => {
      const channel = await client.channels.fetch(channelId);
      if (!channel || !channel.isSendable()) {
        throw new Error(`Channel ${channelId} is missing or the bot cannot post in it.`);
      }
      const sent = await channel.send(discordMessage(post));
      return sent.id;
    },
    storeSignupPost: (editionId, post) =>
      CHALLENGE_EDITION_API.storeSignupPost(editionId, post),
    poolPreview: (pool, page, per) => CHALLENGE_API.poolPreview(pool, page, per),
    coverImage: fetchImageBuffer,
    sendDm: async (userId, post) => {
      const user = await client.users.fetch(userId);
      await user.send(discordMessage(post));
    },
    memberEmoji: (userId) => getUserEmojiString(userId),
  };
}

/** A media gallery holds at most 10 items, so the cover wall shows the first 10 games. */
export const COVER_WALL_MAX = 10;

const LOG_CONTEXT = "ChallengeAnnouncements";

function payloadGames(payload: Record<string, unknown>): IGameSummary[] | null {
  const games = payload.pool_games;
  if (!Array.isArray(games)) return null;
  return games.filter((g): g is IGameSummary =>
    !!g && typeof g === "object" && typeof (g as IGameSummary).game_id === "number");
}

/**
 * The Pool's first games for the cover wall: the payload's `pool_games` when it has them
 * (`challenge_created` and `season_opened`), else the Pool preview's first page. A failed
 * preview is logged and posts without covers.
 */
export async function coverGames(
  challenge: IChallenge,
  payload: Record<string, unknown>,
  deps: IChallengeJobDeps,
): Promise<IGameSummary[]> {
  if (!challenge.pool) return [];
  const fromPayload = payloadGames(payload);
  if (fromPayload) return fromPayload;
  try {
    const page = await deps.poolPreview(poolDefinitionOf(challenge.pool), 1, COVER_WALL_MAX);
    return page.items;
  } catch (err: unknown) {
    logError(`${LOG_CONTEXT}.coverGames`, err);
    return [];
  }
}

/** Up to 10 covers as a media gallery, each titled with its game; null with none. */
export function buildCoverWall(games: readonly IGameSummary[]): MediaGalleryBuilder | null {
  const items = games
    .filter((g): g is IGameSummary & { cover_url: string } => !!g.cover_url)
    .slice(0, COVER_WALL_MAX)
    .map((g) => new MediaGalleryItemBuilder()
      .setURL(g.cover_url)
      .setDescription(g.title.slice(0, DISCORD_SELECT_LABEL_MAX)));
  return items.length ? new MediaGalleryBuilder().addItems(...items) : null;
}

/** The rule lines under the description: what counts, what it takes, and when. */
export function challengeRuleLines(challenge: IChallenge): string[] {
  const lines: string[] = [];
  if (challenge.pool) {
    lines.push(`**Pool** ${describePool(challenge.pool)}`);
    lines.push(`**To Finish** ${describePoolTarget(challenge.pool)}`);
  }
  if (challenge.slots) {
    lines.push(`**Slots** ${describeSlotsRange(challenge.slots)}`);
    lines.push(`**To Finish** ${describeSlotsTarget(challenge.slots)}`);
  }
  const schedule = describeSchedule(challenge);
  lines.push(`**${schedule.label}** ${schedule.value}`);
  if (challenge.slots?.counts_past_play) {
    lines.push(`**Counts past play** ${COUNTS_PAST_PLAY_LINE}`);
  }
  const edition = signupEditionOf(challenge);
  if (edition) lines.push(editionRuleLine(edition));
  return lines;
}

/**
 * The new-Challenge post: name, Host, the Pool's cover wall (or a Slots Challenge's year
 * strip), rules and a way in.
 */
export function buildNewChallengePost(
  challenge: IChallenge,
  games: readonly IGameSummary[],
  yearStrip: Buffer | null = null,
): IChallengePost {
  const container = buildTextContainer(
    `# ${escapeChallengeText(challenge.name)}\n` +
      `-# New Challenge · hosted by ${hostLabel(challenge)}`,
  );
  const wall = buildCoverWall(games);
  if (wall) container.addMediaGalleryComponents(wall);
  const stripName = `year-strip-${challenge.id}.png`;
  if (yearStrip) {
    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder()
        .setURL(`attachment://${stripName}`)
        .setDescription(`One slot for each year: ${
          challenge.slots ? describeSlotsRange(challenge.slots) : ""
        }`.slice(0, DISCORD_SELECT_LABEL_MAX)),
    ));
  }
  container.addTextDisplayComponents(buildTextDisplay(
    [challenge.description.trim(), ...challengeRuleLines(challenge)].filter(Boolean).join("\n"),
  ));

  const buttons: ButtonBuilder[] = [];
  if (challenge.challenge_format !== "assignment") {
    // An Assignment Challenge's Runs come from an Edition's draw, not from starting one.
    buttons.push(new ButtonBuilder()
      .setCustomId(buildChallengeRunId("start", challenge.id))
      .setLabel("Start a Run")
      .setStyle(ButtonStyle.Primary));
  }
  const signupEdition = signupEditionOf(challenge);
  if (signupEdition) buttons.push(buildSignUpButton(signupEdition.id));
  const gameCount = challenge.pool?.game_count;
  const hasGames = !!challenge.pool && typeof gameCount === "number" && gameCount > 0;
  if (hasGames) {
    buttons.push(new ButtonBuilder()
      .setCustomId(buildChallengeShowId({
        challengeId: challenge.id,
        view: "game",
        page: 1,
        reply: "new",
      }))
      .setLabel(`See all ${gameCount} games`)
      .setStyle(ButtonStyle.Secondary));
  }
  if (buttons.length) {
    container.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons),
    );
  }
  const shown = wall ? wall.items.length : 0;
  if (hasGames && shown) {
    container.addTextDisplayComponents(
      buildTextDisplay(`-# Showing ${shown} of ${gameCount} games in the Pool`),
    );
  }
  return {
    components: [container.toJSON()],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
    ...(yearStrip ? { files: [{ name: stripName, data: yearStrip }] } : {}),
  };
}

/** A Slots Challenge's year strip, or null for other Formats (or when it can't be drawn). */
async function yearStripOf(challenge: IChallenge): Promise<Buffer | null> {
  if (!challenge.slots) return null;
  try {
    const currentYear = Number(clubToday().slice(0, 4));
    return await composeYearStrip(stripTiles(challenge.slots, currentYear));
  } catch (err: unknown) {
    logError(`${LOG_CONTEXT}.yearStrip`, err);
    return null;
  }
}

/**
 * Payload `{ event: "challenge_created", challenge, pool_games?, feature_key }`: posts
 * the new Challenge in `channelId`. Returns the job's result text.
 */
export async function announceNewChallenge(
  payload: Record<string, unknown>,
  channelId: string,
  deps: IChallengeJobDeps,
): Promise<string> {
  const challenge = payloadChallenge(payload);
  const games = await coverGames(challenge, payload, deps);
  const strip = await yearStripOf(challenge);
  const messageId = await deps.postMessage(
    channelId,
    buildNewChallengePost(challenge, games, strip),
  );
  // A Secret Santa's first Edition opens with it: this post is its sign-up post.
  const edition = signupEditionOf(challenge);
  const note = edition ? await storeSignupPost(edition.id, channelId, messageId, deps) : "";
  return `Announced the new Challenge "${challenge.name}" (${challenge.id}).${note}`;
}
