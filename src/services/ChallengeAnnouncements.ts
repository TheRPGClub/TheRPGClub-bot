import {
  ActionRowBuilder,
  ButtonBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import {
  ButtonStyle,
  MessageFlags,
  type APIMessageTopLevelComponent,
} from "discord-api-types/v10";
import type { Client } from "discord.js";
import { safeV2TextContent } from "../functions/ComponentsV2Utils.js";
import {
  describePool,
  describePoolTarget,
  describeSchedule,
  escapeChallengeText,
  hostLabel,
} from "../functions/ChallengeCopy.js";
import { buildChallengeShowId } from "../functions/ChallengeCustomIds.js";
import { DISCORD_SELECT_LABEL_MAX, MAX_CONTAINER_TEXT } from "../config/textLimits.js";
import { logError } from "../utilities/LogUtils.js";
import {
  CHALLENGE_API,
  poolDefinitionOf,
  type IChallenge,
  type IGameSummary,
  type IPage,
  type IPoolDefinition,
} from "./ChallengeApi.js";

// The #challenges posts (spec api#376). This file holds the new-Challenge post
// (`challenge_created`, design 1B "Cover wall"); later tickets add the other events.

/** A Components V2 post; mentions in it never ping. */
export interface IChallengePost {
  components: APIMessageTopLevelComponent[];
  flags: number;
  allowedMentions: { parse: [] };
}

/** What the Challenge jobs may do: post in a channel and read the Pool preview. */
export interface IChallengeJobDeps {
  /** Posts to a text channel. Throws the discord.js error, or when it can't hold posts. */
  postMessage(channelId: string, post: IChallengePost): Promise<void>;
  /** The games a Pool resolves to, for its covers when the payload carries none. */
  poolPreview(pool: IPoolDefinition, page: number, per: number): Promise<IPage<IGameSummary>>;
}

export function createChallengeJobDeps(client: Client): IChallengeJobDeps {
  return {
    postMessage: async (channelId, post) => {
      const channel = await client.channels.fetch(channelId);
      if (!channel || !channel.isSendable()) {
        throw new Error(`Channel ${channelId} is missing or the bot cannot post in it.`);
      }
      await channel.send(post);
    },
    poolPreview: (pool, page, per) => CHALLENGE_API.poolPreview(pool, page, per),
  };
}

/** A media gallery holds at most 10 items, so the cover wall shows the first 10 games. */
export const COVER_WALL_MAX = 10;

const LOG_CONTEXT = "ChallengeAnnouncements";

/** The `challenge` of a job payload, or a thrown error naming what is wrong. */
export function payloadChallenge(payload: Record<string, unknown>): IChallenge {
  const challenge = payload.challenge as Partial<IChallenge> | undefined;
  if (
    !challenge || typeof challenge !== "object" ||
    typeof challenge.id !== "number" || typeof challenge.name !== "string"
  ) {
    throw new Error(`Invalid payload: challenge must be a Challenge, got ${
      JSON.stringify(challenge)
    }.`);
  }
  return challenge as IChallenge;
}

function payloadGames(payload: Record<string, unknown>): IGameSummary[] | null {
  const games = payload.pool_games;
  if (!Array.isArray(games)) return null;
  return games.filter((g): g is IGameSummary =>
    !!g && typeof g === "object" && typeof (g as IGameSummary).game_id === "number");
}

/**
 * The Pool's first games for the cover wall: the payload's `pool_games` when it has them
 * (the API adds them to `challenge_created`), else the Pool preview's first page. A failed
 * preview is logged and posts without covers.
 */
async function coverGames(
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

function text(content: string): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(safeV2TextContent(content, MAX_CONTAINER_TEXT));
}

/** The rule lines under the description: what counts, what it takes, and when. */
export function challengeRuleLines(challenge: IChallenge): string[] {
  const lines: string[] = [];
  if (challenge.pool) {
    lines.push(`**Pool** ${describePool(challenge.pool)}`);
    lines.push(`**To Finish** ${describePoolTarget(challenge.pool)}`);
  }
  const schedule = describeSchedule(challenge);
  lines.push(`**${schedule.label}** ${schedule.value}`);
  return lines;
}

/** The new-Challenge post: name, Host, the Pool's cover wall, rules and a way in. */
export function buildNewChallengePost(
  challenge: IChallenge,
  games: readonly IGameSummary[],
): IChallengePost {
  const container = new ContainerBuilder().addTextDisplayComponents(text(
    `# ${escapeChallengeText(challenge.name)}\n` +
      `-# New Challenge · hosted by ${hostLabel(challenge)}`,
  ));
  const wall = buildCoverWall(games);
  if (wall) container.addMediaGalleryComponents(wall);
  container.addTextDisplayComponents(text(
    [challenge.description.trim(), ...challengeRuleLines(challenge)].filter(Boolean).join("\n"),
  ));

  const gameCount = challenge.pool?.game_count;
  if (challenge.pool && typeof gameCount === "number" && gameCount > 0) {
    container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(buildChallengeShowId({
          challengeId: challenge.id,
          view: "game",
          page: 1,
          reply: "new",
        }))
        .setLabel(`See all ${gameCount} games`)
        .setStyle(ButtonStyle.Secondary),
    ));
    const shown = wall ? wall.items.length : 0;
    if (shown) {
      container.addTextDisplayComponents(
        text(`-# Showing ${shown} of ${gameCount} games in the Pool`),
      );
    }
  }
  return {
    components: [container.toJSON()],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
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
  await deps.postMessage(channelId, buildNewChallengePost(challenge, games));
  return `Announced the new Challenge "${challenge.name}" (${challenge.id}).`;
}
