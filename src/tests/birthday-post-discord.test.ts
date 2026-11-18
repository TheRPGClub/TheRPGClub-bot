import assert from "node:assert/strict";
import test from "node:test";
import {
  Collection,
  DiscordAPIError,
  PermissionFlagsBits,
  PermissionsBitField,
  RESTJSONErrorCodes,
  type Client,
} from "discord.js";
import { DateTime } from "luxon";
import { BIRTHDAY_TIME_ZONE } from "../config/birthdays.js";
import { BOT_DEV_CHANNEL_ID } from "../config/channels.js";
import { createBirthdayPostDeps } from "../services/BirthdayPost.js";
import type { IUpcomingBirthday } from "../services/UpcomingBirthdaysService.js";

// The Birthday Post's live Discord adapter (spec api#396, bot#1559): what it sends, and how
// the redelivery guard reads the channel back. Driven with a fake client and channel.

const BOT_ID = "900";
const GENERAL = "191941851757019136";
const TODAY = "2026-11-18";

interface IFakeMessage {
  id: string;
  author: { id: string };
  content: string;
  createdTimestamp: number;
  attachments: Collection<string, { name: string }>;
}

/** A message `minutes` after the club day's New York midnight (negative: the day before). */
function message(
  id: string,
  minutes: number,
  options: { author?: string; content?: string; file?: string } = {},
): IFakeMessage {
  const attachments = new Collection<string, { name: string }>();
  if (options.file) attachments.set(`${id}-file`, { name: options.file });
  return {
    id,
    author: { id: options.author ?? BOT_ID },
    content: options.content ?? "",
    createdTimestamp:
      DateTime.fromISO(TODAY, { zone: BIRTHDAY_TIME_ZONE }).plus({ minutes }).toMillis(),
    attachments,
  };
}

interface IFakeChannel {
  sent: unknown[];
  fetches: { limit: number; before?: string }[];
}

function fakeClient(options: {
  pages?: IFakeMessage[][];
  permissions?: bigint[];
  sendable?: boolean;
  sendError?: Error;
} = {}): { client: Client; channels: Map<string, IFakeChannel> } {
  const channels = new Map<string, IFakeChannel>();
  const pages = [...(options.pages ?? [])];
  const channelFor = (id: string): unknown => {
    const state = channels.get(id) ?? { sent: [], fetches: [] };
    channels.set(id, state);
    return {
      id,
      isSendable: () => options.sendable ?? true,
      isTextBased: () => true,
      isDMBased: () => false,
      permissionsFor: () => new PermissionsBitField(options.permissions ?? [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
      ]),
      send: async (sent: unknown) => {
        if (options.sendError) throw options.sendError;
        state.sent.push(sent);
      },
      messages: {
        fetch: async (query: { limit: number; before?: string }) => {
          state.fetches.push(query);
          const page = pages.shift() ?? [];
          return new Collection(page.map((m) => [m.id, m]));
        },
      },
    };
  };
  const client = {
    user: { id: BOT_ID },
    channels: { fetch: async (id: string) => channelFor(id) },
    guilds: {
      fetch: async () => ({
        members: {
          fetch: async (userId: string) => {
            if (userId === "404") {
              throw new DiscordAPIError(
                { code: RESTJSONErrorCodes.UnknownMember, message: "Unknown Member" },
                RESTJSONErrorCodes.UnknownMember,
                404,
                "GET",
                `https://discord.com/api/v10/guilds/1/members/${userId}`,
                { body: undefined, files: undefined },
              );
            }
            return {
              displayName: `Member ${userId}`,
              displayAvatarURL: () => `https://cdn.example/${userId}.png`,
            };
          },
        },
      }),
    },
  } as unknown as Client;
  return { client, channels };
}

test("postMessage: sends the text and banner, pinging only the members greeted", async () => {
  const { client, channels } = fakeClient();
  const deps = createBirthdayPostDeps(client);
  const banner = Buffer.from([1, 2, 3]);

  await deps.postMessage(GENERAL, {
    content: "## 🎂 Happy Birthday, <@101> and <@102>!",
    pingUserIds: ["101", "102"],
    files: [{ name: "happy-birthday-2026-11-18.png", data: banner, description: "Banner" }],
  });

  assert.deepEqual(channels.get(GENERAL)?.sent, [{
    content: "## 🎂 Happy Birthday, <@101> and <@102>!",
    files: [{ attachment: banner, name: "happy-birthday-2026-11-18.png", description: "Banner" }],
    allowedMentions: { users: ["101", "102"] },
  }]);
});

test("postMessage: a channel the bot can't post in throws", async () => {
  const { client } = fakeClient({ sendable: false });
  const deps = createBirthdayPostDeps(client);

  await assert.rejects(
    deps.postMessage(GENERAL, { content: "x", pingUserIds: [], files: [] }),
    /cannot post in it/,
  );
});

test("greetedOn: pages back to the club day's midnight, counting only the bot's own " +
  "posts with that day's banner", async () => {
  const fileName = "happy-birthday-2026-11-18.png";
  const firstPage = Array.from({ length: 100 }, (_, i) => message(`m${i}`, 600 - i));
  firstPage[3] = message("ours", 597, { content: "Happy Birthday, <@101> and <@102>!",
    file: fileName });
  firstPage[5] = message("yesterday", 595, { content: "<@103>",
    file: "happy-birthday-2026-11-17.png" });
  firstPage[7] = message("member", 593, { author: "777", content: "<@104>", file: fileName });
  const secondPage = [
    message("ours-earlier", 10, { content: "Happy Birthday, <@105>!", file: fileName }),
    ...Array.from({ length: 99 }, (_, i) => message(`old${i}`, -1 - i)),
  ];
  const { client, channels } = fakeClient({ pages: [firstPage, secondPage, []] });
  const deps = createBirthdayPostDeps(client);

  const greeted = await deps.greetedOn(GENERAL, TODAY);

  assert.deepEqual([...greeted].toSorted(), ["101", "102", "105"]);
  assert.deepEqual(channels.get(GENERAL)?.fetches, [
    { limit: 100 },
    { limit: 100, before: "m99" },
  ]);
});

test("greetedOn: without Read Message History it throws naming it, instead of reading " +
  "Discord's empty answer as nobody greeted", async () => {
  const { client, channels } = fakeClient({ permissions: [PermissionFlagsBits.ViewChannel] });
  const deps = createBirthdayPostDeps(client);

  await assert.rejects(deps.greetedOn(GENERAL, TODAY),
    /The bot lacks Read Message History in <#191941851757019136>\./);
  assert.deepEqual(channels.get(GENERAL)?.fetches, []);
});

test("sharingOn: the members whose shared Birthday falls on the club day", async () => {
  const entry = (userId: string, on: string): IUpcomingBirthday =>
    ({ userId, displayName: userId, month: 11, day: 18, on, today: on === TODAY });
  const { client } = fakeClient();
  const deps = createBirthdayPostDeps(client, {
    api: {
      listUpcoming: async () => ({
        birthdays: [entry("101", TODAY), entry("102", "2026-11-19"), entry("103", TODAY)],
        next: null,
      }),
    },
  });

  assert.deepEqual([...await deps.sharingOn(TODAY)].toSorted(), ["101", "103"]);
});

test("fetchMember: names and avatar from the server; a member who left is null", async () => {
  const { client } = fakeClient();
  const avatar = Buffer.from([9]);
  const urls: string[] = [];
  const deps = createBirthdayPostDeps(client, {
    fetchImage: async (url) => {
      urls.push(url);
      return avatar;
    },
  });

  assert.deepEqual(await deps.fetchMember("101"),
    { userId: "101", name: "Member 101", avatar });
  assert.deepEqual(urls, ["https://cdn.example/101.png"]);
  assert.equal(await deps.fetchMember("404"), null);
});

test("warnStaff: posts in the bot-dev channel without pinging anyone", async () => {
  const { client, channels } = fakeClient();
  const deps = createBirthdayPostDeps(client);

  await deps.warnStaff("The Birthday Post could not read <@&1> history.");

  assert.deepEqual(channels.get(BOT_DEV_CHANNEL_ID)?.sent, [{
    content: "The Birthday Post could not read <@&1> history.",
    allowedMentions: { parse: [] },
  }]);
});

test("warnStaff: a failed warning is logged, never thrown", async (t) => {
  const logged = t.mock.method(console, "error", () => undefined);
  const { client } = fakeClient({ sendError: new Error("Missing Access") });
  const deps = createBirthdayPostDeps(client);

  await deps.warnStaff("Warning");

  assert.ok(logged.mock.callCount() > 0);
});
