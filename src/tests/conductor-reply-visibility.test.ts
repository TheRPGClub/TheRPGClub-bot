import test from "node:test";
import assert from "node:assert/strict";
import { MessageFlags } from "discord.js";

import {
  CONDUCT_DEFER_OPTIONS,
  buildDenialReply,
  buildStatusEdit,
} from "../conductor/ConductorMessages.js";

function isEphemeral(flags: unknown): boolean {
  return typeof flags === "number" && (flags & MessageFlags.Ephemeral) !== 0;
}

test("an allowed /conduct defers without the Ephemeral flag", () => {
  assert.equal(isEphemeral(CONDUCT_DEFER_OPTIONS.flags), false);
});

const STATUS_REPLIES: [string, string][] = [
  ["PR read failure", "Could not read PR #1272"],
  ["PR not open", "PR #1272 is closed, not open."],
  ["no Testing steps", "PR #1272 has no Testing steps, so there is nothing to run."],
  ["malformed plan", "Cannot parse the Testing section of PR #1272: bad step"],
  ["run start", "Posted step 1 of 3 for PR #1272 in this channel."],
];

for (const [name, content] of STATUS_REPLIES) {
  test(`the ${name} status reply carries no Ephemeral flag`, () => {
    assert.equal(isEphemeral(buildStatusEdit(content).flags), false);
  });
}

test("a denied invocation still replies ephemerally", () => {
  assert.equal(isEphemeral(buildDenialReply().flags), true);
});
