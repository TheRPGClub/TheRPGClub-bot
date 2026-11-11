import { MAX_CONTAINER_TEXT } from "../config/textLimits.js";
import { writeDelimited } from "../functions/DelimitedText.js";
import {
  NEWS_IMPORT_VALUES,
  newsImportFileParts,
  readNewsImportUpload,
  type INewsImportListItem,
  type INewsImportRowProblem,
} from "../functions/NewsImportFile.js";
import { sharedStateCommandRefusal } from "../functions/SharedStateCommandGuard.js";
import { buildApiErrorMessage } from "../utilities/ApiErrorUtils.js";
import { NEWS_IMPORT_COMMAND, newsImportRefusal } from "./NewsImport.js";
import {
  NEWS_IMPORT_ASSIGN_MAX,
  NEWS_IMPORT_LIST_PER,
  type INewsImportApi,
  type INewsImportAssignRow,
  type INewsImportMove,
} from "./NewsImportApi.js";

// `/news-import download` and `/news-import upload` (spec api#355, bot#1527): staff take the
// unsorted imported News Items away as a file, sort them on their own machine, and bring
// the file back to assign News Categories (or `skip` to remove). The API decides who may
// (Admins and Superadmins); no model runs on the server.

/** Discord lets one message carry at most this many files. */
export const DISCORD_FILES_PER_MESSAGE = 10;

const FILE_PREFIX = "news-import-unsorted";
const REJECTED_FILE = "news-import-rejected-rows.csv";

export interface INewsImportFile {
  name: string;
  text: string;
}

/** One private reply: its text and the files it carries. */
export interface INewsImportMessage {
  text: string;
  files: INewsImportFile[];
  /** True when the text reports an error (the command may ping the developers). */
  failed: boolean;
}

function reply(text: string, files: INewsImportFile[] = []): INewsImportMessage {
  return { text, files, failed: false };
}

function code(value: string): string {
  return `\`${value}\``;
}

const VALUES_TEXT = NEWS_IMPORT_VALUES.slice(0, -1).map(code).join(", ");

const HOW_TO_TEXT = `Fill in the ${code("category")} column with a News Category key ` +
  `(${VALUES_TEXT}), or ${code("skip")} to remove the item for good. Leave it empty to keep ` +
  `the item unsorted. Then upload the file with ${code(`/${NEWS_IMPORT_COMMAND} upload`)}; ` +
  "you can upload it again later to change a category.\n" +
  "-# Only the message_id and category columns are read back. If you open the file in a " +
  "spreadsheet, keep message_id as text, or it turns into a rounded number.";

function plural(count: number, one: string, many: string): string {
  return `**${count}** ${count === 1 ? one : many}`;
}

/** Every page of unsorted imported items, oldest first. */
async function listAll(api: INewsImportApi, actingUserId: string): Promise<INewsImportListItem[]> {
  const items: INewsImportListItem[] = [];
  let page: number | null = 1;
  while (page !== null) {
    const listed = await api.list(actingUserId, page, NEWS_IMPORT_LIST_PER);
    items.push(...listed.items);
    page = listed.next !== null && listed.next > page ? listed.next : null;
  }
  return items;
}

/** Groups files into messages: at most ten files, and `maxBytes` in all, per message. */
function groupFiles(files: INewsImportFile[], maxBytes: number): INewsImportFile[][] {
  const groups: INewsImportFile[][] = [];
  let group: INewsImportFile[] = [];
  let size = 0;
  for (const file of files) {
    const bytes = Buffer.byteLength(file.text, "utf-8");
    if (group.length && (group.length >= DISCORD_FILES_PER_MESSAGE || size + bytes > maxBytes)) {
      groups.push(group);
      group = [];
      size = 0;
    }
    group.push(file);
    size += bytes;
  }
  if (group.length) groups.push(group);
  return groups;
}

export interface INewsImportDownloadDeps {
  api: INewsImportApi;
  /** The largest file Discord takes here (`interaction.attachmentSizeLimit`). */
  maxBytes: number;
  now?: () => Date;
}

/**
 * `/news-import download`: the unsorted imported News Items as one or more files, each
 * under the upload limit and each uploadable on its own. The first message explains the
 * category column; later ones carry the rest of the files.
 */
export async function newsImportDownloadReply(
  actingUserId: string,
  deps: INewsImportDownloadDeps,
): Promise<INewsImportMessage[]> {
  let items: INewsImportListItem[];
  try {
    items = await listAll(deps.api, actingUserId);
  } catch (error: unknown) {
    const refusal = newsImportRefusal(error);
    if (refusal) return [reply(refusal)];
    throw error;
  }
  if (!items.length) {
    return [reply("No imported News Items are unsorted. " +
      `${code(`/${NEWS_IMPORT_COMMAND} status`)} shows the counts.`)];
  }

  const date = (deps.now?.() ?? new Date()).toISOString().slice(0, 10);
  const parts = newsImportFileParts(items, deps.maxBytes);
  const files = parts.map((text, i) => ({
    name: parts.length === 1
      ? `${FILE_PREFIX}-${date}.csv`
      : `${FILE_PREFIX}-${date}-part-${i + 1}-of-${parts.length}.csv`,
    text,
  }));
  const where = files.length === 1
    ? "in the attached file"
    : `in **${files.length}** files (each one can be uploaded on its own)`;
  const intro = `**News Import download**: ${plural(items.length,
    "unsorted imported News Item", "unsorted imported News Items")}, oldest first, ${where}.\n` +
    HOW_TO_TEXT;
  let sent = 0;
  return groupFiles(files, deps.maxBytes).map((group, i) => {
    const first = sent + 1;
    sent += group.length;
    const text = i === 0 ? intro : `**News Import download**, files ${first} to ${sent} ` +
      `of ${files.length}.`;
    return reply(text, group);
  });
}

export interface INewsImportUploadStart {
  actingUserId: string;
  /** A PR preview shares the production API, so test mode refuses the upload. */
  testMode: boolean;
  api: INewsImportApi;
  /** The largest file read (`interaction.attachmentSizeLimit`). */
  maxBytes: number;
  file: { name: string; size: number; contentType: string | null };
  /** Downloads the attachment's text. A failure is thrown to the command's error reply. */
  fetchText(): Promise<string>;
  /**
   * Moves the News Copies of items whose category the upload changed (spec api#367). It
   * runs on in the background: moving many copies can outlast the interaction.
   */
  moveCopies(moves: readonly INewsImportMove[]): void;
}

function isDelimitedFile(file: INewsImportUploadStart["file"]): boolean {
  return file.name.toLowerCase().endsWith(".csv") ||
    (file.contentType ?? "").toLowerCase().includes("csv");
}

function problemLine(problem: Readonly<INewsImportRowProblem>): string {
  const what = [problem.messageId, problem.value].filter(Boolean).map(code).join(", ");
  return `- Line ${problem.line}${what ? ` (${what})` : ""}: ${problem.reason}`;
}

function rejectedFile(problems: readonly INewsImportRowProblem[]): INewsImportFile {
  const rows = problems.map((p) => [String(p.line), p.messageId, p.value, p.reason]);
  return {
    name: REJECTED_FILE,
    text: writeDelimited([["line", "message_id", "value", "reason"], ...rows]),
  };
}

interface IUploadTotals {
  assigned: number;
  removed: number;
  unsorted: number;
  problems: INewsImportRowProblem[];
  moves: INewsImportMove[];
}

/**
 * Sends the rows in requests of at most NEWS_IMPORT_ASSIGN_MAX and maps each rejection's
 * index back to its file line. A failed request after an earlier one says which rows
 * were applied (uploading the file again is safe).
 */
async function assignAll(
  start: INewsImportUploadStart,
  rows: readonly (INewsImportAssignRow & { line: number })[],
  totals: IUploadTotals,
): Promise<INewsImportMessage | null> {
  for (let offset = 0; offset < rows.length; offset += NEWS_IMPORT_ASSIGN_MAX) {
    const chunk = rows.slice(offset, offset + NEWS_IMPORT_ASSIGN_MAX);
    let result: Awaited<ReturnType<INewsImportApi["assign"]>>;
    try {
      result = await start.api.assign(
        start.actingUserId,
        chunk.map(({ messageId, value }) => ({ messageId, value })),
      );
    } catch (error: unknown) {
      const refusal = newsImportRefusal(error);
      if (refusal) return reply(refusal);
      const applied = offset
        ? `The rows before line ${chunk[0].line} were applied. `
        : "No rows were applied. ";
      const message = buildApiErrorMessage(
        `Could not apply the News Import file. ${applied}Uploading the file again is safe.`,
        error,
      );
      return { text: message, files: [], failed: true };
    }
    totals.assigned += result.assigned;
    totals.removed += result.removed;
    totals.unsorted = result.unsorted;
    totals.moves.push(...result.moved.filter((move) => move.copy));
    for (const rejection of result.rejections) {
      const line = chunk[rejection.index]?.line ?? 0;
      totals.problems.push({ ...rejection, line });
    }
  }
  return null;
}

/**
 * `/news-import upload`: refuses in test mode, asks the API whether the acting member is
 * staff before reading the file, then applies every row with a value. Rows the file or the
 * API rejects are listed with their lines and never stop the others.
 */
export async function newsImportUploadReply(
  start: INewsImportUploadStart,
): Promise<INewsImportMessage> {
  const testRefusal = sharedStateCommandRefusal(`/${NEWS_IMPORT_COMMAND} upload`, start.testMode);
  if (testRefusal) return reply(testRefusal);
  let unsorted: number;
  try {
    unsorted = (await start.api.status(start.actingUserId)).unsorted;
  } catch (error: unknown) {
    const refusal = newsImportRefusal(error);
    if (refusal) return reply(refusal);
    throw error;
  }
  const download = code(`/${NEWS_IMPORT_COMMAND} download`);
  if (!isDelimitedFile(start.file)) {
    return reply(`Upload the \`.csv\` file from ${download}, with its category column filled in.`);
  }
  if (start.file.size > start.maxBytes) {
    return reply(`That file is larger than the ${start.maxBytes} bytes the bot reads. ` +
      `Split it into smaller files with the same header line.`);
  }

  const upload = readNewsImportUpload(await start.fetchText());
  if (!upload.ok) return reply(`${upload.reason} Start from a file ${download} gave you.`);

  const totals: IUploadTotals = { assigned: 0, removed: 0, unsorted, problems: [], moves: [] };
  const failure = await assignAll(start, upload.rows, totals);
  // Rows applied before a failed request changed categories too, so their copies move.
  if (totals.moves.length) start.moveCopies(totals.moves);
  if (failure) return failure;
  const problems = [...upload.problems, ...totals.problems].sort((a, b) => a.line - b.line);

  const lines = [
    `**News Import upload** (${code(start.file.name)})`,
    `- **${totals.assigned}** assigned a News Category: shown on the website`,
    `- **${totals.removed}** removed with ${code("skip")}`,
    `- **${problems.length}** rejected`,
  ];
  if (upload.blank) lines.push(`- **${upload.blank}** left blank: still unsorted`);
  if (totals.moves.length) {
    lines.push(`- ${plural(totals.moves.length, "News Copy moving to its new category's thread",
      "News Copies moving to their new categories' threads")}`);
  }
  lines.push(`${plural(totals.unsorted, "imported News Item is", "imported News Items are")} ` +
    "still unsorted.");
  if (!problems.length) return reply(lines.join("\n"));

  const rejectedRows = problems.map(problemLine).join("\n");
  const listed = `${lines.join("\n")}\n\n**Rejected rows**\n${rejectedRows}`;
  if (listed.length <= MAX_CONTAINER_TEXT) return reply(listed);
  lines.push("", `The rejected rows and their reasons are in the attached ${code(REJECTED_FILE)}.`);
  return reply(lines.join("\n"), [rejectedFile(problems)]);
}
