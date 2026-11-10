import assert from "node:assert/strict";
import test from "node:test";
import { AxiosError, AxiosHeaders, type AxiosResponse } from "axios";
import { parseDelimited, writeDelimited } from "../functions/DelimitedText.js";
import { NEWS_IMPORT_FILE_COLUMNS, type INewsImportListItem } from "../functions/NewsImportFile.js";
import { NEWS_IMPORT_STAFF_ONLY_MESSAGE } from "../services/NewsImport.js";
import type {
  INewsImportApi,
  INewsImportAssignResult,
  INewsImportAssignRow,
} from "../services/NewsImportApi.js";
import {
  newsImportDownloadReply,
  newsImportUploadReply,
  type INewsImportUploadStart,
} from "../services/NewsImportTransfer.js";

const STAFF_ID = "730000000000000001";
const NOW = new Date(Date.UTC(2026, 10, 10, 12));

function forbidden(): AxiosError {
  const config = {
    method: "get",
    url: `/api/v1/news_import/items?acting_user_id=${STAFF_ID}&page=1&per=500`,
    headers: new AxiosHeaders(),
  };
  const response = {
    status: 403,
    statusText: "",
    data: { error: "forbidden" },
    headers: {},
    config,
  } as AxiosResponse;
  return new AxiosError("Request failed", "ERR_BAD_REQUEST", config, null, response);
}

function id(n: number): string {
  return String(630000000000000000n + BigInt(n));
}

function item(n: number, comment: string | null = null): INewsImportListItem {
  return {
    message_id: id(n),
    posted_at: "2019-06-01T10:00:00.000Z",
    author_name: "reporter",
    comment,
    link_url: `https://example.com/${n}`,
    link_title: null,
    link_site_name: null,
    link_description: null,
    image_count: 0,
  };
}

interface IFakeImportApi extends INewsImportApi {
  pagesRead: { actingUserId: string; page: number }[];
  assignCalls: { actingUserId: string; rows: INewsImportAssignRow[] }[];
  statusCalls: number;
  /** The imported items' categories, as the API would store them. */
  categories: Map<string, string | null>;
}

/**
 * An API holding `items`, served `perPage` at a time. Assignment follows the API's rules
 * for known IDs and values; an unknown ID is rejected.
 */
function fakeApi(items: INewsImportListItem[], options: {
  perPage?: number;
  error?: unknown;
} = {}): IFakeImportApi {
  const perPage = options.perPage ?? 2;
  const api: IFakeImportApi = {
    pagesRead: [],
    assignCalls: [],
    statusCalls: 0,
    categories: new Map(items.map((one) => [one.message_id, null])),
    async status() {
      api.statusCalls += 1;
      if (options.error) throw options.error;
      const values = [...api.categories.values()];
      const unsorted = values.filter((value) => value === null).length;
      return { sorted: values.length - unsorted, unsorted, removed: 0 };
    },
    async recordBatch() {
      throw new Error("not used");
    },
    async list(actingUserId, page) {
      api.pagesRead.push({ actingUserId, page });
      if (options.error) throw options.error;
      const unsorted = items.filter((one) => api.categories.get(one.message_id) === null);
      const slice = unsorted.slice((page - 1) * perPage, page * perPage);
      const next = page * perPage < unsorted.length ? page + 1 : null;
      return { items: slice, next };
    },
    async assign(actingUserId, rows): Promise<INewsImportAssignResult> {
      api.assignCalls.push({ actingUserId, rows: [...rows] });
      if (options.error) throw options.error;
      const result: INewsImportAssignResult = {
        assigned: 0, removed: 0, rejected: 0, unsorted: 0, rejections: [],
      };
      rows.forEach((row, index) => {
        if (!api.categories.has(row.messageId)) {
          result.rejected += 1;
          result.rejections.push({ index, ...row, reason: "unknown message ID" });
        } else if (row.value === "skip") {
          result.removed += 1;
          api.categories.delete(row.messageId);
        } else {
          result.assigned += 1;
          api.categories.set(row.messageId, row.value);
        }
      });
      result.unsorted = [...api.categories.values()].filter((value) => value === null).length;
      return result;
    },
  };
  return api;
}

test("download lists every unsorted item into one file and names the accepted values", async () => {
  const api = fakeApi([item(1), item(2), item(3, "Out now, finally")]);

  const messages = await newsImportDownloadReply(STAFF_ID, {
    api, maxBytes: 1_000_000, now: () => NOW,
  });

  assert.deepEqual(api.pagesRead.map((read) => read.page), [1, 2]);
  assert.ok(api.pagesRead.every((read) => read.actingUserId === STAFF_ID));
  assert.equal(messages.length, 1);
  const [message] = messages;
  assert.match(message.text, /\*\*3\*\* unsorted/);
  for (const value of [
    "announcements", "releases", "emulation", "industry", "hardware", "rumours", "general",
    "skip",
  ]) {
    assert.match(message.text, new RegExp(`\`${value}\``));
  }
  assert.equal(message.files.length, 1);
  assert.equal(message.files[0].name, "news-import-unsorted-2026-11-10.csv");
  const { records } = parseDelimited(message.files[0].text);
  assert.deepEqual(records[0].fields, [...NEWS_IMPORT_FILE_COLUMNS]);
  assert.deepEqual(records.slice(1).map((record) => record.fields[0]), [id(1), id(2), id(3)]);
});

test("download with nothing unsorted sends no file", async () => {
  const messages = await newsImportDownloadReply(STAFF_ID, {
    api: fakeApi([]), maxBytes: 1_000_000, now: () => NOW,
  });

  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].files, []);
  assert.match(messages[0].text, /No imported News Items are unsorted/);
});

test("download over the upload limit arrives as numbered files, ten per message", async () => {
  const items = Array.from({ length: 24 }, (_, i) => item(i + 1, "x".repeat(300)));
  const maxBytes = 1_000;

  const messages = await newsImportDownloadReply(STAFF_ID, {
    api: fakeApi(items, { perPage: 500 }), maxBytes, now: () => NOW,
  });

  const files = messages.flatMap((message) => message.files);
  assert.ok(files.length > 10);
  assert.ok(messages.every((message) => message.files.length <= 10));
  assert.ok(messages.every((message) =>
    message.files.reduce((sum, file) => sum + Buffer.byteLength(file.text), 0) <= maxBytes));
  assert.equal(files[0].name, `news-import-unsorted-2026-11-10-part-1-of-${files.length}.csv`);
  assert.match(messages[0].text, new RegExp(`in \\*\\*${files.length}\\*\\* files`));
  const ids = files.flatMap((file) =>
    parseDelimited(file.text).records.slice(1).map((record) => record.fields[0]));
  assert.deepEqual(ids, items.map((one) => one.message_id));
});

test("download refuses a member who is not an Admin or Superadmin", async () => {
  const messages = await newsImportDownloadReply(STAFF_ID, {
    api: fakeApi([item(1)], { error: forbidden() }), maxBytes: 1_000_000, now: () => NOW,
  });

  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].files, []);
  assert.ok(messages[0].text.startsWith(NEWS_IMPORT_STAFF_ONLY_MESSAGE));
  assert.match(messages[0].text, /"status": 403/);
});

function fileOf(rows: string[][]): string {
  return writeDelimited([[...NEWS_IMPORT_FILE_COLUMNS], ...rows]);
}

function row(messageId: string, category: string, comment = ""): string[] {
  return [messageId, "2019-06-01T10:00:00.000Z", "reporter", comment, "", "", "", "", "0",
    category];
}

function uploadStart(
  api: INewsImportApi,
  text: string,
  overrides: Partial<INewsImportUploadStart> = {},
): INewsImportUploadStart & { fetches: number } {
  const start = {
    actingUserId: STAFF_ID,
    testMode: false,
    api,
    maxBytes: 1_000_000,
    file: { name: "sorted.csv", size: Buffer.byteLength(text), contentType: "text/csv" },
    fetches: 0,
    async fetchText() {
      start.fetches += 1;
      return text;
    },
    ...overrides,
  };
  return start;
}

test("upload assigns categories, removes skip rows, leaves blank rows out", async () => {
  const api = fakeApi([item(1), item(2), item(3), item(4)]);
  const text = fileOf([
    row(id(1), "Releases"),
    row(id(2), "skip"),
    row(id(3), ""),
    row(id(4), "general", "a, \"quoted\"\nline"),
  ]);

  const reply = await newsImportUploadReply(uploadStart(api, text));

  assert.equal(api.assignCalls.length, 1);
  assert.equal(api.assignCalls[0].actingUserId, STAFF_ID);
  assert.deepEqual(api.assignCalls[0].rows, [
    { messageId: id(1), value: "releases" },
    { messageId: id(2), value: "skip" },
    { messageId: id(4), value: "general" },
  ]);
  assert.equal(reply.failed, false);
  assert.deepEqual(reply.files, []);
  assert.match(reply.text, /\*\*2\*\* assigned/);
  assert.match(reply.text, /\*\*1\*\* removed/);
  assert.match(reply.text, /\*\*0\*\* rejected/);
  assert.match(reply.text, /\*\*1\*\* left blank/);
  assert.match(reply.text, /\*\*1\*\* imported News Items? (is|are) still unsorted/);
});

test("upload reports the file's and the API's rejected rows by line, valid rows applied", async () => {
  const api = fakeApi([item(1), item(2)]);
  const text = fileOf([
    row(id(1), "piracy"),
    row(id(9), "industry"),
    ["broken", "\"x\"y"],
    row(id(2), "hardware"),
  ]);

  const reply = await newsImportUploadReply(uploadStart(api, text));

  assert.equal(api.categories.get(id(2)), "hardware");
  assert.match(reply.text, /\*\*1\*\* assigned/);
  assert.match(reply.text, /\*\*3\*\* rejected/);
  const lines = reply.text.split("\n");
  const at = (n: number): string => lines.find((one) => one.includes(`Line ${n}`)) ?? "";
  assert.match(at(2), new RegExp(`${id(1)}.*piracy.*invalid value`));
  assert.match(at(3), new RegExp(`${id(9)}.*unknown message ID`));
  assert.match(at(4), /malformed line/);
  assert.ok(reply.text.indexOf("Line 2") < reply.text.indexOf("Line 3"));
  assert.ok(reply.text.indexOf("Line 3") < reply.text.indexOf("Line 4"));
});

test("a second upload changes an imported item's category", async () => {
  const api = fakeApi([item(1)]);

  await newsImportUploadReply(uploadStart(api, fileOf([row(id(1), "rumours")])));
  await newsImportUploadReply(uploadStart(api, fileOf([row(id(1), "industry")])));

  assert.equal(api.categories.get(id(1)), "industry");
  assert.equal(api.assignCalls.length, 2);
});

test("a file over the API's row limit is sent in several requests, lines kept", async () => {
  const items = Array.from({ length: 5_001 }, (_, i) => item(i + 1));
  const api = fakeApi(items);
  const rows = items.map((one) => row(one.message_id, "general"));
  rows.push(row(id(9_999), "general"));

  const reply = await newsImportUploadReply(uploadStart(api, fileOf(rows)));

  assert.deepEqual(api.assignCalls.map((call) => call.rows.length), [5_000, 2]);
  assert.match(reply.text, /\*\*5001\*\* assigned/);
  assert.match(reply.text, new RegExp(`Line 5003 \\(\`${id(9_999)}\``));
});

test("a long list of rejected rows comes as an attached file", async () => {
  const api = fakeApi([]);
  const rows = Array.from({ length: 200 }, (_, i) => row(id(i + 1), "piracy"));

  const reply = await newsImportUploadReply(uploadStart(api, fileOf(rows)));

  assert.match(reply.text, /\*\*200\*\* rejected/);
  assert.match(reply.text, /attached/);
  assert.equal(reply.files.length, 1);
  const { records } = parseDelimited(reply.files[0].text);
  assert.deepEqual(records[0].fields, ["line", "message_id", "value", "reason"]);
  assert.equal(records.length, 201);
  assert.deepEqual(records[1].fields.slice(0, 3), ["2", id(1), "piracy"]);
});

test("upload is refused in test mode before any call", async () => {
  const api = fakeApi([item(1)]);
  const start = uploadStart(api, fileOf([row(id(1), "general")]), { testMode: true });

  const reply = await newsImportUploadReply(start);

  assert.match(reply.text, /disabled in test mode/);
  assert.equal(api.statusCalls, 0);
  assert.equal(start.fetches, 0);
});

test("upload refuses a member who is not an Admin or Superadmin, unread", async () => {
  const api = fakeApi([item(1)], { error: forbidden() });
  const start = uploadStart(api, fileOf([row(id(1), "general")]));

  const reply = await newsImportUploadReply(start);

  assert.ok(reply.text.startsWith(NEWS_IMPORT_STAFF_ONLY_MESSAGE));
  assert.equal(start.fetches, 0);
  assert.deepEqual(api.assignCalls, []);
});

test("upload refuses a file that is not a .csv, one over the size limit, a wrong header", async () => {
  const api = fakeApi([item(1)]);
  const good = fileOf([row(id(1), "general")]);

  const notCsv = await newsImportUploadReply(uploadStart(api, good, {
    file: { name: "notes.png", size: 10, contentType: "image/png" },
  }));
  const tooBig = await newsImportUploadReply(uploadStart(api, good, {
    file: { name: "sorted.csv", size: 2_000_000, contentType: "text/csv" },
  }));
  const header = await newsImportUploadReply(uploadStart(api, "title,platform\r\nA,B\r\n"));

  assert.match(notCsv.text, /\.csv/);
  assert.match(tooBig.text, /larger than/);
  assert.match(header.text, /header/);
  assert.deepEqual(api.assignCalls, []);
});
