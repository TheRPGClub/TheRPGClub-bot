import assert from "node:assert/strict";
import test from "node:test";
import { decodeBinaryBody } from "../utilities/ApiErrorUtils.js";

test("decodeBinaryBody decodes a Buffer body to text", () => {
  assert.equal(decodeBinaryBody(Buffer.from("Not Found")), "Not Found");
});

test("decodeBinaryBody decodes an ArrayBuffer body to text", () => {
  const bytes = new TextEncoder().encode("Not Found");
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  assert.equal(decodeBinaryBody(arrayBuffer), "Not Found");
});

test("decodeBinaryBody truncates long binary bodies", () => {
  const decoded = decodeBinaryBody(Buffer.from("x".repeat(2000)));
  assert.equal(typeof decoded, "string");
  assert.equal((decoded as string).length, 500);
});

test("decodeBinaryBody passes non-binary bodies through", () => {
  const body = { error: "missing" };
  assert.equal(decodeBinaryBody(body), body);
});
