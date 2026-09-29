import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import axios from "axios";
import Game from "../classes/Game.js";
import { buildApiErrorMessage } from "../utilities/ApiErrorUtils.js";

/**
 * POST /api/v1/games returns 404 when IGDB has no game for the id. The caller's
 * error reply must still show the request and response (issue 1164), so
 * createGame keeps the AxiosError as the cause of its friendly error.
 */
const NOT_FOUND_BODY = { error: "IGDB game not found" };
const MISSING_IGDB_ID = 4242;
const REJECTED_IGDB_ID = 5151;

// The API client caches a single axios instance keyed to the base URL it saw
// first, so every test in this file shares one stub server.
let server: Server;

before(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { igdb_id: number };
      const status = body.igdb_id === MISSING_IGDB_ID ? 404 : 422;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(status === 404 ? NOT_FOUND_BODY : { error: "invalid" }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  process.env.RPGCLUB_API_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.RPGCLUB_BOT_API_TOKEN = "test-token";
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("createGame wraps a 404 with the AxiosError as its cause", async () => {
  const err = await Game.createGame(MISSING_IGDB_ID).then(
    () => assert.fail("createGame should throw on 404"),
    (e: unknown) => e,
  );

  assert.ok(err instanceof Error);
  assert.equal(err.message, "No IGDB game found with that id.");
  assert.ok(axios.isAxiosError(err.cause), "cause is the AxiosError");

  const text = buildApiErrorMessage("Failed to add completion.", err);
  assert.match(text, /No IGDB game found with that id/);
  assert.match(text, /"method": "POST"/);
  assert.match(text, /api\/v1\/games/);
  assert.match(text, new RegExp(`"igdb_id": ${MISSING_IGDB_ID}`));
  assert.match(text, /"status": 404/);
  assert.match(text, /IGDB game not found/);
});

test("createGame rethrows other API errors unchanged", async () => {
  const err = await Game.createGame(REJECTED_IGDB_ID).then(
    () => assert.fail("createGame should throw on 422"),
    (e: unknown) => e,
  );

  assert.ok(axios.isAxiosError(err), "non-404 errors stay AxiosErrors");
  assert.equal(err.response?.status, 422);
});
