import axios from "axios";
import { TimestampStyles, time, userMention } from "discord.js";

import { NEWS_IMPORT_COMMAND } from "../config/newsHub.js";
import { sharedStateCommandRefusal } from "../functions/SharedStateCommandGuard.js";
import {
  buildAnyErrorMessage,
  buildApiErrorMessage,
  buildDiscordErrorMessage,
} from "../utilities/ApiErrorUtils.js";
import { logError } from "../utilities/LogUtils.js";
import { NEWS_IMPORT_API, type INewsImportApi } from "./NewsImportApi.js";
import {
  HISTORY_COPY_INTERVAL_MS,
  NEWS_HISTORY_COPY,
  type INewsHistoryCopyDeps,
  type INewsHistoryCopyProgress,
  type INewsHistoryCopyRun,
  type NewsHistoryCopyRunner,
} from "./NewsHistoryCopy.js";

// `/news-import` (spec api#355, api#367): the staff actions of the News Import and the
// history copy. They work for Admins and Superadmins while the News Hub is Preview or Live,
// and for nobody while it is Off (the bot's feature gate refuses the command). The API
// decides who is staff, from the acting member's stored roles; the bot names the acting
// Discord user.

const LOG_CONTEXT = "NewsImport";

/** The shortest gap between two edits of the history copy's progress message. */
export const PROGRESS_EDIT_MS = 5_000;

export const NEWS_IMPORT_STAFF_ONLY_MESSAGE =
  "Only Admins and Superadmins can run the News Import.";

export interface INewsImportDeps {
  api: INewsImportApi;
  runner: NewsHistoryCopyRunner;
}

export const DEFAULT_NEWS_IMPORT_DEPS: INewsImportDeps = {
  api: NEWS_IMPORT_API,
  runner: NEWS_HISTORY_COPY,
};

/**
 * The reply for an API 403 (the acting member is not staff), with the full request and
 * response and no dev ping since nothing is broken; null for any other error, which the
 * caller throws to the command's error reply. bot#1527's download and upload use it too.
 */
export function newsImportRefusal(error: unknown): string | null {
  if (!axios.isAxiosError(error) || error.response?.status !== 403) return null;
  return buildApiErrorMessage(NEWS_IMPORT_STAFF_ONLY_MESSAGE, error, { devPing: false });
}

/** `/news-import status`: the import's and the history copy's counts as the private reply. */
export async function newsImportStatusReply(
  actingUserId: string,
  deps: INewsImportDeps = DEFAULT_NEWS_IMPORT_DEPS,
): Promise<string> {
  let status: Awaited<ReturnType<INewsImportApi["status"]>>;
  try {
    status = await deps.api.status(actingUserId);
  } catch (error: unknown) {
    const refusal = newsImportRefusal(error);
    if (refusal) return refusal;
    throw error;
  }
  const run = deps.runner.current();
  return "**News Import**\n" +
    `- **${status.sorted}** sorted: shown on the website\n` +
    `- **${status.unsorted}** unsorted: hidden until staff assign a News Category\n` +
    `- **${status.removed}** removed with \`skip\`\n` +
    "**News Copies** (live and imported News Items)\n" +
    `- **${status.copied}** copied into the category threads\n` +
    `- **${status.uncopied}** waiting for a News Copy` +
    (run ? `\n\nA history copy is running: ${runSummary(run)}` : "");
}

/** How long `left` copies take at the history copy's pace, roughly. */
function timeLeft(left: number): string {
  const minutes = Math.ceil((left * HISTORY_COPY_INTERVAL_MS) / 60_000);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** The history copy's counts, one fact per line. */
export function copyCountsText(progress: Readonly<INewsHistoryCopyProgress>): string {
  const reached = progress.reachedPostedAt
    ? `, up to news from ${time(new Date(progress.reachedPostedAt), TimestampStyles.LongDate)}`
    : "";
  const lines = [`Copied **${progress.copied}** News Items${reached}.`];
  if (progress.failed) {
    lines.push(`Skipped **${progress.failed}** whose copy failed (each error is in the ` +
      "console log); the next run tries them again.");
  }
  if (progress.left !== null && !progress.finished) {
    lines.push(`**${progress.left}** left, about ${timeLeft(progress.left)}.`);
  }
  return lines.join("\n");
}

function startedLine(run: Pick<INewsHistoryCopyRun, "startedBy" | "startedAt">): string {
  return `started by ${userMention(run.startedBy)} ` +
    time(run.startedAt, TimestampStyles.RelativeTime);
}

function runSummary(run: Readonly<INewsHistoryCopyRun>): string {
  return `${startedLine(run)}.\n` +
    (run.progress ? copyCountsText(run.progress) : "It is posting its first copy.");
}

const RERUN_NOTE = `Run \`/${NEWS_IMPORT_COMMAND} copy\` again; it continues where it stopped.`;
const RESTART_NOTE = `If the bot restarts, run \`/${NEWS_IMPORT_COMMAND} copy\` again; it ` +
  "continues where it stopped. New posts are copied after the history.";

function runningText(run: Readonly<INewsHistoryCopyRun>): string {
  return `**History copy** ${runSummary(run)}\n-# ${RESTART_NOTE}`;
}

function finishedText(
  run: Readonly<INewsHistoryCopyRun>,
  progress: Readonly<INewsHistoryCopyProgress>,
): string {
  if (progress.finished) {
    return `**History copy** finished (${startedLine(run)}).\n` +
      `${copyCountsText(progress)}\n` +
      `\`/${NEWS_IMPORT_COMMAND} status\` shows the counts.`;
  }
  const reason = progress.failure
    ? `\n${runFailureReason(progress.failure.label, progress.failure.error)}`
    : "";
  return `**History copy** stopped (${startedLine(run)}).${reason}\n` +
    `${copyCountsText(progress)}\n${RERUN_NOTE}`;
}

/** Longest reason line the progress message carries; the details message has the rest. */
const FAILURE_REASON_MAX = 400;

/**
 * Why a run stopped, in one short line for its progress message, so staff see the cause
 * even when the full details message cannot be posted: the step, the HTTP status and the
 * API's answer, or the error's own message. A null error is the label alone.
 */
export function runFailureReason(label: string, error: unknown): string {
  let cause: string | null;
  if (error === null) {
    cause = null;
  } else if (axios.isAxiosError(error) && error.response) {
    cause = `HTTP ${error.response.status} ${JSON.stringify(error.response.data ?? null)}`;
  } else if (error instanceof Error) {
    cause = error.message;
  } else {
    cause = String(error);
  }
  const line = (cause === null ? label : `${label}: ${cause}`).replace(/\s+/g, " ");
  return line.length > FAILURE_REASON_MAX ? `${line.slice(0, FAILURE_REASON_MAX - 1)}…` : line;
}

/** The run's progress message, posted in the channel where staff ran the command. */
export interface IProgressMessage {
  url: string;
  edit(text: string): Promise<void>;
}

export interface INewsHistoryCopyStart extends INewsImportDeps {
  actingUserId: string;
  /** A PR preview shares the production API, so test mode refuses the history copy. */
  testMode: boolean;
  /** What the run copies with; its progress goes to the progress message. */
  copy: Omit<INewsHistoryCopyDeps, "onProgress">;
  /** Posts the progress message. A failure is thrown to the command's error reply. */
  post(text: string): Promise<IProgressMessage>;
  /** Posts the full error that stopped a run, below the progress message. */
  postDetails(text: string): Promise<void>;
  now?: () => Date;
  editIntervalMs?: number;
}

/**
 * Edits the progress message at most once per interval while the run goes on, never two
 * edits at once, and always with the final text. Edit failures are logged, never thrown:
 * a deleted progress message does not stop the run.
 */
function progressEditor(
  message: IProgressMessage,
  intervalMs: number,
  now: () => Date,
): { show(text: () => string): void; finish(text: string): Promise<void> } {
  let last = now().getTime();
  let editing: Promise<void> | null = null;
  const edit = (text: string): Promise<void> =>
    message.edit(text).catch((error: unknown) => {
      const label = "Could not edit the history copy's progress";
      logError(LOG_CONTEXT, buildDiscordErrorMessage(label, error));
    });
  return {
    show(text) {
      if (editing || now().getTime() - last < intervalMs) return;
      last = now().getTime();
      editing = edit(text()).finally(() => {
        editing = null;
      });
    },
    async finish(text) {
      await editing;
      await edit(text);
    },
  };
}

/**
 * `/news-import copy`: refuses in test mode, then asks the API whether the acting member
 * is staff (the uncopied listing is service-only, so the status read is the check) and
 * how many News Items have no copy, then starts the history copy unless one is running.
 * Returns the private reply, and `finished`, which settles (never rejects) once the
 * progress message shows the final counts; null when not started.
 */
export async function startNewsHistoryCopyReply(
  start: INewsHistoryCopyStart,
): Promise<{ reply: string; finished: Promise<void> | null }> {
  const testRefusal = sharedStateCommandRefusal(`/${NEWS_IMPORT_COMMAND} copy`, start.testMode);
  if (testRefusal) return { reply: testRefusal, finished: null };
  let status: Awaited<ReturnType<INewsImportApi["status"]>>;
  try {
    status = await start.api.status(start.actingUserId);
  } catch (error: unknown) {
    const refusal = newsImportRefusal(error);
    if (refusal) return { reply: refusal, finished: null };
    throw error;
  }
  const running = start.runner.current();
  if (running) return { reply: alreadyRunningReply(running), finished: null };

  const now = start.now ?? ((): Date => new Date());
  const run = { startedBy: start.actingUserId, startedAt: now(), progress: null };
  const message = await start.post(runningText(run));
  const editor = progressEditor(message, start.editIntervalMs ?? PROGRESS_EDIT_MS, now);
  const done = start.runner.start(run.startedBy, run.startedAt, {
    ...start.copy,
    onProgress: () => {
      const current = start.runner.current();
      if (current) editor.show(() => runningText(current));
    },
  });
  if (!done) {
    // Another start won the race between the check above and now.
    const other = start.runner.current();
    await editor.finish("**History copy** not started: another run began first.");
    const reply = other ? alreadyRunningReply(other) : "Another history copy began first.";
    return { reply, finished: null };
  }
  const finished = done.then(
    async (progress) => {
      await editor.finish(finishedText(run, progress));
      const failure = progress.failure;
      if (failure && failure.error !== null) {
        await postDetails(start, buildAnyErrorMessage(failure.label, failure.error));
      }
    },
    async (error: unknown) => {
      await editor.finish("**History copy** stopped on an unexpected error. The details are " +
        `below.\n${runFailureReason("The history copy failed", error)}\n${RERUN_NOTE}`);
      await postDetails(start, buildAnyErrorMessage("The history copy failed", error));
    },
  ).catch((error: unknown) => {
    logError(LOG_CONTEXT, buildAnyErrorMessage("Could not report the history copy", error));
  });
  return {
    reply: `The history copy has started: ${status.uncopied} News Items have no News Copy ` +
      `yet, copied oldest first. Its progress is posted here: ${message.url}`,
    finished,
  };
}

function alreadyRunningReply(run: Readonly<INewsHistoryCopyRun>): string {
  return `A history copy is already running, ${runSummary(run)}`;
}

async function postDetails(start: INewsHistoryCopyStart, text: string): Promise<void> {
  await start.postDetails(text).catch((error: unknown) => {
    const label = "Could not post the error that stopped the history copy";
    logError(LOG_CONTEXT, `${buildDiscordErrorMessage(label, error)}\n${text}`);
  });
}
