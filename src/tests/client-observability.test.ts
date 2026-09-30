import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Client, Events, RESTEvents, type RateLimitData } from "discord.js";
import { registerClientObservability } from "../services/ClientObservability.js";

function captureConsole(t: TestContext): string[] {
  const lines: string[] = [];
  const record = (line: unknown): void => {
    lines.push(String(line));
  };
  t.mock.method(console, "error", record);
  t.mock.method(console, "warn", record);
  t.mock.method(console, "log", record);
  return lines;
}

function createClient(t: TestContext): Client {
  const client = new Client({ intents: [] });
  t.after(() => client.destroy());
  return client;
}

test("invalidated logs and runs the shutdown callback", (t) => {
  const lines = captureConsole(t);
  const client = createClient(t);
  let shutdowns = 0;
  registerClientObservability(client, () => {
    shutdowns += 1;
  });

  client.emit(Events.Invalidated);

  assert.equal(shutdowns, 1);
  assert.equal(JSON.parse(lines[0]).context, "ClientObservability.invalidated");
});

test("an unrecoverable shardDisconnect runs the shutdown callback once", (t) => {
  const lines = captureConsole(t);
  const client = createClient(t);
  let shutdowns = 0;
  registerClientObservability(client, () => {
    shutdowns += 1;
  });

  client.emit(Events.ShardDisconnect, { code: 4004, reason: "", wasClean: true }, 0);
  client.emit(Events.Invalidated);

  assert.equal(shutdowns, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.context, "ClientObservability.shardDisconnect");
  assert.equal(entry.error.code, 4004);
  assert.equal(entry.error.codeName, "AuthenticationFailed");
});

test("recoverable shard events are logged with the shard id", (t) => {
  const lines = captureConsole(t);
  const client = createClient(t);
  registerClientObservability(client, () => {});

  client.emit(Events.ShardReconnecting, 0);
  client.emit(Events.ShardResume, 0, 12);
  client.emit(Events.ShardError, new Error("socket hang up"), 0);

  const parsed = lines.map((line) => JSON.parse(line));
  assert.deepEqual(
    parsed.map((entry) => entry.context),
    [
      "ClientObservability.shardReconnecting",
      "ClientObservability.shardResume",
      "ClientObservability.shardError",
    ],
  );
  assert.equal(parsed[1].message.replayedEvents, 12);
  assert.equal(parsed[2].error.error.message, "socket hang up");
});

test("rateLimited logs route, limit, and retry-after", (t) => {
  const lines = captureConsole(t);
  const client = createClient(t);
  registerClientObservability(client, () => {});

  const info = {
    method: "POST",
    route: "/webhooks/:id/:token/messages/:id",
    url: "https://discord.com/api/v10/webhooks/1/secret-token/messages/@original",
    limit: 5,
    retryAfter: 1500,
    global: false,
    scope: "user",
  } as RateLimitData;
  client.rest.emit(RESTEvents.RateLimited, info);

  const entry = JSON.parse(lines[0]);
  assert.equal(entry.context, "ClientObservability.rateLimited");
  assert.equal(entry.message.route, "/webhooks/:id/:token/messages/:id");
  assert.equal(entry.message.limit, 5);
  assert.equal(entry.message.retryAfterMs, 1500);
  assert.equal(entry.message.url, undefined);
});
