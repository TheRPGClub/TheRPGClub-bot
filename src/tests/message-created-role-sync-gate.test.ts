import assert from "node:assert/strict";
import test from "node:test";
import { shouldSyncMemberRoles } from "../events/MessageCreated.command.js";

const WEBHOOK_ID = "1100000000000000000";

test("syncs roles for a human member's own post", () => {
  assert.equal(
    shouldSyncMemberRoles({ authorIsBot: false, isSystem: false, webhookId: null }),
    true,
  );
});

test("skips role sync for a bot author", () => {
  assert.equal(
    shouldSyncMemberRoles({ authorIsBot: true, isSystem: false, webhookId: null }),
    false,
  );
});

test("skips role sync for a system message such as the join notice", () => {
  assert.equal(
    shouldSyncMemberRoles({ authorIsBot: false, isSystem: true, webhookId: null }),
    false,
  );
});

test("skips role sync for a webhook message", () => {
  assert.equal(
    shouldSyncMemberRoles({ authorIsBot: false, isSystem: false, webhookId: WEBHOOK_ID }),
    false,
  );
});
