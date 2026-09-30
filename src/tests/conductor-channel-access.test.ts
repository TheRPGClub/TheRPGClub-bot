import test from "node:test";
import assert from "node:assert/strict";

import { type Channel, PermissionFlagsBits, PermissionsBitField } from "discord.js";

import {
  checkConductorChannelAccess,
  formatChannelAccessProblem,
  type IChannelAccessClient,
} from "../conductor/ConductorChannelAccess.js";

const SETTINGS = { testGuildId: "500", testChannelId: "10", mirrorChannelId: "20" };
const SELF_ID = "900";

const ALL_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.SendMessages,
];

function fakeChannel(name: string, granted: bigint[], guildId = "500"): Channel {
  const channel = {
    name,
    guildId,
    isTextBased: () => true,
    isDMBased: () => false,
    permissionsFor: (userId: string) =>
      userId === SELF_ID ? new PermissionsBitField(granted) : null,
  };
  return channel as unknown as Channel;
}

function fakeClient(channels: Record<string, Channel | Error>): IChannelAccessClient {
  return {
    user: { id: SELF_ID },
    channels: {
      fetch: (channelId: string) => {
        const channel = channels[channelId];
        if (channel instanceof Error) return Promise.reject(channel);
        return Promise.resolve(channel ?? null);
      },
    },
  };
}

test("reports nothing when every channel grants what the conductor needs", async () => {
  const client = fakeClient({
    "10": fakeChannel("dev", ALL_PERMISSIONS),
    "20": fakeChannel("test-log", ALL_PERMISSIONS.slice(0, 2)),
  });
  assert.deepEqual(await checkConductorChannelAccess(client, SETTINGS), []);
});

test("names the channel when its fetch is refused with 403", async () => {
  const refused = Object.assign(new Error("Missing Access"), { status: 403 });
  const client = fakeClient({ "10": refused, "20": fakeChannel("test-log", ALL_PERMISSIONS) });
  const problems = await checkConductorChannelAccess(client, SETTINGS);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].channelName, "<#10>");
  assert.equal(problems[0].error, refused);
  assert.match(formatChannelAccessProblem(problems[0]), /Missing Access/);
  assert.match(problems[0].reason, /View Channel, Send Messages, Read Message History/);
});

test("names the channel and the permission it is missing", async () => {
  const withoutView = ALL_PERMISSIONS.filter((flag) => flag !== PermissionFlagsBits.ViewChannel);
  const client = fakeClient({
    "10": fakeChannel("dev", withoutView),
    "20": fakeChannel("test-log", ALL_PERMISSIONS),
  });
  const problems = await checkConductorChannelAccess(client, SETTINGS);
  assert.deepEqual(
    problems.map(formatChannelAccessProblem),
    ["Cannot use #dev (10): missing View Channel."],
  );
});

test("does not ask the mirror channel for Send Messages", async () => {
  const client = fakeClient({
    "10": fakeChannel("dev", ALL_PERMISSIONS),
    "20": fakeChannel("test-log", [PermissionFlagsBits.ViewChannel]),
  });
  const problems = await checkConductorChannelAccess(client, SETTINGS);
  assert.deepEqual(
    problems.map(formatChannelAccessProblem),
    ["Cannot use #test-log (20): missing Read Message History."],
  );
});

test("checks a channel shared by both settings once, with the test channel's needs", async () => {
  const shared = { ...SETTINGS, mirrorChannelId: "10" };
  const client = fakeClient({ "10": fakeChannel("dev", ALL_PERMISSIONS.slice(0, 2)) });
  const problems = await checkConductorChannelAccess(client, shared);
  assert.deepEqual(
    problems.map(formatChannelAccessProblem),
    ["Cannot use #dev (10): missing Send Messages."],
  );
});

test("flags a missing channel and one outside the test guild", async () => {
  const client = fakeClient({ "20": fakeChannel("elsewhere", ALL_PERMISSIONS, "501") });
  const problems = await checkConductorChannelAccess(client, SETTINGS);
  assert.deepEqual(problems.map(formatChannelAccessProblem), [
    "Cannot use <#10> (10): channel not found.",
    "Cannot use #elsewhere (20): not in the test guild.",
  ]);
});
