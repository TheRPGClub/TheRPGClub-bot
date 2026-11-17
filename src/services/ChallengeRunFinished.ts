import {
  ButtonBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SectionBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import { ButtonStyle, MessageFlags } from "discord-api-types/v10";
import { DateTime } from "luxon";
import { safeV2TextContent } from "../functions/ComponentsV2Utils.js";
import {
  CHALLENGE_TIME_ZONE,
  escapeChallengeText,
  listJoin,
  memberName,
} from "../functions/ChallengeCopy.js";
import { buildChallengeShowId } from "../functions/ChallengeCustomIds.js";
import { DISCORD_BUTTON_LABEL_MAX, MAX_CONTAINER_TEXT } from "../config/textLimits.js";
import { logError } from "../utilities/LogUtils.js";
import type { IChallenge, IChallengeRun, IChallengeRunEntry } from "./ChallengeApi.js";
import {
  payloadChallenge,
  type IChallengeJobDeps,
  type IChallengePost,
} from "./ChallengeAnnouncements.js";
import { composeRunShelf, type ShelfTile } from "./ChallengeShelfImage.js";
import { entriesIn } from "./ChallengeRuns.js";

// The Run Finished post in #challenges (`run_finished`, design 3B "Shelf"): the whole
// Run as a shelf of its Cleared covers, how long it took, and what the member still plays.
// The Caught Up year poster is bot#1550's.

/** Tiles on the shelf; past it, the last tile counts the rest. */
export const SHELF_TILES_MAX = 10;

const LOG_CONTEXT = "ChallengeRunFinished";

function text(content: string): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(safeV2TextContent(content, MAX_CONTAINER_TEXT));
}

/** The `run` of a job payload, or a thrown error naming what is wrong. */
function payloadRun(payload: Record<string, unknown>): IChallengeRun {
  const run = payload.run as Partial<IChallengeRun> | undefined;
  if (
    !run || typeof run !== "object" || typeof run.id !== "number" ||
    !run.user || typeof run.started_at !== "string"
  ) {
    throw new Error(`Invalid payload: run must be a Challenge Run, got ${JSON.stringify(run)}.`);
  }
  return run as IChallengeRun;
}

/** The Cleared games named and shelved: all up to 10, else the first 9 and a count. */
function shelved(cleared: readonly IChallengeRunEntry[]): {
  games: IChallengeRunEntry[];
  more: number;
} {
  if (cleared.length <= SHELF_TILES_MAX) return { games: [...cleared], more: 0 };
  const games = cleared.slice(0, SHELF_TILES_MAX - 1);
  return { games, more: cleared.length - games.length };
}

function clubDay(iso: string): DateTime {
  return DateTime.fromISO(iso, { zone: "utc" }).setZone(CHALLENGE_TIME_ZONE).startOf("day");
}

/** "in 53 days", "in 1 day", or "on the day the Run started". */
function duration(run: IChallengeRun): string {
  if (!run.ended_at) return "";
  const days = Math.round(clubDay(run.ended_at).diff(clubDay(run.started_at), "days").days);
  if (days <= 0) return " on the day the Run started";
  return ` in ${days} ${days === 1 ? "day" : "days"}`;
}

/** "23 September", with the year when the Run ended in another year. */
function startedOn(run: IChallengeRun): string {
  const started = clubDay(run.started_at);
  const sameYear = !run.ended_at || clubDay(run.ended_at).year === started.year;
  return started.toFormat(sameYear ? "d LLLL" : "d LLLL yyyy");
}

function bodyText(run: IChallengeRun, games: IChallengeRunEntry[], more: number): string {
  const titles = games.map((entry) => escapeChallengeText(entry.title));
  if (more) titles.push(`${more} more games`);
  const lines: string[] = [];
  if (titles.length) lines.push(`Cleared ${listJoin(titles)}${duration(run)}.`);
  const sub = [`Run started ${startedOn(run)}`];
  const playing = entriesIn(run, "in_progress");
  if (playing.length) {
    sub.push(`still playing ${listJoin(playing.map((e) => escapeChallengeText(e.title)))}`);
  }
  lines.push(`-# ${sub.join(" · ")}`);
  return lines.join("\n");
}

/** The shelf image, or null when no Cleared game has a cover (or it can't be drawn). */
async function shelfImage(
  games: readonly IChallengeRunEntry[],
  more: number,
  deps: IChallengeJobDeps,
): Promise<Buffer | null> {
  const covers = await Promise.all(games.map((entry) => deps.coverImage(entry.game_id)));
  if (!covers.some(Boolean)) return null;
  const tiles: ShelfTile[] = games.map((entry, index) => ({
    kind: "game",
    title: entry.title,
    cover: covers[index] ?? null,
  }));
  if (more) tiles.push({ kind: "more", count: more });
  try {
    return await composeRunShelf(tiles);
  } catch (err: unknown) {
    logError(`${LOG_CONTEXT}.shelfImage`, err);
    return null;
  }
}

/** The post: heading and Challenge, the member's button, the shelf, and the Run in words. */
export function buildRunFinishedPost(
  challenge: Pick<IChallenge, "id" | "name">,
  run: IChallengeRun,
  shelf: { games: IChallengeRunEntry[]; more: number; image: Buffer | null },
): IChallengePost {
  const fileName = `run-finished-${run.id}.png`;
  const member = new ButtonBuilder()
    .setCustomId(buildChallengeShowId({
      challengeId: challenge.id,
      view: "member",
      page: 1,
      reply: "new",
    }))
    .setLabel(memberName(run.user).slice(0, DISCORD_BUTTON_LABEL_MAX))
    .setStyle(ButtonStyle.Secondary);
  const heading = new SectionBuilder().addTextDisplayComponents(text(
    `## Run Finished\n**${escapeChallengeText(challenge.name)}**`,
  ));
  heading.setButtonAccessory(member);
  const container = new ContainerBuilder().addSectionComponents(heading);
  if (shelf.image) {
    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder()
        .setURL(`attachment://${fileName}`)
        .setDescription(`${memberName(run.user)}'s Cleared games`),
    ));
  }
  container.addTextDisplayComponents(text(bodyText(run, shelf.games, shelf.more)));
  return {
    components: [container.toJSON()],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
    ...(shelf.image ? { files: [{ name: fileName, data: shelf.image }] } : {}),
  };
}

/**
 * Payload `{ event: "run_finished", challenge, run, feature_key }`: posts the Finished
 * Run in `channelId`. Returns the job's result text.
 */
export async function announceRunFinished(
  payload: Record<string, unknown>,
  channelId: string,
  deps: IChallengeJobDeps,
): Promise<string> {
  const challenge = payloadChallenge(payload);
  const run = payloadRun(payload);
  const { games, more } = shelved(entriesIn(run, "cleared"));
  const image = await shelfImage(games, more, deps);
  await deps.postMessage(channelId, buildRunFinishedPost(challenge, run, { games, more, image }));
  return `Announced ${memberName(run.user)}'s Finished Run of "${challenge.name}" (${run.id}).`;
}
