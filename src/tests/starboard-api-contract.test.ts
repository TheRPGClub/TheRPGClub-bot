import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import Starboard from "../classes/Starboard.js";

/**
 * The starboard endpoints are documented in .claude/skills/api-reference:
 *   POST /api/v1/starboard
 *     data: { message_id*, channel_id*, starboard_message_id*, author_id*, star_count }
 * Dropping starboard_message_id made every POST fail, which left no dedupe row
 * and reposted a quote on every star (issue 1097). These tests pin the wire
 * contract so a future refactor of Starboard cannot drift from it silently.
 */
const REQUIRED_INSERT_FIELDS = [
  "message_id",
  "channel_id",
  "starboard_message_id",
  "author_id",
];
const OPTIONAL_INSERT_FIELDS = ["star_count"];

const SHOW_RESPONSE = {
  data: {
    message_id: "msg-1",
    channel_id: "chan-1",
    starboard_message_id: "posted-1",
    author_id: "author-1",
    star_count: 4,
    created_at: "2026-01-01T00:00:00Z",
  },
};

type CapturedRequest = {
  method: string;
  url: string;
  body: Record<string, unknown>;
};

// The API client caches a single axios instance keyed to the base URL it saw
// first, so every test in this file shares one stub server.
const requests: CapturedRequest[] = [];
let server: Server;

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function lastRequest(): CapturedRequest {
  const request = requests.at(-1);
  assert.ok(request, "the stub API received a request");
  return request;
}

before(async () => {
  server = createServer((req, res) => {
    void (async () => {
      const method = req.method ?? "";
      const url = req.url ?? "";
      requests.push({ method, url, body: await readBody(req) });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(method === "GET" ? SHOW_RESPONSE : { data: {} }));
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  process.env.RPGCLUB_API_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.RPGCLUB_BOT_API_TOKEN = "test-token";
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("Starboard.insert sends every field the starboard endpoint requires", async () => {
  await Starboard.insert({
    messageId: "msg-1",
    channelId: "chan-1",
    starboardMessageId: "posted-1",
    authorId: "author-1",
    starCount: 3,
  });

  const request = lastRequest();
  assert.equal(request.method, "POST");
  assert.equal(request.url, "/api/v1/starboard");

  const data = request.body.data as Record<string, unknown>;
  assert.ok(data, "body is wrapped in a data envelope");
  for (const field of REQUIRED_INSERT_FIELDS) {
    assert.ok(field in data, `body includes required field ${field}`);
    assert.ok(data[field], `required field ${field} is not empty`);
  }
  assert.deepEqual(
    Object.keys(data).filter((key) => !REQUIRED_INSERT_FIELDS.includes(key)).sort(),
    OPTIONAL_INSERT_FIELDS,
    "body sends no fields the endpoint does not accept",
  );
  assert.equal(data.starboard_message_id, "posted-1");
  assert.equal(data.star_count, 3);
});

test("Starboard.getByMessageId maps the fields the endpoint returns", async () => {
  const record = await Starboard.getByMessageId("msg-1");

  assert.equal(lastRequest().url, "/api/v1/starboard/msg-1");
  assert.deepEqual(record, {
    messageId: "msg-1",
    channelId: "chan-1",
    starboardMessageId: "posted-1",
    authorId: "author-1",
    starCount: 4,
    createdAt: "2026-01-01T00:00:00Z",
  });
});
