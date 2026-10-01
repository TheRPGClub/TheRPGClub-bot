import test from "node:test";
import assert from "node:assert/strict";
import type { AutocompleteInteraction } from "discord.js";

import { safeRespond } from "../functions/InteractionUtils.js";

const ACK_ERROR = Object.assign(new Error("Interaction has already been acknowledged."), {
  code: 40060,
});
const UNKNOWN_INTERACTION = Object.assign(new Error("Unknown interaction"), { code: 10062 });
const MISSING_ACCESS = Object.assign(new Error("Missing Access"), { code: 50001 });

function buildAutocomplete(
  respondError?: Error,
): { interaction: AutocompleteInteraction; sent: unknown[] } {
  const sent: unknown[] = [];
  const interaction = {
    commandName: "hltb",
    respond: (choices: unknown) => {
      sent.push(choices);
      return respondError ? Promise.reject(respondError) : Promise.resolve();
    },
  } as unknown as AutocompleteInteraction;
  return { interaction, sent };
}

async function countLoggedErrors(run: () => Promise<void>): Promise<number> {
  const original = console.error;
  let logged = 0;
  console.error = () => {
    logged += 1;
  };
  try {
    await run();
    return logged;
  } finally {
    console.error = original;
  }
}

test("safeRespond passes the choices through to respond", async () => {
  const { interaction, sent } = buildAutocomplete();
  const choices = [{ name: "Chrono Trigger", value: "1" }];
  await safeRespond(interaction, choices);
  assert.deepEqual(sent, [choices]);
});

test("safeRespond ignores an expired interaction without logging", async () => {
  const { interaction } = buildAutocomplete(UNKNOWN_INTERACTION);
  assert.equal(await countLoggedErrors(() => safeRespond(interaction, [])), 0);
});

test("safeRespond ignores an already acknowledged interaction without logging", async () => {
  const { interaction } = buildAutocomplete(ACK_ERROR);
  assert.equal(await countLoggedErrors(() => safeRespond(interaction, [])), 0);
});

test("safeRespond logs other failures instead of throwing", async () => {
  const { interaction } = buildAutocomplete(MISSING_ACCESS);
  assert.equal(await countLoggedErrors(() => safeRespond(interaction, [])), 1);
});
