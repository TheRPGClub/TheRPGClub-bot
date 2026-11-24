import {
  ActionRowBuilder,
  ButtonBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SeparatorBuilder,
} from "@discordjs/builders";
import { ButtonStyle, MessageFlags, SeparatorSpacingSize } from "discord-api-types/v10";
import { buildTextDisplay } from "../functions/ComponentsV2Utils.js";
import {
  describePoolTarget,
  escapeChallengeText,
  formatMonthDay,
  listJoin,
  memberName,
  poolProgressText,
} from "../functions/ChallengeCopy.js";
import { buildChallengeRunId } from "../functions/ChallengeCustomIds.js";
import { challengePageUrl } from "../config/website.js";
import { logError } from "../utilities/LogUtils.js";
import { commandMention } from "./CommandMentionService.js";
import type {
  IChallenge,
  IChallengeMember,
  IChallengeRun,
  IGameSummary,
} from "./ChallengeApi.js";
import {
  COVER_WALL_MAX,
  buildCoverWall,
  coverGames,
  type IChallengeJobDeps,
  type IChallengePost,
} from "./ChallengeAnnouncements.js";
import { composeCoverStrip, type ShelfTile } from "./ChallengeShelfImage.js";
import { runProgressText } from "./ChallengeRuns.js";
import { plural } from "../utilities/TextUtils.js";
import { payloadChallenge, payloadRun, payloadUserId } from "./ChallengePayloads.js";

// The lifecycle job's Season messages (spec api#376, bot#1548): the Season opened post in
// #challenges (`season_opened`, design 2B "Returning faces": the Pool as one cover strip
// and last Season's Finishers by name, never pinged) and the Season-end reminder DM
// (`challenge_dm` `season_ending`).

/** Finishers named on the post; past it, the rest are counted. */
export const FINISHERS_NAMED_MAX = 20;

const LOG_CONTEXT = "ChallengeSeasons";

/** A Season as club dates (`starts_on`, `ends_on`), from the payload's `season`. */
interface ISeasonDates {
  starts_on: string;
  ends_on: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function payloadSeason(payload: Record<string, unknown>): ISeasonDates | null {
  const season = payload.season as Partial<ISeasonDates> | undefined;
  if (!season || typeof season !== "object") return null;
  const { starts_on: startsOn, ends_on: endsOn } = season;
  if (typeof startsOn !== "string" || typeof endsOn !== "string") return null;
  if (!ISO_DATE.test(startsOn) || !ISO_DATE.test(endsOn)) return null;
  return { starts_on: startsOn, ends_on: endsOn };
}

/** "2027-09-22" as "22 September". */
function dayAndMonth(isoDate: string): string {
  return formatMonthDay(isoDate.slice(5));
}

/** "21 June to 22 September": the payload's Season, else the Challenge's own. */
function seasonText(challenge: IChallenge, season: ISeasonDates | null): string | null {
  if (season) return `${dayAndMonth(season.starts_on)} to ${dayAndMonth(season.ends_on)}`;
  if (!challenge.season) return null;
  return `${formatMonthDay(challenge.season.start)} to ${formatMonthDay(challenge.season.end)}`;
}

function payloadFinishers(payload: Record<string, unknown>): IChallengeMember[] {
  const finishers = payload.last_season_finishers;
  if (!Array.isArray(finishers)) return [];
  return finishers.filter((m): m is IChallengeMember =>
    !!m && typeof m === "object" &&
    typeof (m as IChallengeMember).user_id === "string" &&
    typeof (m as IChallengeMember).username === "string");
}

/** "<:u_lufia:1> Lufia, tenpenny and 3 more": avatar emojis and names, never mentions. */
function finisherNames(
  finishers: readonly IChallengeMember[],
  deps: IChallengeJobDeps,
): string {
  const named = finishers.slice(0, FINISHERS_NAMED_MAX).map((member) => {
    const emoji = deps.memberEmoji(member.user_id);
    const name = escapeChallengeText(memberName(member));
    return emoji ? `${emoji} ${name}` : name;
  });
  const more = finishers.length - named.length;
  if (more > 0) named.push(`${more} more`);
  return listJoin(named);
}

/** "21 June to 22 September · Clear 2 · 9 games in the Pool" */
function seasonSubtext(challenge: IChallenge, season: ISeasonDates | null): string {
  const parts: string[] = [];
  const dates = seasonText(challenge, season);
  if (dates) parts.push(dates);
  if (challenge.pool) {
    parts.push(describePoolTarget(challenge.pool));
    const count = challenge.pool.game_count;
    if (typeof count === "number") {
      parts.push(`${plural(count, "game")} in the Pool`);
    }
  }
  return parts.join(" · ");
}

/**
 * The cover strip: each game's cover, or a title card for one without, as one image; null
 * when no game has a cover, or when it can't be drawn (logged).
 */
async function coverStrip(
  games: readonly IGameSummary[],
  deps: IChallengeJobDeps,
): Promise<Buffer | null> {
  const shown = games.slice(0, COVER_WALL_MAX);
  const covers = await Promise.all(
    shown.map((game) => game.cover_url ? deps.coverImage(game.cover_url) : null),
  );
  if (!covers.some(Boolean)) return null;
  const tiles: ShelfTile[] = shown.map((game, index) => ({
    kind: "game",
    title: game.title,
    cover: covers[index] ?? null,
  }));
  try {
    return await composeCoverStrip(tiles);
  } catch (err: unknown) {
    logError(`${LOG_CONTEXT}.coverStrip`, err);
    return null;
  }
}

/** The Season opened post: the strip, "<name> is back", last Season's Finishers, a way in. */
export function buildSeasonOpenedPost(
  challenge: IChallenge,
  content: {
    season: ISeasonDates | null;
    games: readonly IGameSummary[];
    finishers: string | null;
    strip: Buffer | null;
  },
): IChallengePost {
  const fileName = `season-opened-${challenge.id}.png`;
  const name = escapeChallengeText(challenge.name);
  const container = new ContainerBuilder();
  if (content.strip) {
    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder()
        .setURL(`attachment://${fileName}`)
        .setDescription(`Games in the Pool of ${challenge.name}`),
    ));
  } else {
    // A strip that couldn't be drawn falls back to the covers the API linked, if any.
    const wall = buildCoverWall(content.games);
    if (wall) container.addMediaGalleryComponents(wall);
  }
  if (content.finishers) {
    container.addTextDisplayComponents(
      buildTextDisplay(`## ${name} is back`),
      buildTextDisplay(
        `Last Season ${content.finishers} Finished. ` +
          "Anyone can start a new Run this year, them included.",
      ),
    );
  } else {
    container.addTextDisplayComponents(
      buildTextDisplay(`## ${name} is open`),
      buildTextDisplay("A new Season has started. Anyone can start a Run."),
    );
  }
  const sub = seasonSubtext(challenge, content.season);
  if (sub) container.addTextDisplayComponents(buildTextDisplay(`-# ${sub}`));
  if (challenge.challenge_format !== "assignment") {
    container
      .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
      .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(buildChallengeRunId("start", challenge.id))
          .setLabel("Start a Run")
          .setStyle(ButtonStyle.Primary),
      ));
  }
  return {
    components: [container.toJSON()],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
    ...(content.strip ? { files: [{ name: fileName, data: content.strip }] } : {}),
  };
}

/**
 * Payload `{ event: "season_opened", challenge, season, pool_games,
 * last_season_finishers, feature_key }`: posts the Season opening in `channelId`. Returns
 * the job's result text.
 */
export async function announceSeasonOpened(
  payload: Record<string, unknown>,
  channelId: string,
  deps: IChallengeJobDeps,
): Promise<string> {
  const challenge = payloadChallenge(payload);
  const season = payloadSeason(payload);
  const games = await coverGames(challenge, payload, deps);
  const finishers = payloadFinishers(payload);
  const strip = await coverStrip(games, deps);
  await deps.postMessage(channelId, buildSeasonOpenedPost(challenge, {
    season,
    games,
    finishers: finishers.length ? finisherNames(finishers, deps) : null,
    strip,
  }));
  const named = finishers.length
    ? ` with ${plural(finishers.length, "Finisher")} named`
    : "";
  return `Announced the Season of "${challenge.name}" (${challenge.id})${named}.`;
}

/** A DM a `challenge_dm` job sends: who to, the message, and what it is, for the result. */
export interface IChallengeDm {
  userId: string;
  post: IChallengePost;
  /** "the Season-end reminder for "X" (Run 41)", for the job's result text. */
  about: string;
}

/** "closes in 7 days", "closes in 1 day", "closes today". */
function closesIn(daysLeft: number): string {
  if (daysLeft <= 0) return "closes today";
  return `closes in ${plural(daysLeft, "day")}`;
}

/** The Season-end reminder: how far the Run got, when the Season ends, and a link to it. */
export function buildSeasonEndingDm(
  challenge: IChallenge,
  run: IChallengeRun,
  content: { daysLeft: number; endsOn: string | null },
): IChallengePost {
  const { cleared, target } = run.progress;
  const poolProgress = poolProgressText(run.progress);
  const progress = challenge.challenge_format === "pool"
    ? (poolProgress ? `Your Run: ${poolProgress}.` : `You've Cleared ${cleared} of ${target}.`)
    : `Your Run: ${runProgressText(run)}.`;
  const ends = content.endsOn ? ` The Season ends on ${dayAndMonth(content.endsOn)}.` : "";
  const container = new ContainerBuilder()
    .addTextDisplayComponents(buildTextDisplay(
      `## ${escapeChallengeText(challenge.name)} ${closesIn(content.daysLeft)}\n` +
        `${progress}${ends}`,
    ))
    .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setURL(challengePageUrl(challenge.id))
        .setLabel("Your Run")
        .setStyle(ButtonStyle.Link),
    ))
    .addTextDisplayComponents(buildTextDisplay(
      `-# Turn Challenge DMs off with ${commandMention("challenge dms")}`,
    ));
  return {
    components: [container.toJSON()],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

/**
 * Payload `{ event: "season_ending", user_id, challenge, run, season, days_left,
 * feature_key }`: the reminder DM for the member's Run. The API sends it only to members
 * who keep Challenge DMs on.
 */
export async function seasonEndingDm(payload: Record<string, unknown>): Promise<IChallengeDm> {
  const userId = payloadUserId(payload);
  const challenge = payloadChallenge(payload);
  const run = payloadRun(payload);
  const daysLeft = typeof payload.days_left === "number" ? payload.days_left : 7;
  const endsOn = payloadSeason(payload)?.ends_on ?? run.window?.ends_on ?? null;
  return {
    userId,
    post: buildSeasonEndingDm(challenge, run, { daysLeft, endsOn }),
    about: `the Season-end reminder for "${challenge.name}" (Run ${run.id})`,
  };
}
