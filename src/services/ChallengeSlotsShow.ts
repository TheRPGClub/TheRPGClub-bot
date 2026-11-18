import {
  ActionRowBuilder,
  ButtonBuilder,
  ContainerBuilder,
  SectionBuilder,
  StringSelectMenuBuilder,
} from "@discordjs/builders";
import { ButtonStyle, MessageFlags } from "discord-api-types/v10";
import { buildTextDisplay } from "../functions/ComponentsV2Utils.js";
import { escapeChallengeText, memberName } from "../functions/ChallengeCopy.js";
import {
  buildChallengeShowId,
  buildChallengeSlotsId,
  type ChallengeShowView,
} from "../functions/ChallengeCustomIds.js";
import {
  clearedEntries,
  decadeLabel,
  decadeOf,
  openYears,
  runDecades,
} from "../functions/ChallengeSlotsCopy.js";
import { DISCORD_BUTTON_LABEL_MAX } from "../config/textLimits.js";
import {
  buildChallengeShowView,
  challengeTextView,
  RUN_STATUS_LABELS,
  type IChallengeBrowseApi,
  type IChallengeView,
} from "./ChallengeBrowse.js";
import {
  CHALLENGE_API,
  readRunPages,
  type IChallengeApi,
  type IChallengeRun,
} from "./ChallengeApi.js";
import { plural } from "../utilities/TextUtils.js";

// A Slots Run in /challenge show (spec api#376, bot#1550), design 4D "Flip the view": one
// decade per page with every year's game named, buttons for the other decades, and for
// the Run's member the ways to move a game or pick past play.

export type IChallengeSlotsShowApi = Pick<IChallengeApi, "getRun">;

export interface IChallengeSlotsShowDeps {
  api?: IChallengeSlotsShowApi;
}

/** Decade buttons fit one row; a Run of more decades gets a select instead. */
const DECADE_BUTTONS_MAX = 5;

type Row = ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>;

/** The decade a Run opens on: its first open year's, else its last. */
export function defaultDecade(run: IChallengeRun): number {
  const open = openYears(run)[0];
  const last = run.slots?.last_year ?? new Date().getUTCFullYear();
  return decadeOf(open ?? last);
}

function headerText(challengeName: string, run: IChallengeRun): string {
  const { cleared, target, caught_up: caughtUp } = run.progress;
  const parts = [`**${escapeChallengeText(memberName(run.user))}**'s Run`];
  if (run.status !== "active") parts.push(RUN_STATUS_LABELS[run.status] ?? run.status);
  parts.push(`${cleared} of ${plural(target, "year")}`);
  if (caughtUp) parts.push("Caught Up");
  return `## ${escapeChallengeText(challengeName)}\n${parts.join(" · ")}`;
}

function decadeText(run: IChallengeRun, decade: number): string {
  const years = (run.slots?.years ?? []).filter((y) => decadeOf(y.year) === decade);
  const filled = years.filter((y) => y.game_id).length;
  const lines = [`### ${decadeLabel(decade)} · ${filled} of ${years.length} Cleared`];
  for (const year of years) {
    const game = year.game_id ? `**${escapeChallengeText(year.title ?? "")}**` : "*open*";
    lines.push(`\`${year.year}\` ${game}`);
  }
  if (!years.length) lines.push("This Run has no years in that decade.");
  const waiting = clearedEntries(run).filter((entry) => !entry.slot_year);
  if (waiting.length) {
    const titles = waiting.map((entry) => escapeChallengeText(entry.title)).join(", ");
    lines.push(`-# Cleared and waiting for an open year: ${titles}`);
  }
  return lines.join("\n");
}

function decadeRow(run: IChallengeRun, decade: number): Row | null {
  const decades = runDecades(run);
  if (decades.length <= 1) return null;
  if (decades.length > DECADE_BUTTONS_MAX) {
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(buildChallengeSlotsId({ action: "decades", ids: [run.id] }))
        .setPlaceholder("Another decade")
        .addOptions(...decades.map((d) => ({
          label: decadeLabel(d),
          value: String(d),
          default: d === decade,
        }))),
    );
  }
  return new ActionRowBuilder<ButtonBuilder>().addComponents(...decades.map((d) =>
    new ButtonBuilder()
      .setCustomId(buildChallengeSlotsId({ action: "decade", ids: [run.id, d], reply: "update" }))
      .setLabel(decadeLabel(d))
      .setStyle(d === decade ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(d === decade)));
}

/** Move a game and Pick past play: the Run's member only, while it is Active. */
function actionRow(run: IChallengeRun, actingUserId: string): Row | null {
  if (run.user.user_id !== actingUserId || run.status !== "active") return null;
  const buttons = [
    new ButtonBuilder()
      .setCustomId(buildChallengeSlotsId({ action: "move", ids: [run.id] }))
      .setLabel("Move a game")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!clearedEntries(run).length || !openYears(run).length),
  ];
  if (run.challenge?.counts_past_play) {
    buttons.push(new ButtonBuilder()
      .setCustomId(buildChallengeSlotsId({ action: "pick", ids: [run.id] }))
      .setLabel("Pick past play")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!openYears(run).length));
  }
  return new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
}

/**
 * The decade page of a Slots Run as it stands, with its Challenge as the Run serves it
 * (name and Counts past play). `notice` leads it (what a move or pick just did).
 */
export function slotsRunView(
  run: IChallengeRun,
  options: { decade?: number; actingUserId: string; notice?: string },
): IChallengeView {
  const decade = options.decade ?? defaultDecade(run);
  const challengeId = run.challenge?.id ?? 0;
  const name = run.challenge?.name ?? `Challenge Run ${run.id}`;
  const header = buildTextDisplay(headerText(name, run));
  const container = new ContainerBuilder();
  if (options.notice) container.addTextDisplayComponents(buildTextDisplay(options.notice));
  if (challengeId > 0) {
    const section = new SectionBuilder().addTextDisplayComponents(header);
    section.setButtonAccessory(new ButtonBuilder()
      .setCustomId(buildChallengeShowId({ challengeId, view: "member", page: 1, reply: "update" }))
      .setLabel(memberName(run.user).slice(0, DISCORD_BUTTON_LABEL_MAX))
      .setStyle(ButtonStyle.Secondary));
    container.addSectionComponents(section);
  } else {
    container.addTextDisplayComponents(header);
  }
  container.addTextDisplayComponents(buildTextDisplay(decadeText(run, decade)));
  const rows = [decadeRow(run, decade), actionRow(run, options.actingUserId)]
    .filter((row): row is Row => row !== null);
  return {
    components: [container.toJSON(), ...rows.map((row) => row.toJSON())],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

/** Reads a Slots Run and shows one of its decades. API errors are thrown for the caller. */
export async function buildSlotsRunView(
  input: { runId: number; decade?: number; actingUserId: string; notice?: string },
  deps: IChallengeSlotsShowDeps = {},
): Promise<IChallengeView> {
  const api = deps.api ?? CHALLENGE_API;
  const run = await api.getRun(input.runId, input.actingUserId);
  if (!run) return challengeTextView(`There is no Run ${input.runId}, or it is hidden from you.`);
  if (!run.slots) return challengeTextView("That Run has no slots: it isn't a Slots Run.");
  return slotsRunView(run, input);
}

/** The acting member's Run of a Challenge: their Active one, else their newest. */
async function memberRunOf(
  api: Pick<IChallengeApi, "listMemberRuns">,
  challengeId: number,
  actingUserId: string,
): Promise<IChallengeRun | null> {
  const runs = (await readRunPages((page, per) =>
    api.listMemberRuns(actingUserId, actingUserId, page, per)))
    .filter((run) => run.challenge?.id === challengeId);
  return runs.find((run) => run.status === "active") ?? runs[0] ?? null;
}

export type IChallengeShowApi = IChallengeBrowseApi & Pick<IChallengeApi, "listMemberRuns">;

/**
 * /challenge show with Slots: a Slots Challenge has no Pool, so its first view is the
 * acting member's own Run by decade (by member when they have none). Every other view is
 * the Pool by game or the Runs by member. API errors are thrown for the caller.
 */
export async function buildShowView(
  target: { challengeId: number; view: ChallengeShowView; page: number; actingUserId: string },
  deps: { api?: IChallengeShowApi; now?: () => Date } = {},
): Promise<IChallengeView> {
  const api = deps.api ?? CHALLENGE_API;
  if (target.view === "game") {
    const challenge = await api.getChallenge(target.challengeId, target.actingUserId);
    if (challenge?.challenge_format === "slots") {
      const run = await memberRunOf(api, challenge.id, target.actingUserId);
      if (run?.slots) return slotsRunView(run, { actingUserId: target.actingUserId });
      return buildChallengeShowView({ ...target, view: "member", page: 1 }, deps);
    }
  }
  return buildChallengeShowView(target, deps);
}
