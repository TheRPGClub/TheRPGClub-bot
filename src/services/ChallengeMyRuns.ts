import {
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "@discordjs/builders";
import { MessageFlags } from "discord-api-types/v10";
import { safeV2TextContent } from "../functions/ComponentsV2Utils.js";
import { CHALLENGE_FORMAT_INKS } from "../functions/ChallengeCopy.js";
import { MAX_CONTAINER_TEXT } from "../config/textLimits.js";
import { fetchGameCoverUrl } from "./GameImageService.js";
import { commandMention } from "./CommandMentionService.js";
import type { IChallengeView } from "./ChallengeBrowse.js";
import { CHALLENGE_API, type IChallengeRun } from "./ChallengeApi.js";
import {
  boldTitles,
  entriesIn,
  formatRunDate,
  runChallengeName,
  runClosesText,
  runProgressText,
  runStatusLabel,
  type IChallengeRunsApi,
} from "./ChallengeRuns.js";

// /challenge my-runs (spec api#376, bot#1547), design 5C "What's next": each Active Run
// as advice (what is left, and which game you're playing would count), past Runs behind
// the `past` option. Slots and Assignment advice come with their tickets (bot#1550,
// bot#1551); until then their Runs show their progress plainly.

export interface IMyRunsDeps {
  api?: Pick<IChallengeRunsApi, "listMemberRuns">;
  now?: () => Date;
  /** A game's cover image URL, for the Run's thumbnail; null without one. */
  coverUrl?: (gameId: number) => Promise<string | null>;
}

/** Runs read per request, and at most this many requests. */
const RUNS_PER_REQUEST = 100;
const RUNS_MAX_REQUESTS = 5;
/** Active Runs shown as cards (4 components each, within Discord's 40). */
const ACTIVE_CARDS_MAX = 8;
/** Past Runs listed before "and N older Runs". */
const PAST_SHOWN_MAX = 20;

function text(content: string): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(safeV2TextContent(content, MAX_CONTAINER_TEXT));
}

function view(components: (ContainerBuilder | TextDisplayBuilder)[]): IChallengeView {
  return {
    components: components.map((component) => component.toJSON()),
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

async function memberRuns(
  api: Pick<IChallengeRunsApi, "listMemberRuns">,
  userId: string,
): Promise<IChallengeRun[]> {
  const runs: IChallengeRun[] = [];
  for (let page = 1; page <= RUNS_MAX_REQUESTS; page += 1) {
    const result = await api.listMemberRuns(userId, userId, page, RUNS_PER_REQUEST);
    runs.push(...result.items);
    if (page >= result.pages) break;
  }
  return runs;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The advice for a Pool Run: what is left, and what you're playing that counts. */
function poolAdvice(run: IChallengeRun): string[] {
  const name = `**${runChallengeName(run)}**`;
  const { cleared, target } = run.progress;
  const left = Math.max(0, target - cleared);
  let first = `${name} needs ${plural(left, "more Cleared game", "more Cleared games")}.`;
  if (target === 0) first = `${name} has no games in its Pool yet.`;
  else if (left === 0) first = `${name} has all the Cleared games it needs.`;
  const lines = [first];
  const playing = entriesIn(run, "in_progress");
  const log = commandMention("game-completion add");
  if (playing.length) {
    lines.push(
      `You're playing ${boldTitles(playing)}. Log ${playing.length === 1 ? "it" : "them"} ` +
        `with ${log} when you finish.`,
    );
  } else if (left > 0) {
    lines.push(
      "None of your Now Playing games are in its Pool. See them with " +
        `${commandMention("challenge show")}.`,
    );
  }
  return lines;
}

function runCard(run: IChallengeRun, coverUrl: string | null): ContainerBuilder {
  const format = run.challenge?.challenge_format ?? "pool";
  const lines = format === "pool"
    ? poolAdvice(run)
    : [`**${runChallengeName(run)}** · ${runProgressText(run)}`];
  lines.push(`-# ${runClosesText(run) ?? "Always Open, no end date"}`);
  const container = new ContainerBuilder().setAccentColor(CHALLENGE_FORMAT_INKS[format]);
  const body = text(lines.join("\n"));
  if (coverUrl) {
    const section = new SectionBuilder().addTextDisplayComponents(body);
    section.setThumbnailAccessory(new ThumbnailBuilder().setURL(coverUrl));
    container.addSectionComponents(section);
  } else {
    container.addTextDisplayComponents(body);
  }
  return container;
}

/** The cover of the first game the member is playing for the Run, if any. */
async function runCover(
  run: IChallengeRun,
  coverUrl: (gameId: number) => Promise<string | null>,
): Promise<string | null> {
  const playing = entriesIn(run, "in_progress")[0];
  if (!playing) return null;
  try {
    return await coverUrl(playing.game_id);
  } catch {
    return null;
  }
}

function pastRunText(run: IChallengeRun): string {
  const parts = [`**${runChallengeName(run)}**`, runStatusLabel(run.status), runProgressText(run)];
  const started = formatRunDate(run.started_at);
  const ended = run.ended_at ? formatRunDate(run.ended_at) : null;
  return `${parts.join(" · ")}\n-# ${ended ? `${started} to ${ended}` : `Started ${started}`}`;
}

function pastView(past: readonly IChallengeRun[]): IChallengeView {
  const lines = ["## Your past Runs"];
  if (!past.length) lines.push("You have no past Runs yet.");
  lines.push(...past.slice(0, PAST_SHOWN_MAX).map(pastRunText));
  const more = past.length - PAST_SHOWN_MAX;
  if (more > 0) lines.push(`-# And ${plural(more, "older Run", "older Runs")}.`);
  if (past.length) {
    lines.push(`-# Remove one with ${commandMention("challenge delete-run")}.`);
  }
  return view([new ContainerBuilder().addTextDisplayComponents(text(lines.join("\n")))]);
}

/**
 * /challenge my-runs for the acting member: their Active Runs as "what's next" cards, or
 * with `past` the Runs that ended. API errors are thrown for the caller's error reply.
 */
export async function buildMyRunsView(
  input: { actingUserId: string; past: boolean },
  deps: IMyRunsDeps = {},
): Promise<IChallengeView> {
  const api = deps.api ?? CHALLENGE_API;
  const coverUrl = deps.coverUrl ?? fetchGameCoverUrl;
  const runs = await memberRuns(api, input.actingUserId);
  const active = runs.filter((run) => run.status === "active");
  const past = runs.filter((run) => run.status !== "active");
  if (input.past) return pastView(past);

  const header = new ContainerBuilder().addTextDisplayComponents(
    text("## What's next for your Runs"),
  );
  const components: (ContainerBuilder | TextDisplayBuilder)[] = [header];
  const cards = active.slice(0, ACTIVE_CARDS_MAX);
  const covers = await Promise.all(cards.map((run) => runCover(run, coverUrl)));
  cards.forEach((run, index) => components.push(runCard(run, covers[index] ?? null)));
  if (!active.length) {
    header.addTextDisplayComponents(text(
      `You have no Active Runs. Find an Open Challenge with ${commandMention("challenge list")} ` +
        `and start a Run with ${commandMention("challenge start")}.`,
    ));
  }

  const footer: string[] = [];
  const hidden = active.slice(ACTIVE_CARDS_MAX);
  if (hidden.length) {
    footer.push(`-# Also Active: ${hidden.map((run) => runChallengeName(run)).join(", ")}`);
  }
  if (past.length) {
    footer.push(
      `-# ${plural(past.length, "past Run", "past Runs")} · ` +
        `${commandMention("challenge my-runs")} past:True`,
    );
  }
  if (footer.length) components.push(text(footer.join("\n")));
  return view(components);
}
