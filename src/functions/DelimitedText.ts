// Comma-delimited text per RFC 4180: a field holding a comma, a quote or a line break is
// quoted, and a quote inside it is doubled. Unlike the line-based CSV helpers elsewhere in
// the bot, quoted fields here may span lines (News Item comments often do).

const NEEDS_QUOTES = /[",\r\n]/;
const LINE_BREAK = /\r\n|\r|\n/g;

/** One field as written: quoted only when it has to be. */
export function delimitedField(value: string): string {
  return NEEDS_QUOTES.test(value) ? `"${value.replaceAll("\"", "\"\"")}"` : value;
}

/** Rows as text, every row ending in CRLF (RFC 4180's line break). */
export function writeDelimited(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => `${row.map(delimitedField).join(",")}\r\n`).join("");
}

export interface IDelimitedRecord {
  /** The 1-based line of the file the record starts on. */
  line: number;
  fields: string[];
}

export interface IMalformedLine {
  line: number;
  /** The line as it appears in the file. */
  text: string;
  reason: string;
}

export interface IDelimitedText {
  records: IDelimitedRecord[];
  malformed: IMalformedLine[];
}

type RecordRead =
  | { fields: string[]; end: number; breaks: number }
  | { reason: string };

function countBreaks(text: string): number {
  return text.match(LINE_BREAK)?.length ?? 0;
}

function isRecordEnd(char: string | undefined): boolean {
  return char === undefined || char === "," || char === "\r" || char === "\n";
}

/** Reads one record from `pos`: its fields, where the next record starts, lines used. */
function readRecord(text: string, pos: number): RecordRead {
  const fields: string[] = [];
  let breaks = 0;
  for (;;) {
    if (text[pos] === "\"") {
      let value = "";
      pos += 1;
      for (;;) {
        const close = text.indexOf("\"", pos);
        if (close < 0) return { reason: "a quoted field is never closed" };
        value += text.slice(pos, close);
        pos = close + 1;
        if (text[pos] !== "\"") break;
        value += "\"";
        pos += 1;
      }
      if (!isRecordEnd(text[pos])) return { reason: "text after a closing quote" };
      breaks += countBreaks(value);
      fields.push(value);
    } else {
      let end = pos;
      while (!isRecordEnd(text[end])) {
        if (text[end] === "\"") return { reason: "a quote inside an unquoted field" };
        end += 1;
      }
      fields.push(text.slice(pos, end));
      pos = end;
    }
    if (pos >= text.length) return { fields, end: pos, breaks };
    if (text[pos] === ",") {
      pos += 1;
      continue;
    }
    pos += text.startsWith("\r\n", pos) ? 2 : 1;
    return { fields, end: pos, breaks: breaks + 1 };
  }
}

/** Where the physical line holding `pos` ends, and where the next one starts. */
function lineAt(text: string, pos: number): { end: number; next: number } {
  LINE_BREAK.lastIndex = pos;
  const found = LINE_BREAK.exec(text);
  LINE_BREAK.lastIndex = 0;
  if (!found) return { end: text.length, next: text.length };
  return { end: found.index, next: found.index + found[0].length };
}

/**
 * Reads the whole text into records, dropping a leading byte order mark and skipping blank
 * lines. A record that breaks the format is reported by its first line, and reading
 * carries on with the line after it, so one bad line never hides the rest.
 */
export function parseDelimited(input: string): IDelimitedText {
  const text = input.replace(/^﻿/, "");
  const records: IDelimitedRecord[] = [];
  const malformed: IMalformedLine[] = [];
  let pos = 0;
  let line = 1;
  while (pos < text.length) {
    const read = readRecord(text, pos);
    if ("reason" in read) {
      const physical = lineAt(text, pos);
      malformed.push({ line, text: text.slice(pos, physical.end), reason: read.reason });
      pos = physical.next;
      line += 1;
      continue;
    }
    const blank = read.fields.length === 1 && read.fields[0] === "";
    if (!blank) records.push({ line, fields: read.fields });
    pos = read.end;
    line += read.breaks;
  }
  return { records, malformed };
}
