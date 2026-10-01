import assert from "node:assert/strict";
import test from "node:test";
import { LimitedCollection } from "discord.js";
import {
  CLIENT_MAKE_CACHE,
  CLIENT_SWEEPERS,
  MESSAGE_CACHE_MAX_PER_CHANNEL,
  MESSAGE_SWEEP_LIFETIME_SECONDS,
  PRESENCE_CACHE_MAX_PER_GUILD,
  THREAD_SWEEP_LIFETIME_SECONDS,
} from "../config/clientCache.js";

// cacheWithLimits picks the limit by the manager's class name, so a named stub is enough.
type LooseCacheFactory = (managerType: unknown, holds: unknown, manager: unknown) => unknown;

function cacheFor(managerName: string): unknown {
  const manager = { name: managerName };
  return (CLIENT_MAKE_CACHE as unknown as LooseCacheFactory)(manager, undefined, manager);
}

test("message and presence caches are bounded", () => {
  const messages = cacheFor("MessageManager");
  const presences = cacheFor("PresenceManager");
  assert.ok(messages instanceof LimitedCollection);
  assert.ok(presences instanceof LimitedCollection);
  assert.equal(messages.maxSize, MESSAGE_CACHE_MAX_PER_CHANNEL);
  assert.equal(presences.maxSize, PRESENCE_CACHE_MAX_PER_GUILD);
});

test("users and members stay unbounded for userUpdate and member logs", () => {
  assert.ok(!(cacheFor("UserManager") instanceof LimitedCollection));
  assert.ok(!(cacheFor("GuildMemberManager") instanceof LimitedCollection));
});

test("sweepers cover messages and keep the thread sweeper", () => {
  const messages = CLIENT_SWEEPERS.messages;
  assert.ok(messages && "lifetime" in messages);
  assert.equal(messages.lifetime, MESSAGE_SWEEP_LIFETIME_SECONDS);
  const threads = CLIENT_SWEEPERS.threads;
  assert.ok(threads && "lifetime" in threads);
  assert.equal(threads.lifetime, THREAD_SWEEP_LIFETIME_SECONDS);
});
