import assert from "node:assert/strict";
import test from "node:test";
import type { ArgsOf, Client } from "discordx";
import type { MessageReaction } from "discord.js";
import { MessageReactionAdd } from "../events/MessageReactionAdd.command.js";
import { StarboardHandler } from "../events/Starboard.command.js";
import { resolveReactionMessage } from "../utilities/ReactionFetchUtils.js";

// Discord allows 5 single-message GETs per channel bucket. Before #1292 each reaction event on
// an uncached message cost up to 4 of them; now the listeners of one event share one.
const MAX_FETCHES_PER_EVENT = 1;
const BURST_SIZE = 10;

type FetchCounter = { message: number; reaction: number };

// discord.js patches the cached partial in place, so later events see a full message.
function buildUncachedMessage(counter: FetchCounter, emojiName: string, count: number) {
  const message: Record<string, unknown> = {
    id: "msg-1",
    partial: true,
    async fetch() {
      counter.message += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return Object.assign(message, {
        partial: false,
        guild: { ownerId: "owner" },
        channelId: "chan-1",
        pinned: true,
        author: { id: "author", bot: true },
        reactions: { cache: new Map([[emojiName, { count, emoji: { name: emojiName } }]]) },
      });
    },
  };
  return message;
}

function buildPartialReaction(
  counter: FetchCounter,
  message: ReturnType<typeof buildUncachedMessage>,
  emojiName: string,
) {
  return {
    partial: true,
    count: null,
    emoji: { id: null, name: emojiName },
    message,
    async fetch() {
      counter.reaction += 1;
      await (message.fetch as () => Promise<unknown>)();
      return this;
    },
  };
}

function dispatchEvent(
  message: ReturnType<typeof buildUncachedMessage>,
  counter: FetchCounter,
  emojiName: string,
  userId: string,
): Promise<void[]> {
  const reaction = buildPartialReaction(counter, message, emojiName);
  const user = { id: userId, bot: false };
  const args = [reaction, user] as unknown as ArgsOf<"messageReactionAdd">;
  const client = {} as Client;
  return Promise.all([
    new StarboardHandler().messageReactionAdd(args, client),
    new MessageReactionAdd().messageReactionAdd(args, client),
  ]);
}

async function dispatchBurst(emojiName: string): Promise<FetchCounter> {
  const counter: FetchCounter = { message: 0, reaction: 0 };
  const message = buildUncachedMessage(counter, emojiName, 3);
  const events: Promise<void[]>[] = [];
  for (let index = 0; index < BURST_SIZE; index += 1) {
    events.push(dispatchEvent(message, counter, emojiName, `user-${index}`));
  }
  await Promise.all(events);
  return counter;
}

test("a burst of unrelated reactions on an uncached message fetches nothing", async () => {
  const counter = await dispatchBurst("👍");
  assert.deepEqual(counter, { message: 0, reaction: 0 });
});

test("both reaction listeners of one star event share one fetch", async () => {
  const counter: FetchCounter = { message: 0, reaction: 0 };
  const message = buildUncachedMessage(counter, "⭐", 3);
  await dispatchEvent(message, counter, "⭐", "user-1");
  assert.deepEqual(counter, { message: MAX_FETCHES_PER_EVENT, reaction: 0 });
});

test("a concurrent burst of star or pin reactions fetches at most once per event", async () => {
  for (const emojiName of ["⭐", "📌"]) {
    const counter = await dispatchBurst(emojiName);
    assert.ok(
      counter.message <= BURST_SIZE * MAX_FETCHES_PER_EVENT,
      `${emojiName}: expected at most ${BURST_SIZE} fetches, saw ${counter.message}`,
    );
    assert.equal(counter.reaction, 0);
  }
});

test("star reactions after the first fetch read the cached message", async () => {
  const counter: FetchCounter = { message: 0, reaction: 0 };
  const message = buildUncachedMessage(counter, "⭐", 3);
  for (let index = 0; index < BURST_SIZE; index += 1) {
    await dispatchEvent(message, counter, "⭐", `user-${index}`);
  }
  assert.deepEqual(counter, { message: MAX_FETCHES_PER_EVENT, reaction: 0 });
});

test("resolveReactionMessage reads a partial reaction back from the fetch", async () => {
  const counter: FetchCounter = { message: 0, reaction: 0 };
  const message = buildUncachedMessage(counter, "⭐", 4);
  const reaction = buildPartialReaction(counter, message, "⭐");

  const resolved = await resolveReactionMessage(
    reaction as unknown as MessageReaction,
    "user-1",
  );

  assert.equal(resolved?.reaction.count, 4);
  assert.equal(resolved?.message.id, "msg-1");
  assert.deepEqual(counter, { message: 1, reaction: 0 });
});

test("resolveReactionMessage never hands one user's fetch to another user", async () => {
  const counter: FetchCounter = { message: 0, reaction: 0 };
  const message = buildUncachedMessage(counter, "⭐", 1);
  const first = buildPartialReaction(counter, message, "⭐") as unknown as MessageReaction;
  const second = buildPartialReaction(counter, message, "⭐") as unknown as MessageReaction;

  await Promise.all([
    resolveReactionMessage(first, "user-1"),
    resolveReactionMessage(second, "user-2"),
  ]);

  assert.equal(counter.message, 2);
});
