import {
  ActionRowBuilder,
  ButtonBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import { ButtonStyle, MessageFlags } from "discord-api-types/v10";
import { DateTime } from "luxon";
import { safeV2TextContent } from "../functions/ComponentsV2Utils.js";
import { buildChallengeRunId } from "../functions/ChallengeCustomIds.js";
import {
  DISCORD_AUTOCOMPLETE_CHOICES_MAX,
  MAX_CONTAINER_TEXT,
  truncateLabel,
} from "../config/textLimits.js";
import {
  CHALLENGE_TIME_ZONE,
  escapeChallengeText,
  formatChallengeDate,
  listJoin,
} from "../functions/ChallengeCopy.js";
import { commandMention } from "./CommandMentionService.js";
import {
  challengeTextView,
  RUN_STATUS_LABELS,
  type IChallengeView,
} from "./ChallengeBrowse.js";
import {
  CHALLENGE_API,
  challengeRefusalText,
  type IChallengeApi,
  type IChallengeRun,
  type IChallengeRunEntry,
  type RunStatus,
} from "./ChallengeApi.js";

// A member's Runs from Discord (spec api#376, bot#1547): start, abandon and delete one.
// The API decides every rule (Closed, one Active Run, one Run per Season, Birth Date);
// its refusals are shown as given, with the request and response.

export type IChallengeRunsApi = Pick<
  IChallengeApi,
  "startRun" | "getRun" | "abandonRun" | "deleteRun" | "listMemberRuns"
>;

export interface IChallengeRunsDeps {
  api?: IChallengeRunsApi;
  now?: () => Date;
}

/** What to show: a view, or an error (the API's refusal with its request and response). */
export type ChallengeRunResult = { view: IChallengeView } | { error: string };

/** The Run's Challenge name, escaped, or a stand-in when the payload has none. */
export function runChallengeName(run: IChallengeRun): string {
  return run.challenge ? escapeChallengeText(run.challenge.name) : `Challenge Run ${run.id}`;
}

export function entriesIn(
  run: IChallengeRun,
  state: IChallengeRunEntry["state"],
): IChallengeRunEntry[] {
  return (run.entries ?? []).filter((entry) => entry.state === state);
}

/** "**A**", "**A** and **B**": game titles in bold. */
export function boldTitles(entries: readonly IChallengeRunEntry[]): string {
  return listJoin(entries.map((entry) => `**${escapeChallengeText(entry.title)}**`));
}

/** A moment the API serves (started_at, ended_at) as the club's date: "23 September 2026". */
export function formatRunDate(iso: string): string {
  const day = DateTime.fromISO(iso, { zone: "utc" }).setZone(CHALLENGE_TIME_ZONE).toISODate();
  return day ? formatChallengeDate(day) : iso;
}

function games(count: number): string {
  return `${count} ${count === 1 ? "game" : "games"}`;
}

/**
 * When the Run's window closes, for a subtext line: "Season closes <t:...:R>" for a
 * Seasonal Run, "Closes <t:...:R>" with an end date, or null when it has no end.
 */
export function runClosesText(run: IChallengeRun): string | null {
  const endsOn = run.window?.ends_on;
  if (!endsOn) return null;
  const closes = DateTime.fromISO(endsOn, { zone: CHALLENGE_TIME_ZONE }).plus({ days: 1 });
  if (!closes.isValid) return null;
  const when = `<t:${Math.floor(closes.toSeconds())}:R>`;
  return run.challenge?.schedule === "seasonal" ? `Season closes ${when}` : `Closes ${when}`;
}

function startedText(run: IChallengeRun): string {
  const lines = [`## You started a Run of ${runChallengeName(run)}`];
  const { cleared, target } = run.progress;
  if (run.challenge?.challenge_format === "pool" || !run.challenge) {
    lines.push(`Clear ${games(target)} from its Pool to Finish.`);
  }
  lines.push("Your Game Completions and Now Playing fill it in by themselves.");
  const earlier = run.challenge?.schedule === "seasonal" ? "earlier this Season " : "";
  if (run.status === "finished") {
    lines.push(`Your play ${earlier}already Finished it.`);
  } else if (cleared > 0) {
    lines.push(`Your play ${earlier}already counts: ${cleared} of ${target} Cleared.`);
  }
  const playing = entriesIn(run, "in_progress");
  if (playing.length) {
    lines.push(`${boldTitles(playing)} ${playing.length === 1 ? "is" : "are"} In Progress.`);
  }
  const footer = [runClosesText(run), `${commandMention("challenge my-runs")} shows what's next`]
    .filter(Boolean);
  lines.push(`-# ${footer.join(" · ")}`);
  return lines.join("\n");
}

/** Starts the acting member's Run of a Challenge (/challenge start, or a post's button). */
export async function startRunReply(
  input: { challengeId: number; actingUserId: string },
  deps: IChallengeRunsDeps = {},
): Promise<ChallengeRunResult> {
  const api = deps.api ?? CHALLENGE_API;
  try {
    const run = await api.startRun(input.challengeId, input.actingUserId);
    return { view: challengeTextView(startedText(run)) };
  } catch (err: unknown) {
    return { error: challengeRefusalText(err, "Could not start the Run.") };
  }
}

/** A Run's status in words; unknown ones as the API names them. */
export function runStatusLabel(status: RunStatus): string {
  return RUN_STATUS_LABELS[status] ?? status;
}

/** "2 of 3 Cleared · 1 In Progress" */
export function runProgressText(run: IChallengeRun): string {
  const { cleared, target, in_progress: inProgress } = run.progress;
  const parts = [`${cleared} of ${target} Cleared`];
  if (inProgress) parts.push(`${inProgress} In Progress`);
  return parts.join(" · ");
}

/** A private view with buttons to confirm or keep the Run. */
function confirmView(content: string, action: "abandon" | "delete", run: IChallengeRun):
  IChallengeView {
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(safeV2TextContent(content, MAX_CONTAINER_TEXT)),
  );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildChallengeRunId(action, run.id))
      .setLabel(action === "abandon" ? "Abandon the Run" : "Delete the Run")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(buildChallengeRunId("keep", run.id))
      .setLabel("Keep it")
      .setStyle(ButtonStyle.Secondary),
  );
  return {
    components: [container.toJSON(), row.toJSON()],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

function abandonQuestion(run: IChallengeRun): string {
  const lines = [
    `## Abandon your Run of ${runChallengeName(run)}?`,
    `-# ${runProgressText(run)}`,
    "It stops counting your play and stays on your profile, Abandoned, until you delete " +
      `it with ${commandMention("challenge delete-run")}.`,
  ];
  if (run.challenge?.schedule === "seasonal") {
    lines.push("You can't start another Run of it this Season.");
  } else {
    lines.push("You can start a new Run of it later, which starts from nothing.");
  }
  return lines.join("\n");
}

function deleteQuestion(run: IChallengeRun): string {
  return [
    `## Delete your ${runStatusLabel(run.status)} Run of ${runChallengeName(run)}?`,
    `-# ${runProgressText(run)}`,
    "It leaves your profile and the Challenge's Runs. This can't be undone.",
  ].join("\n");
}

/**
 * The question before abandoning or deleting a Run, with its confirm and keep buttons, or
 * why it can't be done (a Run that isn't Active can't be abandoned; an Active one must be
 * abandoned before it is deleted). The API still decides when the button is clicked.
 */
export async function confirmRunChange(
  input: { action: "abandon" | "delete"; runId: number; actingUserId: string },
  deps: IChallengeRunsDeps = {},
): Promise<ChallengeRunResult> {
  const api = deps.api ?? CHALLENGE_API;
  let run: IChallengeRun | null;
  try {
    run = await api.getRun(input.runId, input.actingUserId);
  } catch (err: unknown) {
    return { error: challengeRefusalText(err, "Could not read the Run.") };
  }
  if (!run) {
    return {
      view: challengeTextView(`There is no Run ${input.runId}, or it is hidden from you.`),
    };
  }
  if (input.action === "abandon") {
    if (run.status !== "active") {
      return {
        view: challengeTextView(
          `That Run is ${runStatusLabel(run.status)}, so there is nothing to abandon.`,
        ),
      };
    }
    return { view: confirmView(abandonQuestion(run), "abandon", run) };
  }
  if (run.status === "active") {
    return {
      view: challengeTextView(
        `That Run is Active. Abandon it with ${commandMention("challenge abandon")} first.`,
      ),
    };
  }
  return { view: confirmView(deleteQuestion(run), "delete", run) };
}

/** Abandons the clicking member's Run; the API refuses anyone else's. */
export async function abandonRunReply(
  input: { runId: number; actingUserId: string },
  deps: IChallengeRunsDeps = {},
): Promise<ChallengeRunResult> {
  const api = deps.api ?? CHALLENGE_API;
  try {
    const run = await api.abandonRun(input.runId, input.actingUserId);
    return {
      view: challengeTextView(
        `You abandoned your Run of ${runChallengeName(run)}. It stays on your profile until ` +
          `you delete it with ${commandMention("challenge delete-run")}.`,
      ),
    };
  } catch (err: unknown) {
    return { error: challengeRefusalText(err, "Could not abandon the Run.") };
  }
}

/** Deletes the clicking member's Run; the API refuses an Active Run and anyone else's. */
export async function deleteRunReply(
  input: { runId: number; actingUserId: string },
  deps: IChallengeRunsDeps = {},
): Promise<ChallengeRunResult> {
  const api = deps.api ?? CHALLENGE_API;
  try {
    const deleted = await api.deleteRun(input.runId, input.actingUserId);
    return {
      view: challengeTextView(deleted ? "Deleted the Run." : "That Run was already gone."),
    };
  } catch (err: unknown) {
    return { error: challengeRefusalText(err, "Could not delete the Run.") };
  }
}

/**
 * Autocomplete choices of the member's Runs for abandon (Active ones) or delete-run (the
 * others), whose Challenge name holds `query`; the value is the Run ID.
 */
export function runChoices(
  runs: readonly IChallengeRun[],
  action: "abandon" | "delete",
  query: string,
): { name: string; value: string }[] {
  const wanted = query.trim().toLowerCase();
  return runs
    .filter((run) => (run.status === "active") === (action === "abandon"))
    .filter((run) => !wanted || (run.challenge?.name ?? "").toLowerCase().includes(wanted))
    .slice(0, DISCORD_AUTOCOMPLETE_CHOICES_MAX)
    .map((run) => ({
      name: truncateLabel([
        run.challenge?.name ?? `Run ${run.id}`,
        runStatusLabel(run.status),
        `${run.progress.cleared} of ${run.progress.target} Cleared`,
        `started ${formatRunDate(run.started_at)}`,
      ].join(" · ")),
      value: String(run.id),
    }));
}
