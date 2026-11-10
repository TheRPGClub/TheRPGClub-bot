import assert from "node:assert/strict";
import test from "node:test";
import { parseDelimited, writeDelimited } from "../functions/DelimitedText.js";

test("plain fields are written bare, one CRLF-ended line per row", () => {
  assert.equal(writeDelimited([["a", "b"], ["1", ""]]), "a,b\r\n1,\r\n");
});

test("fields with commas, quotes or line breaks are quoted with doubled quotes", () => {
  const text = writeDelimited([["a,b", "say \"hi\"", "one\ntwo", "cr\rlf\r\n", " pad "]]);

  assert.equal(text, "\"a,b\",\"say \"\"hi\"\"\",\"one\ntwo\",\"cr\rlf\r\n\", pad \r\n");
});

test("reading gives each record's fields and the line it starts on", () => {
  const { records, malformed } = parseDelimited("h1,h2\r\n\"x,\ny\",\"q\"\"\"\nlast,\n");

  assert.deepEqual(malformed, []);
  assert.deepEqual(records, [
    { line: 1, fields: ["h1", "h2"] },
    { line: 2, fields: ["x,\ny", "q\""] },
    { line: 4, fields: ["last", ""] },
  ]);
});

test("a byte order mark is dropped, blank lines are skipped, a final line needs no break", () => {
  const { records } = parseDelimited("﻿a,b\r\n\r\n1,2");

  assert.deepEqual(records, [
    { line: 1, fields: ["a", "b"] },
    { line: 3, fields: ["1", "2"] },
  ]);
});

test("written rows read back unchanged", () => {
  const rows = [
    ["id", "comment"],
    ["1", "Commas, \"quotes\",\r\nand\nbreaks\r"],
    ["2", ""],
    ["3", "\""],
  ];

  const { records, malformed } = parseDelimited(writeDelimited(rows));

  assert.deepEqual(malformed, []);
  assert.deepEqual(records.map((record) => record.fields), rows);
});

test("a malformed line is reported and reading carries on with the next line", () => {
  const text = "a,b\n1,\"ok\"z\n2,fine\n3,\"never closed\n4,last";

  const { records, malformed } = parseDelimited(text);

  assert.deepEqual(records.map((record) => record.line), [1, 3, 5]);
  assert.deepEqual(malformed.map((line) => line.line), [2, 4]);
  assert.match(malformed[0].reason, /after a closing quote/);
  assert.match(malformed[1].reason, /quoted field is never closed/);
  assert.equal(malformed[1].text, "3,\"never closed");
});

test("a quote inside an unquoted field is malformed", () => {
  const { records, malformed } = parseDelimited("a,b\"c\n1,2");

  assert.deepEqual(records, [{ line: 2, fields: ["1", "2"] }]);
  assert.deepEqual(malformed.map((line) => line.line), [1]);
  assert.match(malformed[0].reason, /quote inside an unquoted field/);
});
