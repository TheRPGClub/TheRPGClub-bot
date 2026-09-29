import assert from "node:assert/strict";
import test from "node:test";
import { AxiosError, AxiosHeaders } from "axios";
import { buildApiErrorMessage, decodeBinaryBody } from "../utilities/ApiErrorUtils.js";

function notFoundError(): AxiosError {
  const request = { method: "post", url: "/api/v1/games", data: `{"igdb_id":4242}` };
  const response: any = {
    status: 404,
    data: { error: "IGDB game not found" },
    headers: {},
    statusText: "Not Found",
    config: { headers: new AxiosHeaders() },
  };
  return new AxiosError("Request failed", "ERR_BAD_REQUEST", request as any, null, response);
}

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

test("buildApiErrorMessage renders request and response for an AxiosError cause", () => {
  const err = new Error("No IGDB game found with that id.", { cause: notFoundError() });
  const text = buildApiErrorMessage("Failed to add completion.", err);
  assert.match(text, /^Failed to add completion\.: No IGDB game found with that id\./);
  assert.match(text, /Request:/);
  assert.match(text, /"method": "POST"/);
  assert.match(text, /api\/v1\/games/);
  assert.match(text, /"igdb_id": 4242/);
  assert.match(text, /Response:/);
  assert.match(text, /"status": 404/);
  assert.match(text, /IGDB game not found/);
});

test("buildApiErrorMessage keeps the plain message when the cause is not an AxiosError", () => {
  const err = new Error("boom", { cause: new Error("inner") });
  const text = buildApiErrorMessage("Failed.", err);
  assert.match(text, /^Failed\.: boom\n/);
  assert.doesNotMatch(text, /Request:/);
});
