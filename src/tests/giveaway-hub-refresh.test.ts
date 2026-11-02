import assert from "node:assert/strict";
import test from "node:test";
import type { Client } from "discord.js";
import { refreshGiveawayHubMessage } from "../services/GiveawayHubService.js";

function fakeClient(fetchChannel: () => Promise<unknown>): Client {
  return { user: { id: "bot" }, channels: { fetch: fetchChannel } } as unknown as Client;
}

test("a strict hub refresh throws when the hub channel cannot be fetched", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const client = fakeClient(async () => {
    throw new Error("Unknown Channel");
  });
  await assert.rejects(
    refreshGiveawayHubMessage(client, 0, { throwOnFailure: true }),
    /Unknown Channel/,
  );
});

test("a strict hub refresh throws when the hub channel is missing", async (t) => {
  t.mock.method(console, "warn", () => undefined);
  const client = fakeClient(async () => null);
  await assert.rejects(
    refreshGiveawayHubMessage(client, 0, { throwOnFailure: true }),
    /not found or not text-based/,
  );
});

test("a default hub refresh still only logs a missing channel", async (t) => {
  t.mock.method(console, "warn", () => undefined);
  t.mock.method(console, "error", () => undefined);
  const client = fakeClient(async () => null);
  await refreshGiveawayHubMessage(client);
});
