import assert from "node:assert/strict";
import test from "node:test";
import { parseDelimited, writeDelimited } from "../functions/DelimitedText.js";
import {
  newsImportFileParts,
  readNewsImportUpload,
  type INewsImportListItem,
} from "../functions/NewsImportFile.js";

const HEADER = "message_id,posted_at,author_name,comment,link_url,link_title,link_site_name," +
  "link_description,image_count,category";

function item(n: number, overrides: Partial<INewsImportListItem> = {}): INewsImportListItem {
  return {
    message_id: String(630000000000000000n + BigInt(n)),
    posted_at: `2019-06-0${n % 9 + 1}T10:00:00.000Z`,
    author_name: "reporter",
    comment: null,
    link_url: `https://example.com/${n}`,
    link_title: `Story ${n}`,
    link_site_name: "Example",
    link_description: null,
    image_count: 0,
    ...overrides,
  };
}

function bytes(text: string): number {
  return Buffer.byteLength(text, "utf-8");
}

test("the download file has the columns in order and an empty category column", () => {
  const parts = newsImportFileParts([item(1, { image_count: 2, link_description: "Desc" })], 1e6);

  assert.equal(parts.length, 1);
  assert.equal(parts[0], "﻿" + HEADER + "\r\n" +
    "630000000000000001,2019-06-02T10:00:00.000Z,reporter,,https://example.com/1,Story 1," +
    "Example,Desc,2,\r\n");
});

test("commas, quotes and line breaks in a comment are quoted", () => {
  const comment = "Finally, \"the\" remake\nis out";

  const [part] = newsImportFileParts([item(1, { comment })], 1e6);

  assert.ok(part.includes(",\"Finally, \"\"the\"\" remake\nis out\","));
});

test("a downloaded file reads back with every item unsorted", () => {
  const items = [item(1, { comment: "a, \"b\"\r\nc" }), item(2)];
  const [part] = newsImportFileParts(items, 1e6);

  const { records } = parseDelimited(part);
  assert.equal(records[1].fields[3], "a, \"b\"\r\nc");

  const upload = readNewsImportUpload(part);
  assert.ok(upload.ok);
  assert.deepEqual(upload.rows, []);
  assert.equal(upload.blank, 2);
  assert.deepEqual(upload.problems, []);
});

test("a downloaded file with categories filled in reads back as rows by line", () => {
  const [part] = newsImportFileParts([item(1, { comment: "two\nlines" }), item(2)], 1e6);
  const { records } = parseDelimited(part);
  const edited = records.map((record, i) => {
    const fields = [...record.fields];
    if (i === 1) fields[9] = "Releases";
    if (i === 2) fields[9] = " skip ";
    return fields;
  });

  const upload = readNewsImportUpload(writeDelimited(edited));

  assert.ok(upload.ok);
  assert.deepEqual(upload.rows, [
    { line: 2, messageId: "630000000000000001", value: "releases" },
    { line: 4, messageId: "630000000000000002", value: "skip" },
  ]);
});

test("a list over the size limit is split into parts that each start with the header", () => {
  const items = Array.from({ length: 30 }, (_, i) => item(i + 1, { comment: "x".repeat(200) }));
  const limit = 2_000;

  const parts = newsImportFileParts(items, limit);

  assert.ok(parts.length > 1);
  const ids: string[] = [];
  for (const part of parts) {
    assert.ok(bytes(part) <= limit, `part of ${bytes(part)} bytes`);
    assert.ok(part.startsWith(`﻿${HEADER}\r\n`));
    const filled = parseDelimited(part).records.map((record, i) =>
      i === 0 ? record.fields : [...record.fields.slice(0, 9), "general"]);
    const upload = readNewsImportUpload(writeDelimited(filled));
    assert.ok(upload.ok);
    ids.push(...upload.rows.map((row) => row.messageId));
  }
  assert.deepEqual(ids, items.map((one) => one.message_id));
});

function upload(lines: string[]): ReturnType<typeof readNewsImportUpload> {
  return readNewsImportUpload([HEADER, ...lines].join("\n"));
}

const ID1 = "630000000000000001";
const ID2 = "630000000000000002";
const ID3 = "630000000000000003";

test("upload rows: a category or skip is kept, a blank category is left unsorted", () => {
  const result = upload([
    `${ID1},2019,a,,,,,,0,industry`,
    `${ID2},2019,a,,,,,,0,SKIP`,
    `${ID3},2019,a,,,,,,0,  `,
  ]);

  assert.ok(result.ok);
  assert.deepEqual(result.rows, [
    { line: 2, messageId: ID1, value: "industry" },
    { line: 3, messageId: ID2, value: "skip" },
  ]);
  assert.equal(result.blank, 1);
  assert.deepEqual(result.problems, []);
});

test("upload rows: unknown categories, bad IDs and malformed lines are reported by line", () => {
  const result = upload([
    `${ID1},2019,a,,,,,,0,piracy`,
    `${ID2},2019,"a"b,,,,,,0,general`,
    `${ID3},2019,a,,,,0,general`,
    "6.3E+17,2019,a,,,,,,0,general",
    ",2019,a,,,,,,0,general",
    `${ID3},2019,a,,,,,,0,hardware`,
  ]);

  assert.ok(result.ok);
  assert.deepEqual(result.rows, [{ line: 7, messageId: ID3, value: "hardware" }]);
  assert.deepEqual(result.problems.map((problem) => problem.line), [2, 3, 4, 5, 6]);
  const [category, malformed, short, notId, missing] = result.problems;
  assert.equal(category.messageId, ID1);
  assert.equal(category.value, "piracy");
  assert.match(category.reason, /invalid value: expected one of announcements, .* or skip/);
  assert.match(malformed.reason, /text after a closing quote/);
  assert.match(short.reason, /expected 10 fields, found 8/);
  assert.match(notId.reason, /not a Discord message ID/);
  assert.match(missing.reason, /missing message ID/);
});

test("upload rows: a message ID given a value twice is rejected every time", () => {
  const result = upload([
    `${ID1},2019,a,,,,,,0,industry`,
    `${ID1},2019,a,,,,,,0,general`,
    `${ID2},2019,a,,,,,,0,general`,
  ]);

  assert.ok(result.ok);
  assert.deepEqual(result.rows.map((row) => row.messageId), [ID2]);
  assert.deepEqual(result.problems.map((problem) => problem.line), [2, 3]);
  assert.match(result.problems[0].reason, /appears more than once/);
});

test("upload: extra columns and another column order are accepted by name", () => {
  const result = readNewsImportUpload(`Category,Message_ID,why\r\nemulation,${ID1},"ROM, news"`);

  assert.ok(result.ok);
  assert.deepEqual(result.rows, [{ line: 2, messageId: ID1, value: "emulation" }]);
});

test("upload: a file without the message_id and category header is refused", () => {
  const wrong = readNewsImportUpload(`title,platform\r\nChrono Trigger,SNES\r\n`);
  const empty = readNewsImportUpload("﻿\r\n");

  assert.ok(!wrong.ok);
  assert.match(wrong.reason, /message_id/);
  assert.match(wrong.reason, /category/);
  assert.ok(!empty.ok);
});
