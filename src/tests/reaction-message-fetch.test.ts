import assert from "node:assert/strict";
import test from "node:test";
import type { ArgsOf, Client } from "discordx";
import type { MessageReaction } from "discord.js";
import { MessageReactionAdd } from "../events/MessageReactionAdd.command.js";
import { StarboardHandler } from "../events/Starboard.command.js";
import { resolveReactionMessage } from "../utilities/ReactionFetchUtils.js";

// Discord allows 5 single-message GETs per channel bucket; one burst must stay far below it.
const MAX_FETCHES_PER_BURST = 1;
const BURST_SIZE = 10;

type FetchCounter = { message: number; reaction: number };

function buildUncachedMessage(counter: FetchCounter, emojiName: string, count: number) {
  const fetched = {
    id: "msg-1",
    partial: false,
    guild: { ownerId: "owner" },
    channelId: "chan-1",
    pinned: true,
    author: { id: "author", bot: true },
    reactions: { cache: new Map([[emojiName, { count, emoji: { name: emojiName } }]]) },
  };
  const partial = {
    id: "msg-1",
    partial: true,
    async fetch() {
      counter.message += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return fetched;
    },
  };
  return partial;
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
      await message.fetch();
      return this;
    },
  };
}

async function dispatchBurst(emojiName: string): Promise<FetchCounter> {
  const counter: FetchCounter = { message: 0, reaction: 0 };
  const message = buildUncachedMessage(counter, emojiName, 3);
  const starboard = new StarboardHandler();
  const reactionAdd = new MessageReactionAdd();
  const client = {} as Client;

  const events: Promise<void>[] = [];
  for (let index = 0; index < BURST_SIZE; index += 1) {
    const reaction = buildPartialReaction(counter, message, emojiName);
    const user = { id: `user-${index}`, bot: false };
    const args = [reaction, user] as unknown as ArgsOf<"messageReactionAdd">;
    events.push(starboard.messageReactionAdd(args, client));
    events.push(reactionAdd.messageReactionAdd(args, client));
  }
  await Promise.all(events);
  return counter;
}

test("a burst of unrelated reactions on an uncached message fetches nothing", async () => {
  const counter = await dispatchBurst("👍");
  assert.deepEqual(counter, { message: 0, reaction: 0 });
});

test("a burst of star reactions on an uncached message shares one fetch", async () => {
  const counter = await dispatchBurst("⭐");
  assert.ok(
    counter.message <= MAX_FETCHES_PER_BURST,
    `expected at most ${MAX_FETCHES_PER_BURST} fetch, saw ${counter.message}`,
  );
  assert.equal(counter.reaction, 0);
});

test("a burst of pin reactions on an uncached message shares one fetch", async () => {
  const counter = await dispatchBurst("📌");
  assert.ok(counter.message <= MAX_FETCHES_PER_BURST);
  assert.equal(counter.reaction, 0);
});

test("resolveReactionMessage reads a partial reaction back from the fetch", async () => {
  const counter: FetchCounter = { message: 0, reaction: 0 };
  const message = buildUncachedMessage(counter, "⭐", 4);
  const reaction = buildPartialReaction(counter, message, "⭐");

  const resolved = await resolveReactionMessage(reaction as unknown as MessageReaction);

  assert.equal(resolved?.reaction.count, 4);
  assert.equal(resolved?.message.id, "msg-1");
  assert.deepEqual(counter, { message: 1, reaction: 0 });
});

test("resolveReactionMessage fetches again once the earlier fetch settles", async () => {
  const counter: FetchCounter = { message: 0, reaction: 0 };
  const message = buildUncachedMessage(counter, "⭐", 1);
  const reaction = buildPartialReaction(counter, message, "⭐") as unknown as MessageReaction;

  await resolveReactionMessage(reaction);
  await resolveReactionMessage(reaction);

  assert.equal(counter.message, 2);
});
