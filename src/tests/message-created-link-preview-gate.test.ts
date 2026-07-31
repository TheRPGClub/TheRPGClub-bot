import assert from "node:assert/strict";
import test from "node:test";
import { decideLinkPreviewRepair } from "../events/MessageCreated.command.js";
import { BOT_DEV_PING_USER_ID, LINK_RELAY_BOT_USER_ID } from "../config/users.js";

/** Any author that is not the link relay bot exercises the human path. */
const HUMAN_USER_ID = BOT_DEV_PING_USER_ID;
const POST_URL = "https://xcancel.com/ReticentY2K/status/2082451207650488402";

test("schedules repair for a human message containing a URL", () => {
  const decision = decideLinkPreviewRepair({
    authorId: HUMAN_USER_ID,
    content: `check this out ${POST_URL}`,
  });

  assert.equal(decision.schedule, true);
  assert.equal(decision.sweepStuckReplies, false);
});

test("skips repair for a human message with no URL", () => {
  const decision = decideLinkPreviewRepair({
    authorId: HUMAN_USER_ID,
    content: "no links here, just talking about xcancel.com stuff",
  });

  assert.equal(decision.schedule, false);
  assert.equal(decision.sweepStuckReplies, false);
});

test("skips repair for an empty message body", () => {
  const decision = decideLinkPreviewRepair({ authorId: HUMAN_USER_ID, content: "" });

  assert.equal(decision.schedule, false);
  assert.equal(decision.sweepStuckReplies, false);
});

test("schedules a sweep for a link relay bot message with a URL", () => {
  const decision = decideLinkPreviewRepair({
    authorId: LINK_RELAY_BOT_USER_ID,
    content: POST_URL,
  });

  assert.equal(decision.schedule, true);
  assert.equal(decision.sweepStuckReplies, true);
});

test("schedules a sweep for a link relay bot message with no URL in its content", () => {
  const decision = decideLinkPreviewRepair({ authorId: LINK_RELAY_BOT_USER_ID, content: "" });

  assert.equal(decision.schedule, true);
  assert.equal(decision.sweepStuckReplies, true);
});
