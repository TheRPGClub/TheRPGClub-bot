import test from "node:test";
import assert from "node:assert/strict";
import { AxiosError } from "axios";
import {
  describeInteraction,
  handleInteractionError,
} from "../functions/InteractionErrorHandler.js";
import { buildAnyErrorMessage } from "../utilities/ApiErrorUtils.js";

function buildInteraction(state: { deferred: boolean; replied: boolean }): any {
  const calls: string[] = [];
  return {
    calls,
    ...state,
    customId: "backlog:edit:42",
    user: { id: "u1" },
    isRepliable: () => true,
    isAutocomplete: () => false,
    isChatInputCommand: () => false,
    isCommand: () => false,
    isMessageComponent: () => true,
    editReply: async (payload: unknown) => {
      calls.push(`edit:${JSON.stringify(payload)}`);
    },
    followUp: async (payload: unknown) => {
      calls.push(`follow:${JSON.stringify(payload)}`);
    },
    reply: async (payload: unknown) => {
      calls.push(`reply:${JSON.stringify(payload)}`);
    },
  };
}

test("describeInteraction names a slash command by its full path", () => {
  const interaction: any = {
    commandName: "backlog",
    isAutocomplete: () => false,
    isChatInputCommand: () => true,
    options: {
      getSubcommandGroup: () => null,
      getSubcommand: () => "add",
    },
  };
  assert.equal(describeInteraction(interaction), "/backlog add");
});

test("describeInteraction names a component by its custom ID", () => {
  assert.equal(describeInteraction(buildInteraction({ deferred: false, replied: false })),
    "backlog:edit:42");
});

test("handleInteractionError replies when nothing was acknowledged", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const interaction = buildInteraction({ deferred: false, replied: false });

  await handleInteractionError(interaction, new Error("boom"));

  assert.equal(interaction.calls.length, 1);
  assert.match(interaction.calls[0], /^reply:.*boom/);
});

test("handleInteractionError follows up on a deferred interaction", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const interaction = buildInteraction({ deferred: true, replied: false });

  await handleInteractionError(interaction, new Error("boom"));

  assert.equal(interaction.calls.length, 1);
  assert.match(interaction.calls[0], /^follow:.*boom/);
});

test("handleInteractionError stays quiet once the user has a reply", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const interaction = buildInteraction({ deferred: true, replied: true });

  await handleInteractionError(interaction, new Error("boom"));

  assert.deepEqual(interaction.calls, []);
});

test("handleInteractionError swallows a failed error reply", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const interaction = buildInteraction({ deferred: false, replied: false });
  interaction.reply = async () => {
    throw new Error("reply failed");
  };

  await assert.doesNotReject(handleInteractionError(interaction, new Error("boom")));
});

test("buildAnyErrorMessage shows request and response for an axios error", () => {
  const err = new AxiosError("Request failed", "ERR_BAD_REQUEST", {
    method: "get",
    url: "/api/v1/games",
  } as any);
  assert.match(buildAnyErrorMessage("Failed", err), /Request:\n```json/);
});

test("buildAnyErrorMessage shows request and response for a discord.js REST error", () => {
  const err = Object.assign(new Error("Missing Access"), {
    method: "POST",
    url: "https://discord.com/api/v10/channels/1/messages",
    status: 403,
    rawError: { code: 50001 },
  });
  const message: string = buildAnyErrorMessage("Failed", err);
  assert.match(message, /"status": 403/);
  assert.match(message, /"url": "https:\/\/discord.com/);
});
