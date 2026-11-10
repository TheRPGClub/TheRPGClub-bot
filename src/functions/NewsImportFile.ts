import { NEWS_CATEGORY_KEYS, type NewsCategoryKey } from "../config/newsHub.js";
import { delimitedField, parseDelimited } from "./DelimitedText.js";

// The News Import file (spec api#355, bot#1527): staff download the unsorted imported News
// Items, fill in the `category` column on their own machine (with any model they like),
// and upload the file back. Only `message_id` and `category` are read back; the other
// columns are there for whoever sorts the rows.

/** One unsorted imported News Item as `GET /api/v1/news_import/items` lists it. */
export interface INewsImportListItem {
  message_id: string;
  posted_at: string;
  author_name: string;
  comment: string | null;
  link_url: string | null;
  link_title: string | null;
  link_site_name: string | null;
  link_description: string | null;
  image_count: number;
}

const ITEM_COLUMNS = [
  "message_id",
  "posted_at",
  "author_name",
  "comment",
  "link_url",
  "link_title",
  "link_site_name",
  "link_description",
  "image_count",
] as const satisfies readonly (keyof INewsImportListItem)[];

/** The columns holding what members wrote and linked, with their links' previews. */
const MEMBER_TEXT_COLUMNS: ReadonlySet<string> = new Set<keyof INewsImportListItem>([
  "author_name",
  "comment",
  "link_url",
  "link_title",
  "link_site_name",
  "link_description",
]);

/** Starts that make a spreadsheet program read a cell as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Spreadsheet-safe cells: member text a spreadsheet would read as a formula gets a leading
 * single quote, so it shows as text. Upload reads only message_id and category, so nothing
 * needs undoing.
 */
function spreadsheetSafe(column: string, value: string): string {
  return MEMBER_TEXT_COLUMNS.has(column) && FORMULA_START.test(value) ? `'${value}` : value;
}

const MESSAGE_ID_COLUMN = "message_id";
const CATEGORY_COLUMN = "category";

/** The download's columns, in order. Staff fill in the last one. */
export const NEWS_IMPORT_FILE_COLUMNS = [...ITEM_COLUMNS, CATEGORY_COLUMN] as const;

export const NEWS_IMPORT_SKIP = "skip";

export type NewsImportValue = NewsCategoryKey | typeof NEWS_IMPORT_SKIP;

/** What the category column accepts: a News Category key, or `skip` to remove the item. */
export const NEWS_IMPORT_VALUES: readonly NewsImportValue[] = [
  ...NEWS_CATEGORY_KEYS,
  NEWS_IMPORT_SKIP,
];

/** Lets spreadsheet programs open the file as UTF-8. Reading drops it again. */
const BYTE_ORDER_MARK = "﻿";

function line(fields: readonly string[]): string {
  return `${fields.map(delimitedField).join(",")}\r\n`;
}

const HEADER_LINE = BYTE_ORDER_MARK + line(NEWS_IMPORT_FILE_COLUMNS);

function itemLine(item: Readonly<INewsImportListItem>): string {
  const fields = ITEM_COLUMNS.map((column) =>
    spreadsheetSafe(column, String(item[column] ?? "")));
  return line([...fields, ""]);
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf-8");
}

/**
 * The download as one or more file texts, each at most `maxBytes` (UTF-8) and each with
 * the header, so every part can be uploaded on its own. Items keep their order. An item
 * too large for any part on its own still gets a part to itself.
 */
export function newsImportFileParts(
  items: readonly Readonly<INewsImportListItem>[],
  maxBytes: number,
): string[] {
  const headerBytes = byteLength(HEADER_LINE);
  const parts: string[] = [];
  let lines: string[] = [];
  let size = headerBytes;
  for (const item of items) {
    const text = itemLine(item);
    const bytes = byteLength(text);
    if (lines.length && size + bytes > maxBytes) {
      parts.push(HEADER_LINE + lines.join(""));
      lines = [];
      size = headerBytes;
    }
    lines.push(text);
    size += bytes;
  }
  if (lines.length) parts.push(HEADER_LINE + lines.join(""));
  return parts;
}

/** A row that assigns a News Category or removes the item. */
export interface INewsImportUploadRow {
  /** The file line the row starts on. */
  line: number;
  messageId: string;
  value: NewsImportValue;
}

/** A row the bot leaves out, with why. */
export interface INewsImportRowProblem {
  line: number;
  messageId: string;
  value: string;
  reason: string;
}

export type NewsImportUpload =
  | { ok: false; reason: string }
  | {
    ok: true;
    rows: INewsImportUploadRow[];
    /** Rows with an empty category: left unsorted, not sent. */
    blank: number;
    problems: INewsImportRowProblem[];
  };

const INVALID_VALUE_REASON = "invalid value: expected one of " +
  `${NEWS_CATEGORY_KEYS.join(", ")} or ${NEWS_IMPORT_SKIP}`;

const NOT_AN_ID_REASON = "not a Discord message ID (a spreadsheet may have turned it into a " +
  "number; keep the message_id column as text)";

function isValue(value: string): value is NewsImportValue {
  return (NEWS_IMPORT_VALUES as readonly string[]).includes(value);
}

function headerProblem(header: readonly string[] | undefined): string | null {
  const names = (header ?? []).map((name) => name.trim().toLowerCase());
  const wrong = [MESSAGE_ID_COLUMN, CATEGORY_COLUMN]
    .filter((column) => names.filter((name) => name === column).length !== 1);
  if (!wrong.length) return null;
  return "The first line must be the downloaded file's header, with one " +
    `\`${MESSAGE_ID_COLUMN}\` column and one \`${CATEGORY_COLUMN}\` column ` +
    `(not found once: ${wrong.map((column) => `\`${column}\``).join(", ")}).`;
}

/**
 * Reads an uploaded News Import file. Columns are found by name in the first line (case
 * and spaces ignored), so extra or reordered columns are fine. Each data row is a row to
 * send, a blank category, or a problem; one bad row never stops the others. A message ID
 * given a value more than once is a problem every time, as the API counts it.
 */
export function readNewsImportUpload(text: string): NewsImportUpload {
  const { records, malformed } = parseDelimited(text);
  const first = records.at(0);
  const headerBroken = first && malformed.length && malformed[0].line < first.line;
  const header = headerBroken ? undefined : first?.fields;
  const wrongHeader = headerProblem(header);
  if (!header || wrongHeader) {
    return { ok: false, reason: wrongHeader ?? "The file is empty." };
  }
  const names = header.map((name) => name.trim().toLowerCase());
  const idAt = names.indexOf(MESSAGE_ID_COLUMN);
  const valueAt = names.indexOf(CATEGORY_COLUMN);

  const problems: INewsImportRowProblem[] = malformed.map((bad) => ({
    line: bad.line,
    messageId: "",
    value: "",
    reason: `malformed line: ${bad.reason}`,
  }));
  const rows: INewsImportUploadRow[] = [];
  let blank = 0;
  for (const record of records.slice(1)) {
    const messageId = (record.fields[idAt] ?? "").trim();
    const raw = (record.fields[valueAt] ?? "").trim();
    const problem = (reason: string): void => {
      problems.push({ line: record.line, messageId, value: raw, reason });
    };
    if (record.fields.length !== header.length) {
      problem(`malformed line: expected ${header.length} fields, ` +
        `found ${record.fields.length}`);
      continue;
    }
    const value = raw.toLowerCase();
    if (!value) blank += 1;
    else if (!messageId) problem("missing message ID");
    else if (!/^\d+$/.test(messageId)) problem(NOT_AN_ID_REASON);
    else if (!isValue(value)) problem(INVALID_VALUE_REASON);
    else rows.push({ line: record.line, messageId, value });
  }

  const seen = new Map<string, number>();
  for (const row of rows) seen.set(row.messageId, (seen.get(row.messageId) ?? 0) + 1);
  const repeated = rows.filter((row) => (seen.get(row.messageId) ?? 0) > 1);
  for (const row of repeated) {
    problems.push({ ...row, reason: "message ID appears more than once" });
  }
  problems.sort((a, b) => a.line - b.line);
  return {
    ok: true,
    rows: rows.filter((row) => (seen.get(row.messageId) ?? 0) === 1),
    blank,
    problems,
  };
}
