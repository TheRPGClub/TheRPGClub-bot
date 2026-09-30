import assert from "node:assert/strict";
import test from "node:test";
import { Collection, type CommandInteraction } from "discord.js";
import { IS_TEST_MODE } from "../config/testMode.js";
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

/** Puts `active` where the current mode looks (guild in test mode) and `other` opposite. */
function modeInteraction(active: unknown, other: unknown): CommandInteraction {
  return IS_TEST_MODE ? fakeInteraction(active, other) : fakeInteraction(other, active);
}

test("buildCommandMention uses a cached command id", async () => {
  const interaction = modeInteraction(
    commandManager([{ id: "111", name: "thread" }]),
    commandManager([]),
  );
  assert.equal(await buildCommandMention(interaction, "thread", "create"), "</thread create:111>");
});

test("buildCommandMention fetches only the list the current mode registers to", async () => {
  const interaction = modeInteraction(
    commandManager([], [{ id: "111", name: "thread" }]),
    commandManager([{ id: "222", name: "thread" }]),
  );
  assert.equal(await buildCommandMention(interaction, "thread", "create"), "</thread create:111>");
});

test("buildCommandMention falls back to inline code when the command is unknown", async () => {
  const failing = { cache: new Collection(), fetch: async () => { throw new Error("nope"); } };
  const interaction = modeInteraction(failing, commandManager([{ id: "222", name: "thread" }]));
  assert.equal(await buildCommandMention(interaction, "thread", "create"), "`/thread create`");
});
