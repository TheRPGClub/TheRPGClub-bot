import {
  ActionRowBuilder,
  ButtonBuilder,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "@discordjs/builders";
import { ButtonStyle, MessageFlags } from "discord-api-types/v10";
import { buildTextContainer, buildTextDisplay } from "../functions/ComponentsV2Utils.js";
import {
  CHALLENGE_FORMAT_INKS,
  clubToday,
  escapeChallengeText,
  listJoin,
} from "../functions/ChallengeCopy.js";
import { buildChallengeSlotsId } from "../functions/ChallengeCustomIds.js";
import { clearedEntries, nextSlotYear, openYears } from "../functions/ChallengeSlotsCopy.js";
import { commandMention } from "./CommandMentionService.js";
import type { IChallengeView } from "./ChallengeBrowse.js";
import {
  CHALLENGE_API,
  readRunPages,
  type IChallengeOpenSignup,
  type IChallengeRun,
  type IPage,
} from "./ChallengeApi.js";
import { assignmentAdvice, signedUpLine } from "./ChallengeSignup.js";
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
import { plural } from "../utilities/TextUtils.js";

// /challenge my-runs (spec api#376, bot#1547), design 5C "What's next": each Active Run
// as advice (what is left, and which game you're playing would count), past Runs behind
// the `past` option. Slots Runs (bot#1550) name their open years, which game In Progress
// fits one, and offer moving a game and picking past play. Secret Santa Runs say where the
// gift is, and an Edition the member signed up for shows until its draw (bot#1551).

/**
 * What the view reads: the member's Runs, which carry all a card needs (covers, release
 * years, Counts past play), with their Secret Santa sign-ups in sign-up.
 */
export interface IMyRunsDeps {
  api?: Pick<IChallengeRunsApi, "listMemberRuns">;
  now?: () => Date;
}

/** Active Runs shown as cards, while their components fit Discord's 40. */
const ACTIVE_CARDS_MAX = 8;
const COMPONENTS_MAX = 40;
/** Open years named before "and N more", and In Progress games named on a Slots card. */
const OPEN_YEARS_NAMED = 10;
const PLAYING_NAMED = 3;
/** Past Runs listed before "and N older Runs". */
const PAST_SHOWN_MAX = 20;

function view(components: (ContainerBuilder | TextDisplayBuilder)[]): IChallengeView {
  return {
    components: components.map((component) => component.toJSON()),
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

/** Every Run of the member, and their sign-ups (served with every page). */
async function memberRuns(
  api: Pick<IChallengeRunsApi, "listMemberRuns">,
  userId: string,
): Promise<{ runs: IChallengeRun[]; signups: IChallengeOpenSignup[] }> {
  let signups: IChallengeOpenSignup[] = [];
  const runs = await readRunPages(async (page, per) => {
    const result = await api.listMemberRuns(userId, userId, page, per);
    if (page === 1) signups = result.signups ?? [];
    return result;
  });
  return { runs, signups };
}

/** Counts past play is on for the Run's Challenge (Slots only). */
function countsPastPlay(run: IChallengeRun): boolean {
  return run.challenge?.counts_past_play ?? false;
}

/** The advice for a Pool Run: what is left, and what you're playing that counts. */
function poolAdvice(run: IChallengeRun): string[] {
  const name = `**${runChallengeName(run)}**`;
  const { cleared, target } = run.progress;
  const left = Math.max(0, target - cleared);
  let first = `${name} needs ${plural(left, "more Cleared game")}.`;
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

function yearsText(years: readonly number[]): string {
  const named = years.slice(0, OPEN_YEARS_NAMED).map(String);
  const more = years.length - named.length;
  return more > 0 ? `${named.join(", ")} and ${more} more` : named.join(", ");
}

/** The advice for a Slots Run: its open years, or Caught Up, and what would fill one. */
function slotsAdvice(run: IChallengeRun): string[] {
  const name = `**${runChallengeName(run)}**`;
  const open = openYears(run);
  const lines: string[] = [];
  if (run.progress.caught_up || !open.length) {
    const last = run.slots?.last_year;
    lines.push(run.progress.caught_up && last
      ? `${name} is Caught Up: every year to ${last} has a Cleared game.`
      : `${name} has every slot filled.`);
    const next = nextSlotYear(run);
    if (next) lines.push(`The ${next} slot opens on 1 January.`);
  } else {
    lines.push(`${name} has ${plural(open.length, "open year")}: ${yearsText(open)}.`);
  }
  for (const entry of entriesIn(run, "in_progress").slice(0, PLAYING_NAMED)) {
    const title = `**${escapeChallengeText(entry.title)}**`;
    // Null for a game whose years the API couldn't give: its fit is left unsaid.
    const released = entry.release_years;
    if (!released) {
      lines.push(`${title} is In Progress.`);
      continue;
    }
    const fits = open.filter((year) => released.includes(year));
    lines.push(fits.length
      ? `${title} is In Progress and fits ${listJoin(fits.map(String))}.`
      : `${title} is In Progress, but its years are filled.`);
  }
  const waiting = clearedEntries(run).filter((entry) => !entry.slot_year);
  if (waiting.length) {
    lines.push(`${boldTitles(waiting)} ${waiting.length === 1 ? "is" : "are"} Cleared and ` +
      "waiting for an open year. Move a game to make room.");
  }
  if (countsPastPlay(run) && open.length) {
    lines.push("-# Counts past play is on: you can pick an earlier Game Completion for an " +
      "open year.");
  }
  return lines;
}

/** A Slots card's buttons: Pick past play and Move a game, while a year is open. */
function slotsButtons(run: IChallengeRun): ButtonBuilder[] {
  if (!openYears(run).length) return [];
  const buttons: ButtonBuilder[] = [];
  if (countsPastPlay(run)) {
    buttons.push(new ButtonBuilder()
      .setCustomId(buildChallengeSlotsId({ action: "pick", ids: [run.id] }))
      .setLabel("Pick past play")
      .setStyle(ButtonStyle.Secondary));
  }
  if (clearedEntries(run).length) {
    buttons.push(new ButtonBuilder()
      .setCustomId(buildChallengeSlotsId({ action: "move", ids: [run.id] }))
      .setLabel("Move a game")
      .setStyle(ButtonStyle.Secondary));
  }
  return buttons;
}

/** A card and how many components it holds (Discord counts every nested one). */
function runCard(
  run: IChallengeRun,
  today: string,
): { container: ContainerBuilder; components: number } {
  const format = run.challenge?.challenge_format ?? "pool";
  const coverUrl = runCover(run);
  let lines: string[];
  if (format === "pool") lines = poolAdvice(run);
  else if (run.slots) lines = slotsAdvice(run);
  else if (format === "assignment") lines = assignmentAdvice(run, today);
  else lines = [`**${runChallengeName(run)}** · ${runProgressText(run)}`];
  const closes = runClosesText(run);
  if (format !== "slots" || closes) lines.push(`-# ${closes ?? "Always Open, no end date"}`);
  const container = new ContainerBuilder().setAccentColor(CHALLENGE_FORMAT_INKS[format]);
  const body = buildTextDisplay(lines.join("\n"));
  let components = 2;
  if (coverUrl) {
    const section = new SectionBuilder().addTextDisplayComponents(body);
    section.setThumbnailAccessory(new ThumbnailBuilder().setURL(coverUrl));
    container.addSectionComponents(section);
    components += 2;
  } else {
    container.addTextDisplayComponents(body);
  }
  const buttons = run.slots ? slotsButtons(run) : [];
  if (buttons.length) {
    container.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons),
    );
    components += 1 + buttons.length;
  }
  return { container, components };
}

/** The cover of the gift once revealed, else of the first game the member is playing. */
function runCover(run: IChallengeRun): string | null {
  const gift = run.assignment?.game?.cover_url;
  if (gift) return gift;
  return entriesIn(run, "in_progress")[0]?.cover_url ?? null;
}

function pastRunText(run: IChallengeRun): string {
  const parts = [`**${runChallengeName(run)}**`, runStatusLabel(run.status), runProgressText(run)];
  const started = formatRunDate(run.started_at);
  const ended = run.ended_at ? formatRunDate(run.ended_at) : null;
  return `${parts.join(" · ")}\n-# ${ended ? `${started} to ${ended}` : `Started ${started}`}`;
}

/** The newest Runs that ended (one page of them), and how many ended in all. */
function pastView(past: IPage<IChallengeRun>): IChallengeView {
  const lines = ["## Your past Runs"];
  if (!past.items.length) lines.push("You have no past Runs yet.");
  lines.push(...past.items.map(pastRunText));
  const more = past.count - past.items.length;
  if (more > 0) lines.push(`-# And ${plural(more, "older Run")}.`);
  if (past.items.length) {
    lines.push(`-# Remove one with ${commandMention("challenge delete-run")}.`);
  }
  return view([buildTextContainer(lines.join("\n"))]);
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
  const today = clubToday(deps.now?.() ?? new Date());
  if (input.past) {
    const userId = input.actingUserId;
    return pastView(await api.listMemberRuns(userId, userId, 1, PAST_SHOWN_MAX, "ended"));
  }
  const { runs, signups } = await memberRuns(api, input.actingUserId);
  const active = runs.filter((run) => run.status === "active");
  const past = runs.filter((run) => run.status !== "active");

  const header = new ContainerBuilder().addTextDisplayComponents(
    buildTextDisplay("## What's next for your Runs"),
  );
  const components: (ContainerBuilder | TextDisplayBuilder)[] = [header];
  const candidates = active.slice(0, ACTIVE_CARDS_MAX);
  // The header, its text, the footer and each sign-up card, then Run cards while they fit.
  let used = 3 + signups.length * 2;
  let shownCards = 0;
  for (const run of candidates) {
    const card = runCard(run, today);
    if (used + card.components > COMPONENTS_MAX) break;
    used += card.components;
    components.push(card.container);
    shownCards += 1;
  }
  for (const signup of signups) {
    components.push(new ContainerBuilder()
      .setAccentColor(CHALLENGE_FORMAT_INKS.assignment)
      .addTextDisplayComponents(buildTextDisplay(signedUpLine(signup))));
  }
  if (!active.length && !signups.length) {
    header.addTextDisplayComponents(buildTextDisplay(
      `You have no Active Runs. Find an Open Challenge with ${commandMention("challenge list")} ` +
        `and start a Run with ${commandMention("challenge start")}.`,
    ));
  }

  const footer: string[] = [];
  const hidden = active.slice(shownCards);
  if (hidden.length) {
    footer.push(`-# Also Active: ${hidden.map((run) => runChallengeName(run)).join(", ")}`);
  }
  if (past.length) {
    footer.push(
      `-# ${plural(past.length, "past Run")} · ` +
        `${commandMention("challenge my-runs")} past:True`,
    );
  }
  if (footer.length) components.push(buildTextDisplay(footer.join("\n")));
  return view(components);
}
