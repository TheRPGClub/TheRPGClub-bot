import test from "node:test";
import assert from "node:assert/strict";
import { Collection, type CommandInteraction } from "discord.js";
import { buildCommandMention } from "../functions/CommandMentionUtils.js";

const GLOBAL_ID = "111";
const GUILD_ID = "222";
const GUILD = "guild-1";

type FakeCommand = { id: string; name: string };

function toCollection(commands: FakeCommand[]): Collection<string, FakeCommand> {
  return new Collection(commands.map((command) => [command.id, command]));
}

function fakeInteraction(options: {
  guildScoped: boolean;
  failFetch?: boolean;
  guildCommands?: FakeCommand[];
}): CommandInteraction {
  const fetch = async (
    fetchOptions: { guildId?: string },
  ): Promise<Collection<string, FakeCommand>> => {
    if (options.failFetch) throw new Error("Missing Access");
    return fetchOptions.guildId === GUILD
      ? toCollection(options.guildCommands ?? [{ id: GUILD_ID, name: "giveaway" }])
      : toCollection([{ id: GLOBAL_ID, name: "giveaway" }]);
  };
  return {
    commandGuildId: options.guildScoped ? GUILD : null,
    client: { application: { commands: { fetch } } },
  } as unknown as CommandInteraction;
}

test("mentions a global subcommand by its fetched id", async () => {
  const mention = await buildCommandMention(
    fakeInteraction({ guildScoped: false }), "giveaway", "hub");
  assert.equal(mention, `</giveaway hub:${GLOBAL_ID}>`);
});

test("uses the guild registration when the invoking command is guild scoped", async () => {
  const mention = await buildCommandMention(
    fakeInteraction({ guildScoped: true }), "giveaway", "hub");
  assert.equal(mention, `</giveaway hub:${GUILD_ID}>`);
});

test("mentions a top-level command without a subcommand", async () => {
  const mention = await buildCommandMention(fakeInteraction({ guildScoped: false }), "giveaway");
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

test("falls back to the global registration when the guild lacks the command", async () => {
  const mention = await buildCommandMention(
    fakeInteraction({ guildScoped: true, guildCommands: [] }), "giveaway", "hub");
  assert.equal(mention, `</giveaway hub:${GLOBAL_ID}>`);
});
