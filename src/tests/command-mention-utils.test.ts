import test from "node:test";
import assert from "node:assert/strict";
import { Collection, type CommandInteraction } from "discord.js";
import { buildCommandMention } from "../functions/CommandMentionUtils.js";

const GLOBAL_ID = "111";
const GUILD_ID = "222";

type FakeCommand = { id: string; name: string };

function fakeManager(commands: FakeCommand[], cached: boolean): {
  cache: Collection<string, FakeCommand>;
  fetch: () => Promise<Collection<string, FakeCommand>>;
} {
  const all = new Collection(commands.map((command) => [command.id, command]));
  return {
    cache: cached ? all : new Collection(),
    fetch: async () => all,
  };
}

function fakeInteraction(options: {
  guildScoped: boolean;
  cached?: boolean;
  failFetch?: boolean;
}): CommandInteraction {
  const cached = options.cached ?? false;
  const globalManager = fakeManager([{ id: GLOBAL_ID, name: "giveaway" }], cached);
  const guildManager = fakeManager([{ id: GUILD_ID, name: "giveaway" }], cached);
  if (options.failFetch) {
    globalManager.fetch = async () => {
      throw new Error("Missing Access");
    };
  }
  return {
    commandGuildId: options.guildScoped ? "guild-1" : null,
    guild: { commands: guildManager },
    client: { application: { commands: globalManager } },
  } as unknown as CommandInteraction;
}

test("mentions a global subcommand by its fetched id", async () => {
  const mention = await buildCommandMention(
    fakeInteraction({ guildScoped: false }), "giveaway", "hub");
  assert.equal(mention, `</giveaway hub:${GLOBAL_ID}>`);
});

test("uses the guild registration when the invoking command is guild scoped", async () => {
  const mention = await buildCommandMention(
    fakeInteraction({ guildScoped: true, cached: true }), "giveaway", "hub");
  assert.equal(mention, `</giveaway hub:${GUILD_ID}>`);
});

test("mentions a top-level command without a subcommand", async () => {
  const mention = await buildCommandMention(
    fakeInteraction({ guildScoped: false, cached: true }), "giveaway");
  assert.equal(mention, `</giveaway:${GLOBAL_ID}>`);
});

test("falls back to inline code when the command is not registered", async () => {
  const mention = await buildCommandMention(
    fakeInteraction({ guildScoped: false }), "missing", "hub");
  assert.equal(mention, "`/missing hub`");
});

test("falls back to inline code when fetching commands fails", async () => {
  const mention = await buildCommandMention(
    fakeInteraction({ guildScoped: false, failFetch: true }), "giveaway", "hub");
  assert.equal(mention, "`/giveaway hub`");
});
