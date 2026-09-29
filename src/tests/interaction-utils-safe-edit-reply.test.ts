import test from "node:test";
import assert from "node:assert/strict";
import { safeEditReply } from "../functions/InteractionUtils.js";

function buildInteraction(state: { deferred: boolean; replied: boolean }): any {
  const calls: string[] = [];
  return {
    calls,
    ...state,
    user: { id: "u1" },
    editReply: async (payload: unknown) => {
      calls.push(`edit:${JSON.stringify(payload)}`);
      return { id: "m1" };
    },
    followUp: async (payload: unknown) => {
      calls.push(`follow:${JSON.stringify(payload)}`);
    },
    reply: async (payload: unknown) => {
      calls.push(`reply:${JSON.stringify(payload)}`);
    },
    isMessageComponent: () => true,
  };
}

test("safeEditReply edits the original after it was already edited once", async () => {
  const interaction = buildInteraction({ deferred: true, replied: true });

  await safeEditReply(interaction, { content: "Import failed." });

  assert.deepEqual(interaction.calls, ['edit:{"content":"Import failed."}']);
});

test("safeEditReply replies when nothing has been acknowledged yet", async () => {
  const interaction = buildInteraction({ deferred: false, replied: false });

  await safeEditReply(interaction, { content: "hello" });

  assert.equal(interaction.calls.length, 1);
  assert.match(interaction.calls[0], /^reply:/);
});

test("safeEditReply swallows acknowledgement errors", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const interaction = buildInteraction({ deferred: true, replied: true });
  interaction.editReply = async () => {
    const error: any = new Error("Unknown interaction");
    error.code = 10062;
    throw error;
  };

  await assert.doesNotReject(safeEditReply(interaction, { content: "x" }));
});

test("safeEditReply rethrows other errors", async () => {
  const interaction = buildInteraction({ deferred: true, replied: true });
  interaction.editReply = async () => {
    throw new Error("boom");
  };

  await assert.rejects(safeEditReply(interaction, { content: "x" }), /boom/);
});
