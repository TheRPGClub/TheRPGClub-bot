import assert from "node:assert/strict";
import test from "node:test";
import { Collection, type CommandInteraction } from "discord.js";
import { buildCommandMention } from "../functions/CommandMentionUtils.js";

type FakeCommand = { id: string; name: string };

function commandManager(cached: FakeCommand[], fetched: FakeCommand[] = cached): unknown {
  const toCollection = (list: FakeCommand[]) =>
    new Collection(list.map((command) => [command.id, command]));
  return {
    cache: toCollection(cached),
    fetch: async () => toCollection(fetched),
  };
}

function fakeInteraction(guild: unknown, app: unknown): CommandInteraction {
  return {
    client: { application: { commands: app } },
    guild: guild ? { commands: guild } : null,
  } as unknown as CommandInteraction;
}

test("buildCommandMention uses a cached global command id", async () => {
  const interaction = fakeInteraction(
    commandManager([]),
    commandManager([{ id: "111", name: "thread" }]),
  );
  assert.equal(await buildCommandMention(interaction, "thread", "create"), "</thread create:111>");
});

test("buildCommandMention prefers a guild command over a global one", async () => {
  const interaction = fakeInteraction(
    commandManager([], [{ id: "222", name: "thread" }]),
    commandManager([], [{ id: "111", name: "thread" }]),
  );
  assert.equal(await buildCommandMention(interaction, "thread", "create"), "</thread create:222>");
});

test("buildCommandMention falls back to inline code when the command is unknown", async () => {
  const failing = { cache: new Collection(), fetch: async () => { throw new Error("nope"); } };
  const interaction = fakeInteraction(null, failing);
  assert.equal(await buildCommandMention(interaction, "thread", "create"), "`/thread create`");
});
