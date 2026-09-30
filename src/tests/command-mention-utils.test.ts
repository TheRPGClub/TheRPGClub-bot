import test from "node:test";
import assert from "node:assert/strict";
import { Collection, type CommandInteraction } from "discord.js";

import { resolveCommandMention } from "../functions/CommandMentionUtils.js";

const GLOBAL_GOTM_ID = "123456789012345678";
const GUILD_GOTM_ID = "223456789012345678";

type FakeCommand = { id: string; name: string };

function toCollection(commands: FakeCommand[]): Collection<string, FakeCommand> {
  return new Collection(commands.map((command) => [command.id, command]));
}

function fakeManager(cached: FakeCommand[], fetched: FakeCommand[] = cached) {
  const manager = {
    cache: toCollection(cached),
    fetchCount: 0,
    fetch: async () => {
      manager.fetchCount += 1;
      return toCollection(fetched);
    },
  };
  return manager;
}

function fakeInteraction(
  app: ReturnType<typeof fakeManager>,
  guild?: ReturnType<typeof fakeManager>,
): CommandInteraction {
  return {
    client: { application: { commands: app } },
    guild: guild ? { commands: guild } : null,
  } as unknown as CommandInteraction;
}

test("resolveCommandMention builds a subcommand mention from the global cache", async () => {
  const app = fakeManager([{ id: GLOBAL_GOTM_ID, name: "gotm" }]);
  const mention = await resolveCommandMention(fakeInteraction(app), "gotm nominate");
  assert.equal(mention, `</gotm nominate:${GLOBAL_GOTM_ID}>`);
  assert.equal(app.fetchCount, 0);
});

test("resolveCommandMention prefers the guild registration", async () => {
  const app = fakeManager([{ id: GLOBAL_GOTM_ID, name: "gotm" }]);
  const guild = fakeManager([{ id: GUILD_GOTM_ID, name: "gotm" }]);
  const mention = await resolveCommandMention(fakeInteraction(app, guild), "gotm vote");
  assert.equal(mention, `</gotm vote:${GUILD_GOTM_ID}>`);
});

test("resolveCommandMention fetches on a cache miss", async () => {
  const app = fakeManager([], [{ id: GLOBAL_GOTM_ID, name: "admin" }]);
  const guild = fakeManager([], []);
  const mention = await resolveCommandMention(
    fakeInteraction(app, guild),
    "admin generate-vote-image",
  );
  assert.equal(mention, `</admin generate-vote-image:${GLOBAL_GOTM_ID}>`);
  assert.equal(guild.fetchCount, 1);
  assert.equal(app.fetchCount, 1);
});

test("resolveCommandMention falls back to inline code when the command is unknown", async () => {
  const app = fakeManager([], []);
  const mention = await resolveCommandMention(fakeInteraction(app), "gotm history");
  assert.equal(mention, "`/gotm history`");
});
