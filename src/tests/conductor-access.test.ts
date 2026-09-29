import test from "node:test";
import assert from "node:assert/strict";

import { checkConductorAccess, type IConductorActor } from "../conductor/ConductorAccess.js";
import { classifySnapshot, type IMessageSnapshot } from "../conductor/ConductorObservation.js";

const CONTEXT = { allowedUserId: "100", selfId: "900", testGuildId: "500" };

function actor(overrides: Partial<IConductorActor> = {}): IConductorActor {
  return { userId: "100", isBot: false, webhookId: null, guildId: "500", ...overrides };
}

test("allows the allowlisted user in the test guild and in a DM", () => {
  assert.deepEqual(checkConductorAccess(actor(), CONTEXT), { allowed: true });
  assert.deepEqual(checkConductorAccess(actor({ guildId: null }), CONTEXT), { allowed: true });
});

const REJECTED: [string, IConductorActor][] = [
  ["another user", actor({ userId: "101" })],
  ["another bot", actor({ userId: "102", isBot: true })],
  ["a bot claiming the allowlisted ID", actor({ isBot: true })],
  ["a webhook", actor({ userId: "103", webhookId: "w1" })],
  ["a webhook posting under the allowlisted ID", actor({ webhookId: "w1" })],
  ["the conductor itself", actor({ userId: "900", isBot: true })],
  ["the allowlisted user in another guild", actor({ guildId: "501" })],
];

for (const [name, candidate] of REJECTED) {
  test(`rejects ${name}`, () => {
    assert.equal(checkConductorAccess(candidate, CONTEXT).allowed, false);
  });
}

test("rejects everyone when the allowlist is empty", () => {
  const decision = checkConductorAccess(actor({ userId: "" }), { ...CONTEXT, allowedUserId: "" });
  assert.equal(decision.allowed, false);
});

const OBSERVE = {
  selfId: "900",
  allowedUserId: "100",
  testChannelId: "700",
  mirrorChannelId: "700",
};

function snapshot(overrides: Partial<IMessageSnapshot> = {}): IMessageSnapshot {
  return {
    id: "1",
    channelId: "700",
    authorId: "800",
    authorIsBot: true,
    webhookId: null,
    createdTimestamp: 1000,
    editedTimestamp: null,
    content: "hello",
    interactionUserId: "100",
    embeds: [],
    components: [],
    ...overrides,
  };
}

test("observation never records the conductor's own posts, humans, or webhooks", () => {
  assert.equal(classifySnapshot(snapshot({ authorId: "900" }), OBSERVE), null);
  assert.equal(classifySnapshot(snapshot({ authorIsBot: false, authorId: "100" }), OBSERVE), null);
  assert.equal(classifySnapshot(snapshot({ webhookId: "w1" }), OBSERVE), null);
});

test("observation drops replies to anyone but the allowlisted user", () => {
  assert.equal(classifySnapshot(snapshot({ interactionUserId: "101" }), OBSERVE), null);
  const mirror = "```json\n" + JSON.stringify({ kind: "reply", source: "/help", user: "101" }) +
    "\n```";
  assert.equal(classifySnapshot(snapshot({ content: mirror, interactionUserId: null }), OBSERVE),
    null);
});

test("observation ignores channels outside the test and mirror channels", () => {
  assert.equal(classifySnapshot(snapshot({ channelId: "701" }), OBSERVE), null);
});
