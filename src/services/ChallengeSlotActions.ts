import { ActionRowBuilder, ContainerBuilder, StringSelectMenuBuilder } from "@discordjs/builders";
import { MessageFlags } from "discord-api-types/v10";
import { buildTextDisplay } from "../functions/ComponentsV2Utils.js";
import { escapeChallengeText, formatChallengeDate } from "../functions/ChallengeCopy.js";
import { buildChallengeSlotsId } from "../functions/ChallengeCustomIds.js";
import { clearedEntries, decadeOf, openYears } from "../functions/ChallengeSlotsCopy.js";
import {
  DISCORD_AUTOCOMPLETE_CHOICES_MAX,
  DISCORD_SELECT_LABEL_MAX,
  DISCORD_SELECT_OPTIONS_MAX,
  truncateLabel,
} from "../config/textLimits.js";
import { commandMention } from "./CommandMentionService.js";
import { challengeTextView, type IChallengeView } from "./ChallengeBrowse.js";
import { slotsRunView } from "./ChallengeSlotsShow.js";
import {
  CHALLENGE_API,
  challengeRefusalText,
  type IChallengeApi,
  type IChallengeRun,
  type IChallengeRunEntry,
  type IPastPlay,
} from "./ChallengeApi.js";

// Moving games and picking past play on a Slots Run (spec api#376, bot#1550): the
// /challenge slot-move and past-pick replies and autocompletes, and the select steps the
// Move a game and Pick past play buttons lead through. The API decides every rule (own
// Active Run, open year, a year the game came out in, Counts past play); its refusals are
// shown as given, with the request and response.

export type IChallengeSlotActionsApi = Pick<
  IChallengeApi,
  "getRun" | "slotMove" | "pastPick" | "pastPlay"
>;

export interface IChallengeSlotActionsDeps {
  api?: IChallengeSlotActionsApi;
}

/** What to show: a view, or an error (the API's refusal with its request and response). */
export type ChallengeSlotResult = { view: IChallengeView } | { error: string };

function pickerView(
  content: string,
  select: StringSelectMenuBuilder | null,
): IChallengeView {
  const container = new ContainerBuilder().addTextDisplayComponents(buildTextDisplay(content));
  const rows = select
    ? [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)]
    : [];
  return {
    components: [container.toJSON(), ...rows.map((row) => row.toJSON())],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

function runName(run: IChallengeRun): string {
  return run.challenge ? escapeChallengeText(run.challenge.name) : `Challenge Run ${run.id}`;
}

/**
 * The open years of the Run that its game fits (the entry's release_years): all of them
 * when the API couldn't give its years.
 */
export function fittingOpenYears(run: IChallengeRun, entry: IChallengeRunEntry | undefined):
  number[] {
  const open = openYears(run);
  const released = entry?.release_years;
  return released ? open.filter((year) => released.includes(year)) : open;
}

/** The Run and why it can't be changed, or null when it can be read and is a Slots Run. */
async function readSlotsRun(
  api: IChallengeSlotActionsApi,
  runId: number,
  actingUserId: string,
): Promise<{ run: IChallengeRun } | { view: IChallengeView }> {
  const run = await api.getRun(runId, actingUserId);
  if (!run) {
    return { view: challengeTextView(`There is no Run ${runId}, or it is hidden from you.`) };
  }
  if (!run.slots) return { view: challengeTextView("That Run isn't a Slots Run.") };
  return { run };
}

/** Moves a Cleared game of the acting member's Run to another open year. */
export async function slotMoveReply(
  input: { runId: number; gameId: number; year: number; actingUserId: string },
  deps: IChallengeSlotActionsDeps = {},
): Promise<ChallengeSlotResult> {
  const api = deps.api ?? CHALLENGE_API;
  let run: IChallengeRun;
  try {
    run = await api.slotMove(input.runId, input.gameId, input.year, input.actingUserId);
  } catch (err: unknown) {
    return { error: challengeRefusalText(err, "Could not move the game.") };
  }
  const entry = (run.entries ?? []).find((e) => e.game_id === input.gameId);
  const title = entry ? `**${escapeChallengeText(entry.title)}**` : "The game";
  const notice = `Moved ${title} to ${input.year}.`;
  return {
    view: slotsRunView(run, {
      decade: decadeOf(input.year),
      actingUserId: input.actingUserId,
      notice,
    }),
  };
}

/** Picks an earlier Game Completion for an open year of the acting member's Run. */
export async function pastPickReply(
  input: { runId: number; completionId: number; year: number; actingUserId: string },
  deps: IChallengeSlotActionsDeps = {},
): Promise<ChallengeSlotResult> {
  const api = deps.api ?? CHALLENGE_API;
  let run: IChallengeRun;
  try {
    run = await api.pastPick(input.runId, input.completionId, input.year, input.actingUserId);
  } catch (err: unknown) {
    return { error: challengeRefusalText(err, "Could not pick the past play.") };
  }
  const filling = run.slots?.years.find((y) => y.year === input.year);
  const title = filling?.title ? `**${escapeChallengeText(filling.title)}**` : "The game";
  const notice = `Picked ${title} for ${input.year}.` +
    (run.status === "finished" ? " That Finished the Run." : "") +
    (run.progress.caught_up ? " You're Caught Up." : "");
  return {
    view: slotsRunView(run, {
      decade: decadeOf(input.year),
      actingUserId: input.actingUserId,
      notice,
    }),
  };
}

function yearLabel(year: number | null | undefined): string {
  return year ? `fills ${year}` : "waiting for an open year";
}

/** The Move a game step: a select of the Run's Cleared games. */
export async function movePickerView(
  input: { runId: number; actingUserId: string },
  deps: IChallengeSlotActionsDeps = {},
): Promise<ChallengeSlotResult> {
  const api = deps.api ?? CHALLENGE_API;
  try {
    const read = await readSlotsRun(api, input.runId, input.actingUserId);
    if ("view" in read) return read;
    const { run } = read;
    const games = clearedEntries(run);
    const open = openYears(run);
    if (!games.length || !open.length) {
      return {
        view: challengeTextView(games.length
          ? "Every year of the Run is filled, so there is no year to move a game to."
          : "The Run has no Cleared games to move yet."),
      };
    }
    const shown = games.slice(0, DISCORD_SELECT_OPTIONS_MAX);
    const lines = [
      `### Move a game in your Run of ${runName(run)}`,
      `Open years: ${open.join(", ")}. A game can fill any year it came out in, anywhere.`,
    ];
    if (games.length > shown.length) {
      lines.push(`-# Showing ${shown.length} of ${games.length} games. ` +
        `${commandMention("challenge slot-move")} searches them all.`);
    }
    return {
      view: pickerView(lines.join("\n"), new StringSelectMenuBuilder()
        .setCustomId(buildChallengeSlotsId({ action: "move-game", ids: [run.id] }))
        .setPlaceholder("The game to move")
        .addOptions(...shown.map((entry) => ({
          label: entry.title.slice(0, DISCORD_SELECT_LABEL_MAX),
          description: yearLabel(entry.slot_year),
          value: String(entry.game_id),
        })))),
    };
  } catch (err: unknown) {
    return { error: challengeRefusalText(err, "Could not read the Run.") };
  }
}

/** The second Move a game step: a select of the open years the game fits. */
export async function moveYearPickerView(
  input: { runId: number; gameId: number; actingUserId: string },
  deps: IChallengeSlotActionsDeps = {},
): Promise<ChallengeSlotResult> {
  const api = deps.api ?? CHALLENGE_API;
  try {
    const read = await readSlotsRun(api, input.runId, input.actingUserId);
    if ("view" in read) return read;
    const { run } = read;
    const entry = clearedEntries(run).find((e) => e.game_id === input.gameId);
    if (!entry) return { view: challengeTextView("That game isn't Cleared on the Run any more.") };
    const title = `**${escapeChallengeText(entry.title)}**`;
    const years = fittingOpenYears(run, entry).slice(-DISCORD_SELECT_OPTIONS_MAX);
    if (!years.length) {
      return {
        view: challengeTextView(`${title} didn't come out in any open year of the Run.`),
      };
    }
    const lines = [`### Move ${title}`, `It ${yearLabel(entry.slot_year)}. Pick its new year.`];
    if (!entry.release_years) {
      lines.push("-# Its release years couldn't be read; the API checks the fit.");
    }
    return {
      view: pickerView(lines.join("\n"), new StringSelectMenuBuilder()
        .setCustomId(buildChallengeSlotsId({ action: "move-year", ids: [run.id, entry.game_id] }))
        .setPlaceholder("Its new year")
        .addOptions(...years.map((year) => ({ label: String(year), value: String(year) })))),
    };
  } catch (err: unknown) {
    return { error: challengeRefusalText(err, "Could not read the Run.") };
  }
}

function playedOn(play: IPastPlay): string {
  return play.completed_at ? `Cleared ${formatChallengeDate(play.completed_at)}` : "No date";
}

function fitsText(play: IPastPlay): string {
  return `fits ${play.open_years.join(", ")}`;
}

/** The Pick past play step: a select of the earlier Game Completions that fit. */
export async function pastPlayPickerView(
  input: { runId: number; actingUserId: string },
  deps: IChallengeSlotActionsDeps = {},
): Promise<ChallengeSlotResult> {
  const api = deps.api ?? CHALLENGE_API;
  try {
    const plays = await api.pastPlay(input.runId, input.actingUserId);
    if (!plays.length) {
      return {
        view: challengeTextView(
          "None of your earlier Game Completions fit an open year of the Run.",
        ),
      };
    }
    const shown = plays.slice(0, DISCORD_SELECT_OPTIONS_MAX);
    const lines = [
      "### Pick past play",
      "Your Game Completions from before the Run that fit one of its open years.",
    ];
    if (plays.length > shown.length) {
      lines.push(`-# Showing the oldest ${shown.length} of ${plays.length}. ` +
        `${commandMention("challenge past-pick")} searches them all.`);
    }
    return {
      view: pickerView(lines.join("\n"), new StringSelectMenuBuilder()
        .setCustomId(buildChallengeSlotsId({ action: "pick-play", ids: [input.runId] }))
        .setPlaceholder("The game to pick")
        .addOptions(...shown.map((play) => ({
          label: play.title.slice(0, DISCORD_SELECT_LABEL_MAX),
          description: `${playedOn(play)} · ${fitsText(play)}`.slice(0, DISCORD_SELECT_LABEL_MAX),
          value: String(play.completion_id),
        })))),
    };
  } catch (err: unknown) {
    return { error: challengeRefusalText(err, "Could not read your past play.") };
  }
}

/** The second Pick past play step: the open years the picked game fits. */
export async function pastPlayYearPickerView(
  input: { runId: number; completionId: number; actingUserId: string },
  deps: IChallengeSlotActionsDeps = {},
): Promise<ChallengeSlotResult> {
  const api = deps.api ?? CHALLENGE_API;
  try {
    const plays = await api.pastPlay(input.runId, input.actingUserId);
    const play = plays.find((p) => p.completion_id === input.completionId);
    if (!play) {
      return {
        view: challengeTextView("That Game Completion no longer fits an open year of the Run."),
      };
    }
    const years = play.open_years.slice(-DISCORD_SELECT_OPTIONS_MAX);
    return {
      view: pickerView(
        `### Pick **${escapeChallengeText(play.title)}**\n${playedOn(play)}. Pick its year.`,
        new StringSelectMenuBuilder()
          .setCustomId(buildChallengeSlotsId({
            action: "pick-year",
            ids: [input.runId, play.completion_id],
          }))
          .setPlaceholder("Its year")
          .addOptions(...years.map((year) => ({ label: String(year), value: String(year) }))),
      ),
    };
  } catch (err: unknown) {
    return { error: challengeRefusalText(err, "Could not read your past play.") };
  }
}

type Choice = { name: string; value: string };

function matches(title: string, query: string): boolean {
  const wanted = query.trim().toLowerCase();
  return !wanted || title.toLowerCase().includes(wanted);
}

/** Autocomplete: the member's Active Slots Runs whose Challenge name holds `query`. */
export function slotsRunChoices(runs: readonly IChallengeRun[], query: string): Choice[] {
  return runs
    .filter((run) => run.status === "active" && run.challenge?.challenge_format === "slots")
    .filter((run) => matches(run.challenge?.name ?? "", query))
    .slice(0, DISCORD_AUTOCOMPLETE_CHOICES_MAX)
    .map((run) => ({
      name: truncateLabel(
        `${run.challenge?.name ?? `Run ${run.id}`} · ` +
          `${run.progress.cleared} of ${run.progress.target} years`,
      ),
      value: String(run.id),
    }));
}

/** Autocomplete: the Run's Cleared games, with the year each fills. */
export function clearedGameChoices(run: IChallengeRun, query: string): Choice[] {
  return clearedEntries(run)
    .filter((entry) => matches(entry.title, query))
    .slice(0, DISCORD_AUTOCOMPLETE_CHOICES_MAX)
    .map((entry) => ({
      name: truncateLabel(`${entry.title} · ${yearLabel(entry.slot_year)}`),
      value: String(entry.game_id),
    }));
}

/** Autocomplete: years from a list that start with what was typed. */
export function yearChoices(years: readonly number[], query: string): Choice[] {
  const typed = query.trim();
  return years
    .filter((year) => !typed || String(year).startsWith(typed))
    .slice(0, DISCORD_AUTOCOMPLETE_CHOICES_MAX)
    .map((year) => ({ name: String(year), value: String(year) }));
}

/** Autocomplete: earlier Game Completions that fit, with their date and years. */
export function pastPlayChoices(plays: readonly IPastPlay[]): Choice[] {
  return plays.slice(0, DISCORD_AUTOCOMPLETE_CHOICES_MAX).map((play) => ({
    name: truncateLabel(`${play.title} · ${playedOn(play)} · ${fitsText(play)}`),
    value: String(play.completion_id),
  }));
}
