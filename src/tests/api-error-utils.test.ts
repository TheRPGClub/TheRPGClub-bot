import assert from "node:assert/strict";
import test from "node:test";
import { AxiosError, AxiosHeaders } from "axios";
import {
  buildApiErrorMessage,
  decodeBinaryBody,
  redactUrlSecrets,
} from "../utilities/ApiErrorUtils.js";

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

test("redactUrlSecrets hides secret query values and keeps the rest", () => {
  const url = "https://id.twitch.tv/oauth2/token?client_id=abc"
    + "&client_secret=s3cr3t&grant_type=client_credentials";
  assert.equal(
    redactUrlSecrets(url),
    "https://id.twitch.tv/oauth2/token?client_id=abc"
      + "&client_secret=REDACTED&grant_type=client_credentials",
  );
  assert.equal(redactUrlSecrets("/api/v1/games?q=x"), "/api/v1/games?q=x");
});

test("buildApiErrorMessage never prints a Twitch client_secret from an AxiosError cause", () => {
  const request = {
    method: "post",
    url: "https://id.twitch.tv/oauth2/token?client_id=abc&client_secret=s3cr3t",
  };
  const response: any = {
    status: 400,
    data: { message: "invalid client secret" },
    headers: {},
    statusText: "Bad Request",
    config: { headers: new AxiosHeaders() },
  };
  const axiosErr = new AxiosError("Request failed", "ERR_BAD_REQUEST", request as any, null,
    response);
  const err = new Error("IGDB service unavailable", { cause: axiosErr });
  const message = buildApiErrorMessage("Failed to add completion.", err);
  assert.ok(!message.includes("s3cr3t"));
  assert.ok(message.includes("client_secret=REDACTED"));
});
