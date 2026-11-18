import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { fetchImageBuffer } from "../services/GameImageService.js";

// fetchImageBuffer reads a cover or an avatar for the pictures the bot draws. Bot jobs run
// one after another, so a download that never answers must give up rather than hold up
// every later job.

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/avatar.png`;
}

test("fetchImageBuffer: a download that never answers gives up as no image", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const server = createServer(() => {
    // Never answers.
  });
  const url = await listen(server);
  try {
    const started = Date.now();
    assert.equal(await fetchImageBuffer(url, 100), null);
    assert.ok(Date.now() - started < 2000, "it waited for the server");
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("fetchImageBuffer: an answered download is the image's bytes", async () => {
  const server = createServer((_req, res) => {
    res.end(Buffer.from([1, 2, 3]));
  });
  const url = await listen(server);
  try {
    assert.deepEqual(await fetchImageBuffer(url), Buffer.from([1, 2, 3]));
  } finally {
    server.close();
  }
});
