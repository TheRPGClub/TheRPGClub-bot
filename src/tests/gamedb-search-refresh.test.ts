import assert from "node:assert/strict";
import test from "node:test";
import { MessageFlags } from "discord.js";
import GameSearchService from "../classes/GameSearchService.js";
import { GameDbSearchCommand } from "../commands/gamedb/gamedb-search.command.js";
import { encodeBase64Url } from "../functions/CustomIdUtils.js";

const OWNER = "333333333333333333";

function fakeRefreshClick(): any {
  const calls: Array<{ method: string; opts?: any }> = [];
  const interaction: any = {
    customId: `gamedb-search-refresh:${OWNER}:${encodeBase64Url("chrono")}:`,
    channelId: "999999999999999999",
    user: { id: OWNER },
    replied: false,
    deferred: false,
    calls,
    deferUpdate: async () => {
      calls.push({ method: "deferUpdate" });
      interaction.deferred = true;
    },
    reply: async (opts: any) => {
      calls.push({ method: "reply", opts });
      interaction.replied = true;
    },
    update: async (opts: any) => {
      calls.push({ method: "update", opts });
      interaction.replied = true;
    },
    editReply: async (opts: any) => {
      calls.push({ method: "editReply", opts });
    },
    followUp: async (opts: any) => {
      calls.push({ method: "followUp", opts });
    },
    isMessageComponent: () => true,
    isModalSubmit: () => false,
    isRepliable: () => true,
  };
  return interaction;
}

test("refresh acknowledges the click before running the search", async (t) => {
  const interaction = fakeRefreshClick();
  let deferredAtSearch: boolean | undefined;
  t.mock.method(GameSearchService, "searchGames", async () => {
    deferredAtSearch = interaction.deferred;
    return [{ id: 1, title: "Chrono Trigger" }];
  });

  await new GameDbSearchCommand().handleSearchRefresh(interaction);

  assert.equal(deferredAtSearch, true, "deferUpdate ran before the API search");
  assert.deepEqual(
    interaction.calls.map((c: any) => c.method),
    ["deferUpdate", "editReply"],
    "the refreshed results edit the original message",
  );
});

test("refresh with no results follows up ephemerally without editing the message", async (t) => {
  const interaction = fakeRefreshClick();
  t.mock.method(GameSearchService, "searchGames", async () => []);

  await new GameDbSearchCommand().handleSearchRefresh(interaction);

  const methods = interaction.calls.map((c: any) => c.method);
  assert.deepEqual(methods, ["deferUpdate", "followUp"]);
  const flags = Number(interaction.calls[1].opts.flags ?? 0);
  assert.ok(flags & MessageFlags.Ephemeral, "no-results notice is ephemeral");
});
