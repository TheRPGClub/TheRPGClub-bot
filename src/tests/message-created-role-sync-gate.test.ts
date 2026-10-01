import assert from "node:assert/strict";
import test from "node:test";
import { shouldSyncMemberRoles } from "../events/MessageCreated.command.js";

const WEBHOOK_ID = "1100000000000000000";

test("syncs roles for a human guild member", () => {
  assert.equal(
    shouldSyncMemberRoles({ hasMember: true, authorIsBot: false, webhookId: null }),
    true,
  );
});

test("skips role sync when the message has no member", () => {
  assert.equal(
    shouldSyncMemberRoles({ hasMember: false, authorIsBot: false, webhookId: null }),
    false,
  );
});

test("skips role sync for a bot author", () => {
  assert.equal(
    shouldSyncMemberRoles({ hasMember: true, authorIsBot: true, webhookId: null }),
    false,
  );
});

test("skips role sync for a webhook message", () => {
  assert.equal(
    shouldSyncMemberRoles({ hasMember: true, authorIsBot: false, webhookId: WEBHOOK_ID }),
    false,
  );
});
