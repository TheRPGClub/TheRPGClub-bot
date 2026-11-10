import axios from "axios";
import { TimestampStyles, time, userMention } from "discord.js";

import { sharedStateCommandRefusal } from "../functions/SharedStateCommandGuard.js";
import {
  buildAnyErrorMessage,
  buildApiErrorMessage,
  buildDiscordErrorMessage,
} from "../utilities/ApiErrorUtils.js";
import { logError } from "../utilities/LogUtils.js";
import { NEWS_IMPORT_API, type INewsImportApi } from "./NewsImportApi.js";
import {
  NEWS_IMPORT_SCAN,
  type IArchiveReader,
  type INewsImportScanProgress,
  type INewsImportScanRun,
  type NewsImportScanRunner,
  type NewsImportSkipReason,
} from "./NewsImportScan.js";

// `/news-import` (spec api#355, bot#1526): the staff actions of the News Import. They work
// for Admins and Superadmins while the News Hub is Preview or Live, and for nobody while it
// is Off (the bot's feature gate refuses the command). The API decides who is staff, from
// the acting member's stored roles; the bot names the acting Discord user.

const LOG_CONTEXT = "NewsImport";

/** The command's name, as staff type it. The API's Feature coverage names it too. */
export const NEWS_IMPORT_COMMAND = "news-import";

/** The shortest gap between two edits of the scan's progress message. */
export const SCAN_PROGRESS_EDIT_MS = 5_000;

export const NEWS_IMPORT_STAFF_ONLY_MESSAGE =
  "Only Admins and Superadmins can run the News Import.";

export interface INewsImportDeps {
  api: INewsImportApi;
  runner: NewsImportScanRunner;
}

export const DEFAULT_NEWS_IMPORT_DEPS: INewsImportDeps = {
  api: NEWS_IMPORT_API,
  runner: NEWS_IMPORT_SCAN,
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

/** `/news-import status`: the import's counts as the private reply. */
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
    `- **${status.removed}** removed with \`skip\`` +
    (run ? `\n\nA scan is running: ${runSummary(run)}` : "");
}

const SKIP_LABELS: Readonly<Record<NewsImportSkipReason, string>> = {
  textOnly: "text only",
  bot: "by a bot or webhook",
  system: "system messages",
};

function total(counts: Readonly<Record<string, number | undefined>>): number {
  return Object.values(counts).reduce<number>((sum, n) => sum + (n ?? 0), 0);
}

/** The scan's counts, one fact per line. */
export function scanCountsText(progress: Readonly<INewsImportScanProgress>): string {
  const reached = progress.oldestPostedAt
    ? `, back to ${time(new Date(progress.oldestPostedAt), TimestampStyles.LongDate)}`
    : "";
  const lines = [
    `Scanned **${progress.scanned}** messages${reached}.`,
    `Recorded **${progress.created + progress.updated}** News Items ` +
      `(${progress.created} new, ${progress.updated} already imported).`,
  ];
  const skips = (Object.keys(SKIP_LABELS) as NewsImportSkipReason[])
    .filter((reason) => progress.skipped[reason])
    .map((reason) => `${progress.skipped[reason]} ${SKIP_LABELS[reason]}`);
  lines.push(skips.length
    ? `Skipped **${total(progress.skipped)}**: ${skips.join(", ")}.`
    : "Skipped none.");
  if (progress.previouslyRemoved) {
    lines.push(`Left out **${progress.previouslyRemoved}** that staff removed with \`skip\`.`);
  }
  const rejected = Object.entries(progress.rejected);
  if (rejected.length) {
    const reasons = rejected.map(([reason, n]) => `${reason} (${n})`).join("; ");
    lines.push(`Rejected **${total(progress.rejected)}** by the API: ${reasons}.`);
  }
  return lines.join("\n");
}

function startedLine(run: Pick<INewsImportScanRun, "startedBy" | "startedAt">): string {
  return `started by ${userMention(run.startedBy)} ` +
    time(run.startedAt, TimestampStyles.RelativeTime);
}

function runSummary(run: Readonly<INewsImportScanRun>): string {
  return `${startedLine(run)}.\n` +
    (run.progress ? scanCountsText(run.progress) : "It is reading its first page.");
}

const RERUN_NOTE = `Run \`/${NEWS_IMPORT_COMMAND} scan\` again; it continues where it stopped.`;
const RESTART_NOTE = "If the bot restarts, run the scan again; it continues where it stopped.";

function runningText(run: Readonly<INewsImportScanRun>): string {
  return `**News Import scan** ${runSummary(run)}\n-# ${RESTART_NOTE}`;
}

function finishedText(
  run: Readonly<INewsImportScanRun>,
  progress: Readonly<INewsImportScanProgress>,
): string {
  if (progress.finished) {
    return `**News Import scan** finished (${startedLine(run)}).\n` +
      `${scanCountsText(progress)}\n` +
      "Imported News Items stay hidden until staff assign their News Categories. " +
      `\`/${NEWS_IMPORT_COMMAND} status\` shows the counts.`;
  }
  return `**News Import scan** stopped on an error (${startedLine(run)}). ` +
    `The details are below.\n${scanCountsText(progress)}\n${RERUN_NOTE}`;
}

/** The scan's progress message, posted in the channel where staff ran the command. */
export interface IScanProgressMessage {
  url: string;
  edit(text: string): Promise<void>;
}

export interface INewsImportScanStart extends INewsImportDeps {
  actingUserId: string;
  /** A PR preview shares the production API, so test mode refuses the scan. */
  testMode: boolean;
  archive: IArchiveReader;
  archiveId: string;
  /**
   * Start over from the archive's newest message. By default the scan continues from just
   * before the oldest message already imported (the archive is locked, so nothing newer
   * appears).
   */
  fromNewest?: boolean;
  /** Posts the progress message. A failure is thrown to the command's error reply. */
  post(text: string): Promise<IScanProgressMessage>;
  /** Posts the full error that stopped a scan, below the progress message. */
  postDetails(text: string): Promise<void>;
  now?: () => Date;
  editIntervalMs?: number;
}

/**
 * Edits the progress message at most once per interval while the scan runs, never two
 * edits at once, and always with the final text. Edit failures are logged, never thrown:
 * a deleted progress message does not stop the scan.
 */
function progressEditor(
  message: IScanProgressMessage,
  intervalMs: number,
  now: () => Date,
): { show(text: () => string): void; finish(text: string): Promise<void> } {
  let last = now().getTime();
  let editing: Promise<void> | null = null;
  const edit = (text: string): Promise<void> =>
    message.edit(text).catch((error: unknown) => {
      logError(LOG_CONTEXT, buildDiscordErrorMessage("Could not edit the scan progress", error));
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
 * `/news-import scan`: refuses in test mode, then asks the API whether the acting member is
 * staff (the batch write is service-only, so the status read is the check) and where the
 * last scan stopped, then starts the scan unless one is running. Returns the private reply,
 * and `finished`, which settles (never rejects) once the progress message shows the final
 * counts; null when not started.
 */
export async function startNewsImportScanReply(
  start: INewsImportScanStart,
): Promise<{ reply: string; finished: Promise<void> | null }> {
  const testRefusal = sharedStateCommandRefusal(`/${NEWS_IMPORT_COMMAND} scan`, start.testMode);
  if (testRefusal) return { reply: testRefusal, finished: null };
  let status: Awaited<ReturnType<INewsImportApi["status"]>>;
  try {
    status = await start.api.status(start.actingUserId);
  } catch (error: unknown) {
    const refusal = newsImportRefusal(error);
    if (refusal) return { reply: refusal, finished: null };
    throw error;
  }
  const startBefore = start.fromNewest ? null : status.oldestMessageId;
  const running = start.runner.current();
  if (running) return { reply: alreadyRunningReply(running), finished: null };

  const now = start.now ?? ((): Date => new Date());
  const run = { startedBy: start.actingUserId, startedAt: now(), progress: null };
  const message = await start.post(runningText(run));
  const editor = progressEditor(message, start.editIntervalMs ?? SCAN_PROGRESS_EDIT_MS, now);
  const done = start.runner.start(run.startedBy, run.startedAt, {
    archive: start.archive,
    api: start.api,
    archiveId: start.archiveId,
    startBefore,
    onProgress: () => {
      const current = start.runner.current();
      if (current) editor.show(() => runningText(current));
    },
  });
  if (!done) {
    // Another start won the race between the check above and now.
    const other = start.runner.current();
    await editor.finish("**News Import scan** not started: another scan began first.");
    const reply = other ? alreadyRunningReply(other) : "Another scan began first.";
    return { reply, finished: null };
  }
  const finished = done.then(
    async (progress) => {
      await editor.finish(finishedText(run, progress));
      const failure = progress.failure;
      if (failure) await postDetails(start, buildAnyErrorMessage(failure.label, failure.error));
    },
    async (error: unknown) => {
      await editor.finish("**News Import scan** stopped on an unexpected error. The details are " +
        `below.\n${RERUN_NOTE}`);
      await postDetails(start, buildAnyErrorMessage("The News Import scan failed", error));
    },
  ).catch((error: unknown) => {
    logError(LOG_CONTEXT, buildAnyErrorMessage("Could not report the News Import scan", error));
  });
  const from = startBefore
    ? "continuing where the last scan stopped"
    : "from the newest message";
  return {
    reply: `The News Import scan has started, ${from}. Its progress is posted here: ` +
      message.url,
    finished,
  };
}

function alreadyRunningReply(run: Readonly<INewsImportScanRun>): string {
  return `A News Import scan is already running, ${runSummary(run)}`;
}

async function postDetails(start: INewsImportScanStart, text: string): Promise<void> {
  await start.postDetails(text).catch((error: unknown) => {
    logError(LOG_CONTEXT, `${buildDiscordErrorMessage("Could not post the scan error", error)}\n` +
      text);
  });
}
