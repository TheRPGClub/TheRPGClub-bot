import test from "node:test";
import assert from "node:assert/strict";
import { sharedStateCommandRefusal } from "../functions/SharedStateCommandGuard.js";

test("sharedStateCommandRefusal lets the command run outside test mode", () => {
  assert.equal(sharedStateCommandRefusal("/superadmin memberscan", false), null);
});

test("sharedStateCommandRefusal names the refused command in test mode", () => {
  const refusal = sharedStateCommandRefusal("/superadmin memberscan", true);
  assert.ok(refusal);
  assert.match(refusal, /`\/superadmin memberscan` is disabled in test mode/);
});
