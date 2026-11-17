import {
  ButtonBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SectionBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import { ButtonStyle, MessageFlags } from "discord-api-types/v10";
import { safeV2TextContent } from "../functions/ComponentsV2Utils.js";
import { escapeChallengeText, memberName } from "../functions/ChallengeCopy.js";
import { buildChallengeSlotsId } from "../functions/ChallengeCustomIds.js";
import { decadeOf, nextSlotYear } from "../functions/ChallengeSlotsCopy.js";
import { DISCORD_BUTTON_LABEL_MAX, MAX_CONTAINER_TEXT } from "../config/textLimits.js";
import { logError } from "../utilities/LogUtils.js";
import type { IChallenge, IChallengeRun } from "./ChallengeApi.js";
import {
  payloadChallenge,
  type IChallengeJobDeps,
  type IChallengePost,
} from "./ChallengeAnnouncements.js";
import { payloadRun } from "./ChallengeRunFinished.js";
import { formatRunDate } from "./ChallengeRuns.js";
import { composeYearPoster, type IPosterYear } from "./ChallengeSlotsImage.js";

// The Caught Up post in #challenges (`run_caught_up`, design 3B "Shelf"): a Slots Run
// that grows each year, with every year so far Cleared, as a poster of its years.

/** Covers read at once while drawing the poster. */
const COVERS_AT_ONCE = 8;

const LOG_CONTEXT = "ChallengeCaughtUp";

function text(content: string): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(safeV2TextContent(content, MAX_CONTAINER_TEXT));
}

async function coversOf(
  gameIds: readonly number[],
  deps: IChallengeJobDeps,
): Promise<Map<number, Buffer | null>> {
  const covers = new Map<number, Buffer | null>();
  for (let i = 0; i < gameIds.length; i += COVERS_AT_ONCE) {
    const batch = gameIds.slice(i, i + COVERS_AT_ONCE);
    const images = await Promise.all(batch.map((id) => deps.coverImage(id)));
    batch.forEach((id, index) => covers.set(id, images[index] ?? null));
  }
  return covers;
}

/** The poster, or null when the Run has no years (or it can't be drawn). */
async function posterImage(
  challenge: Pick<IChallenge, "name">,
  run: IChallengeRun,
  deps: IChallengeJobDeps,
): Promise<Buffer | null> {
  const slots = run.slots;
  if (!slots?.years.length) return null;
  const gameIds = slots.years.flatMap((y) => (y.game_id ? [y.game_id] : []));
  const covers = await coversOf(gameIds, deps);
  const years: IPosterYear[] = slots.years.map((y) => ({
    year: y.year,
    game: y.game_id
      ? { title: y.title ?? "", cover: covers.get(y.game_id) ?? null }
      : null,
  }));
  try {
    return await composeYearPoster({
      name: memberName(run.user),
      caption: `${challenge.name} · ${slots.first_year} to ${slots.last_year}`,
      cleared: run.progress.cleared,
      target: run.progress.target,
      years,
    });
  } catch (err: unknown) {
    logError(`${LOG_CONTEXT}.posterImage`, err);
    return null;
  }
}

function bodyText(run: IChallengeRun): string {
  const lines: string[] = [];
  const slots = run.slots;
  if (slots) {
    const next = nextSlotYear(run);
    lines.push(
      `Every year from ${slots.first_year} to ${slots.last_year} has a Cleared game.` +
        (next ? ` The ${next} slot opens on 1 January.` : ""),
    );
  }
  const count = run.progress.target;
  lines.push(
    `-# ${count} ${count === 1 ? "slot" : "slots"} · Run started ${formatRunDate(run.started_at)}`,
  );
  return lines.join("\n");
}

/** The post: heading and Challenge, the member's button, the poster, and the Run in words. */
export function buildCaughtUpPost(
  challenge: Pick<IChallenge, "id" | "name">,
  run: IChallengeRun,
  image: Buffer | null,
): IChallengePost {
  const fileName = `caught-up-${run.id}.png`;
  const lastYear = run.slots?.last_year ?? new Date().getUTCFullYear();
  const member = new ButtonBuilder()
    .setCustomId(buildChallengeSlotsId({
      action: "decade",
      ids: [run.id, decadeOf(lastYear)],
      reply: "new",
    }))
    .setLabel(memberName(run.user).slice(0, DISCORD_BUTTON_LABEL_MAX))
    .setStyle(ButtonStyle.Secondary);
  const heading = new SectionBuilder().addTextDisplayComponents(text(
    `## Caught Up\n**${escapeChallengeText(challenge.name)}**`,
  ));
  heading.setButtonAccessory(member);
  const container = new ContainerBuilder().addSectionComponents(heading);
  if (image) {
    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder()
        .setURL(`attachment://${fileName}`)
        .setDescription(`${memberName(run.user)}'s years`),
    ));
  }
  container.addTextDisplayComponents(text(bodyText(run)));
  return {
    components: [container.toJSON()],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
    ...(image ? { files: [{ name: fileName, data: image }] } : {}),
  };
}

/**
 * Payload `{ event: "run_caught_up", challenge, run, feature_key }`: posts the Caught Up
 * Run in `channelId`. Returns the job's result text.
 */
export async function announceRunCaughtUp(
  payload: Record<string, unknown>,
  channelId: string,
  deps: IChallengeJobDeps,
): Promise<string> {
  const challenge = payloadChallenge(payload);
  const run = payloadRun(payload);
  const image = await posterImage(challenge, run, deps);
  await deps.postMessage(channelId, buildCaughtUpPost(challenge, run, image));
  return `Announced ${memberName(run.user)}'s Caught Up Run of "${challenge.name}" (${run.id}).`;
}
