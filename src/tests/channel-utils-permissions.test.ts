import assert from "node:assert/strict";
import test from "node:test";
import { PermissionFlagsBits, PermissionsBitField, type Client } from "discord.js";
import {
  ATTACH_FILES_PERMISSION,
  listMissingBotPermissions,
  sendPermissionFor,
  SEND_MESSAGES_PERMISSION,
  VIEW_CHANNEL_PERMISSION,
} from "../functions/ChannelUtils.js";

const REQUIRED = [VIEW_CHANNEL_PERMISSION, SEND_MESSAGES_PERMISSION, ATTACH_FILES_PERMISSION];
const loggedIn = { user: { id: "1" } } as unknown as Client;

function channelGranting(...flags: bigint[]): unknown {
  return { permissionsFor: () => new PermissionsBitField(flags) };
}

test("names each permission the bot lacks in the channel", () => {
  const channel = channelGranting(PermissionFlagsBits.ViewChannel);
  assert.deepEqual(
    listMissingBotPermissions(loggedIn, channel, REQUIRED),
    ["Send Messages", "Attach Files"],
  );
});

test("reports nothing missing when every permission is granted", () => {
  const channel = channelGranting(
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.AttachFiles,
  );
  assert.deepEqual(listMissingBotPermissions(loggedIn, channel, REQUIRED), []);
});

test("cannot tell for a DM, an uncached member, or a logged-out client", () => {
  assert.equal(listMissingBotPermissions(loggedIn, { send: async () => null }, REQUIRED), null);
  assert.equal(
    listMissingBotPermissions(loggedIn, { permissionsFor: () => null }, REQUIRED),
    null,
  );
  const loggedOut = { user: null } as unknown as Client;
  assert.equal(listMissingBotPermissions(loggedOut, channelGranting(), REQUIRED), null);
});

test("a thread post needs the thread send permission", () => {
  assert.equal(sendPermissionFor({ isThread: () => true })[1], "Send Messages in Threads");
  assert.equal(sendPermissionFor({ isThread: () => false })[1], "Send Messages");
  assert.equal(sendPermissionFor({})[1], "Send Messages");
});
