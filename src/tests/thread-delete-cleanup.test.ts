import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { GatewayDispatchEvents, type Client } from "discord.js";
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from "axios";
import {
  registerUncachedThreadDeleteCleanup,
  removeDeletedThreadLinks,
} from "../services/ThreadDeleteCleanup.js";

const THREAD_ID = "123456789012345678";
const LINKS_URL = `/api/v1/threads/${THREAD_ID}/links`;

function serverError(): AxiosError {
  const config = {
    method: "delete",
    url: LINKS_URL,
    headers: new AxiosHeaders(),
  } as InternalAxiosRequestConfig;
  return new AxiosError("Request failed with status code 500", "ERR_BAD_RESPONSE", config, null, {
    config,
    data: { error: "Internal Server Error" },
    headers: {},
    status: 500,
    statusText: "Internal Server Error",
  });
}

test("removeDeletedThreadLinks removes every link for the deleted thread", async (t) => {
  const remove = t.mock.fn(async (_threadId: string) => 2);

  const removed = await removeDeletedThreadLinks(THREAD_ID, false, remove);

  assert.equal(removed, 2);
  assert.equal(remove.mock.callCount(), 1);
  assert.deepEqual(remove.mock.calls[0].arguments, [THREAD_ID]);
});

test("removeDeletedThreadLinks calls nothing in test mode", async (t) => {
  const remove = t.mock.fn(async (_threadId: string) => 1);

  const removed = await removeDeletedThreadLinks(THREAD_ID, true, remove);

  assert.equal(removed, 0);
  assert.equal(remove.mock.callCount(), 0);
});

test("removeDeletedThreadLinks logs the request and response when the API fails", async (t) => {
  const consoleError = t.mock.method(console, "error", () => undefined);
  const remove = t.mock.fn(async (_threadId: string): Promise<number> => {
    throw serverError();
  });

  const removed = await removeDeletedThreadLinks(THREAD_ID, false, remove);

  assert.equal(removed, 0);
  assert.equal(consoleError.mock.callCount(), 1);
  const logged = String(consoleError.mock.calls[0].arguments[0]);
  assert.match(logged, /ThreadDeleted\.removeGameLinks/);
  assert.match(logged, /Request:/);
  assert.match(logged, /\\"method\\": \\"DELETE\\"/);
  assert.ok(logged.includes(LINKS_URL));
  assert.match(logged, /Response:/);
  assert.match(logged, /\\"status\\": 500/);
  assert.match(logged, /Internal Server Error/);
});

function fakeClient(cachedIds: string[]): { client: Client; ws: EventEmitter } {
  const ws = new EventEmitter();
  const cache = new Map(cachedIds.map((id) => [id, {}]));
  const client = { ws, channels: { cache } } as unknown as Client;
  return { client, ws };
}

test("an uncached deleted thread is cleaned up from the gateway packet", (t) => {
  const { client, ws } = fakeClient([]);
  const cleanup = t.mock.fn(async (_threadId: string) => 1);
  registerUncachedThreadDeleteCleanup(client, cleanup);

  ws.emit(GatewayDispatchEvents.ThreadDelete, { id: THREAD_ID });

  assert.equal(cleanup.mock.callCount(), 1);
  assert.deepEqual(cleanup.mock.calls[0].arguments, [THREAD_ID]);
});

test("a cached deleted thread is left to the threadDelete handler", (t) => {
  const { client, ws } = fakeClient([THREAD_ID]);
  const cleanup = t.mock.fn(async (_threadId: string) => 1);
  registerUncachedThreadDeleteCleanup(client, cleanup);

  ws.emit(GatewayDispatchEvents.ThreadDelete, { id: THREAD_ID });

  assert.equal(cleanup.mock.callCount(), 0);
});
