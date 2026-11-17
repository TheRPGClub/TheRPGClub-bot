import {
  ActionRowBuilder,
  ButtonBuilder,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "@discordjs/builders";
import { ButtonStyle, MessageFlags } from "discord-api-types/v10";
import { buildTextDisplay } from "../functions/ComponentsV2Utils.js";
import {
  CHALLENGE_FORMAT_INKS,
  clubToday,
  escapeChallengeText,
  listJoin,
} from "../functions/ChallengeCopy.js";
import { buildChallengeSlotsId } from "../functions/ChallengeCustomIds.js";
import { clearedEntries, nextSlotYear, openYears } from "../functions/ChallengeSlotsCopy.js";
import { fetchGameCoverUrl } from "./GameImageService.js";
import { commandMention } from "./CommandMentionService.js";
import type { IChallengeView } from "./ChallengeBrowse.js";
import {
  CHALLENGE_API,
  readRunPages,
  type IChallenge,
  type IChallengeRun,
} from "./ChallengeApi.js";
import type { IChallengeEdition } from "./ChallengeEditionApi.js";
import { assignmentAdvice, signedUpEditions, signedUpLine } from "./ChallengeSignup.js";
import { fetchReleaseYears } from "./ChallengeSlotActions.js";
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

export interface IMyRunsDeps {
  api?: Pick<IChallengeRunsApi, "listMemberRuns">;
  now?: () => Date;
  /** A game's cover image URL, for the Run's thumbnail; null without one. */
  coverUrl?: (gameId: number) => Promise<string | null>;
  /** A Slots Run's Challenge, for Counts past play; null when it can't be read. */
  challenge?: (challengeId: number, actingUserId: string) => Promise<IChallenge | null>;
  /** A game's release years, for which open year an In Progress game fits. */
  releaseYears?: (gameId: number) => Promise<number[] | null>;
  /** The Secret Santa Editions in sign-up the member joined. */
  santaSignups?: (userId: string) => Promise<IChallengeEdition[]>;
}

/** A Slots Run's Challenge and its In Progress games' release years, read for its card. */
interface ISlotsFacts {
  countsPastPlay: boolean;
  released: Map<number, number[] | null>;
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

function memberRuns(
  api: Pick<IChallengeRunsApi, "listMemberRuns">,
  userId: string,
): Promise<IChallengeRun[]> {
  return readRunPages((page, per) => api.listMemberRuns(userId, userId, page, per));
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
function slotsAdvice(run: IChallengeRun, facts: ISlotsFacts): string[] {
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
    const released = facts.released.get(entry.game_id);
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
  if (facts.countsPastPlay && open.length) {
    lines.push("-# Counts past play is on: you can pick an earlier Game Completion for an " +
      "open year.");
  }
  return lines;
}

/** A Slots card's buttons: Pick past play and Move a game, while a year is open. */
function slotsButtons(run: IChallengeRun, facts: ISlotsFacts): ButtonBuilder[] {
  if (!openYears(run).length) return [];
  const buttons: ButtonBuilder[] = [];
  if (facts.countsPastPlay) {
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
  coverUrl: string | null,
  facts: ISlotsFacts | null,
  today: string,
): { container: ContainerBuilder; components: number } {
  const format = run.challenge?.challenge_format ?? "pool";
  let lines: string[];
  if (format === "pool") lines = poolAdvice(run);
  else if (facts && run.slots) lines = slotsAdvice(run, facts);
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
  const buttons = facts && run.slots ? slotsButtons(run, facts) : [];
  if (buttons.length) {
    container.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons),
    );
    components += 1 + buttons.length;
  }
  return { container, components };
}

/** Reads what a Slots Run's card needs; a failed read leaves that part out. */
async function slotsFacts(
  run: IChallengeRun,
  actingUserId: string,
  deps: Required<Pick<IMyRunsDeps, "challenge" | "releaseYears">>,
): Promise<ISlotsFacts | null> {
  if (!run.slots) return null;
  const playing = entriesIn(run, "in_progress").slice(0, PLAYING_NAMED);
  const [challenge, years] = await Promise.all([
    run.challenge ? deps.challenge(run.challenge.id, actingUserId).catch(() => null) : null,
    Promise.all(playing.map((entry) => deps.releaseYears(entry.game_id).catch(() => null))),
  ]);
  return {
    countsPastPlay: challenge?.slots?.counts_past_play ?? false,
    released: new Map(playing.map((entry, index) => [entry.game_id, years[index] ?? null])),
  };
}

/** The cover of the first game the member is playing for the Run, if any. */
async function runCover(
  run: IChallengeRun,
  coverUrl: (gameId: number) => Promise<string | null>,
): Promise<string | null> {
  // A Secret Santa Run shows its gift once revealed.
  const gift = run.assignment?.game?.cover_url;
  if (gift) return gift;
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
  if (more > 0) lines.push(`-# And ${plural(more, "older Run")}.`);
  if (past.length) {
    lines.push(`-# Remove one with ${commandMention("challenge delete-run")}.`);
  }
  return view([new ContainerBuilder().addTextDisplayComponents(buildTextDisplay(lines.join("\n")))]);
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
  const factDeps = {
    challenge: deps.challenge ??
      ((id: number, acting: string) => CHALLENGE_API.getChallenge(id, acting)),
    releaseYears: deps.releaseYears ?? fetchReleaseYears,
  };
  const today = clubToday(deps.now?.() ?? new Date());
  const [runs, signups] = await Promise.all([
    memberRuns(api, input.actingUserId),
    input.past ? [] : (deps.santaSignups ?? signedUpEditions)(input.actingUserId),
  ]);
  const active = runs.filter((run) => run.status === "active");
  const past = runs.filter((run) => run.status !== "active");
  if (input.past) return pastView(past);

  const header = new ContainerBuilder().addTextDisplayComponents(
    buildTextDisplay("## What's next for your Runs"),
  );
  const components: (ContainerBuilder | TextDisplayBuilder)[] = [header];
  const candidates = active.slice(0, ACTIVE_CARDS_MAX);
  const [covers, facts] = await Promise.all([
    Promise.all(candidates.map((run) => runCover(run, coverUrl))),
    Promise.all(candidates.map((run) => slotsFacts(run, input.actingUserId, factDeps))),
  ]);
  // The header, its text, the footer and each sign-up card, then Run cards while they fit.
  let used = 3 + signups.length * 2;
  let shownCards = 0;
  for (const [index, run] of candidates.entries()) {
    const card = runCard(run, covers[index] ?? null, facts[index] ?? null, today);
    if (used + card.components > COMPONENTS_MAX) break;
    used += card.components;
    components.push(card.container);
    shownCards += 1;
  }
  for (const edition of signups) {
    components.push(new ContainerBuilder()
      .setAccentColor(CHALLENGE_FORMAT_INKS.assignment)
      .addTextDisplayComponents(buildTextDisplay(signedUpLine(edition))));
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
