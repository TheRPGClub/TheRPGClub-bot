import test, { after, before, beforeEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import Game from "../classes/Game.js";
import GameSearchService from "../classes/GameSearchService.js";
import { igdbService } from "../services/IGDB/IgdbService.js";
import { handleIgdbSelectInteraction } from "../services/IGDB/IgdbSelectService.js";
import { persistedSessionStore } from "../services/PersistedInteractionSessionStore.js";
import {
  GIVEAWAY_GAME_NOT_FOUND_MESSAGE,
  GiveawayCommand,
} from "../commands/giveaway.command.js";
import { formatSlashCommandParams } from "../functions/SlashCommandLogUtils.js";
import { formatApiError } from "../utilities/ApiErrorUtils.js";

const OWNER = "333333333333333333";
const KEY = "SECRET-KEY-1234";
const GAME_ID = 777;
const IGDB_ID = 4242;

type CapturedRequest = { method: string; url: string; body: Record<string, any> };

// The API client caches one axios instance keyed to the first base URL it sees, so every
// test in this file shares one stub server.
const requests: CapturedRequest[] = [];
let server: Server;

async function readBody(req: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? (JSON.parse(raw) as Record<string, any>) : {};
}

before(async () => {
  server = createServer((req, res) => {
    void (async () => {
      const method = req.method ?? "";
      const url = req.url ?? "";
      const body = await readBody(req);
      requests.push({ method, url, body });
      const data = body.data ?? {};
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        data: {
          key_id: 55,
          game_title: data.game_title,
          gamedb_game_id: data.gamedb_game_id,
          platform: data.platform,
          key_value: data.key_value,
          donor_user_id: data.donor_user_id,
          claimed_by_user_id: null,
          claimed_at: null,
          created_at: "2026-11-03T00:00:00Z",
          updated_at: "2026-11-03T00:00:00Z",
        },
      }));
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  process.env.RPGCLUB_API_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.RPGCLUB_BOT_API_TOKEN = "test-token";
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  requests.length = 0;
});

function fakeClient(): { client: any; hubFetches: () => number } {
  let fetches = 0;
  const client = {
    user: { id: "bot" },
    channels: {
      fetch: async () => {
        fetches += 1;
        return null;
      },
    },
  };
  return { client, hubFetches: () => fetches };
}

function fakeInteraction(client: any, extra: Record<string, unknown> = {}): any {
  const sent: any[] = [];
  const interaction: any = {
    user: { id: OWNER },
    client,
    replied: false,
    deferred: false,
    sent,
    deferReply: async () => {
      interaction.deferred = true;
    },
    reply: async (opts: any) => {
      sent.push(opts);
      interaction.replied = true;
    },
    editReply: async (opts: any) => {
      sent.push(opts);
    },
    followUp: async (opts: any) => {
      sent.push(opts);
    },
    deferUpdate: async () => {
      interaction.deferred = true;
    },
    update: async (opts: any) => {
      sent.push(opts);
      interaction.replied = true;
    },
    isChatInputCommand: () => false,
    isMessageComponent: () => false,
    isRepliable: () => true,
    ...extra,
  };
  return interaction;
}

function modalInteraction(client: any, title: string): any {
  const values: Record<string, string> = {
    "giveaway-donate-title": title,
    "giveaway-donate-platform": "Steam",
    "giveaway-donate-key": KEY,
  };
  return fakeInteraction(client, {
    fields: { getTextInputValue: (id: string) => values[id] ?? "" },
  });
}

function stubSessionStore(t: TestContext): { saved: unknown[] } {
  const saved: unknown[] = [];
  t.mock.method(persistedSessionStore, "save", async (params: unknown) => {
    saved.push(params);
    return "row-1";
  });
  t.mock.method(persistedSessionStore, "remove", async () => {});
  return { saved };
}

function stubIgdbResults(t: TestContext, results: { id: number; name: string }[]): void {
  t.mock.method(GameSearchService, "searchGames", async () => []);
  t.mock.method(igdbService, "searchGames", async () => ({
    results: results.map((r) => ({ ...r, summary: "" })),
  }));
}

function findIgdbSelectId(sent: any[]): string {
  const match = JSON.stringify(sent).match(/"custom_id":"(igdb-select:[^"]+)"/);
  if (!match) throw new Error("no igdb-select custom id was sent");
  return match[1];
}

function keyPosts(): CapturedRequest[] {
  return requests.filter((r) => r.method === "POST" && r.url === "/api/v1/game_keys");
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

type EntryPoint = {
  name: string;
  donate: (client: any, title: string) => Promise<any>;
};

const command = new GiveawayCommand();
const entryPoints: EntryPoint[] = [
  {
    name: "/giveaway donate",
    donate: async (client, title) => {
      const interaction = fakeInteraction(client);
      await command.donateKey(title, "Steam", KEY, interaction);
      return interaction;
    },
  },
  {
    name: "the hub Donate modal",
    donate: async (client, title) => {
      const interaction = modalInteraction(client, title);
      await command.handleDonateModal(interaction);
      return interaction;
    },
  },
];

for (const entry of entryPoints) {
  test(`${entry.name}: a GameDB game donates with its gamedb_game_id`, async (t) => {
    stubSessionStore(t);
    const game = { id: GAME_ID, title: "Chrono Trigger" };
    t.mock.method(Game, "getGameById", async () => game);
    t.mock.method(GameSearchService, "searchGames", async () => [game]);
    const igdbSearch = t.mock.method(igdbService, "searchGames", async () => ({ results: [] }));
    const { client, hubFetches } = fakeClient();

    const title = entry.name === "/giveaway donate" ? String(GAME_ID) : "chrono trigger";
    const interaction = await entry.donate(client, title);
    await settle();

    const posts = keyPosts();
    assert.equal(posts.length, 1);
    assert.equal(posts[0].body.data.gamedb_game_id, GAME_ID);
    assert.equal(posts[0].body.data.game_title, "Chrono Trigger");
    assert.equal(posts[0].body.data.key_value, KEY);
    assert.equal(igdbSearch.mock.callCount(), 0);
    assert.match(JSON.stringify(interaction.sent), /Added \*\*Chrono Trigger\*\*/);
    assert.equal(hubFetches(), 1, "the hub refreshes after a donation");
  });

  test(`${entry.name}: a title missing from GameDB donates after an IGDB pick`, async (t) => {
    const { saved } = stubSessionStore(t);
    stubIgdbResults(t, [{ id: IGDB_ID, name: "Chrono Cross" }]);
    const createGame = t.mock.method(Game, "createGame", async () => ({
      id: GAME_ID + 1,
      title: "Chrono Cross",
    }));
    const { client, hubFetches } = fakeClient();

    const interaction = await entry.donate(client, "Chrono Cross Remaster");
    assert.equal(keyPosts().length, 0, "nothing is donated before the pick");
    assert.match(JSON.stringify(interaction.sent), /No exact GameDB match/);

    const select = fakeInteraction(client, {
      customId: findIgdbSelectId(interaction.sent),
      values: [String(IGDB_ID)],
      isMessageComponent: () => true,
    });
    assert.equal(await handleIgdbSelectInteraction(select), true);
    await settle();

    assert.equal(createGame.mock.calls[0].arguments[0], IGDB_ID);
    const posts = keyPosts();
    assert.equal(posts.length, 1);
    assert.equal(posts[0].body.data.gamedb_game_id, GAME_ID + 1);
    assert.equal(posts[0].body.data.game_title, "Chrono Cross");
    assert.match(JSON.stringify(select.sent), /Added \*\*Chrono Cross\*\*/);
    assert.equal(hubFetches(), 1);
    assert.equal(saved.length, 0, "the IGDB session holding the key is never persisted");
  });

  test(`${entry.name}: no GameDB or IGDB match donates nothing`, async (t) => {
    stubSessionStore(t);
    stubIgdbResults(t, []);
    const { client, hubFetches } = fakeClient();

    const interaction = await entry.donate(client, "Not A Real Game");
    await settle();

    assert.equal(keyPosts().length, 0);
    assert.ok(JSON.stringify(interaction.sent).includes(GIVEAWAY_GAME_NOT_FOUND_MESSAGE));
    assert.equal(hubFetches(), 0);
  });
}

test("the Donate modal reads a numeric title as a title, not a GameDB id", async (t) => {
  stubSessionStore(t);
  const getGameById = t.mock.method(Game, "getGameById", async () => null);
  const game = { id: GAME_ID, title: "1942" };
  t.mock.method(GameSearchService, "searchGames", async () => [game]);
  const { client } = fakeClient();

  const interaction = modalInteraction(client, "1942");
  await command.handleDonateModal(interaction);

  assert.equal(getGameById.mock.callCount(), 0);
  assert.equal(keyPosts()[0].body.data.gamedb_game_id, GAME_ID);
});

test("the command log line masks the donated key", () => {
  const line = formatSlashCommandParams("giveaway", [{
    name: "donate",
    options: [
      { name: "title", value: "777" },
      { name: "platform", value: "Steam" },
      { name: "key", value: KEY },
    ],
  }]);

  assert.ok(!line.includes(KEY));
  assert.match(line, /key=REDACTED/);
  assert.match(line, /platform="Steam"/);
});

test("an API error reply masks the donated key", () => {
  const text = formatApiError(
    "post",
    "/api/v1/game_keys",
    { data: { game_title: "Chrono Trigger", key_value: KEY } },
    422,
    { error: "game_not_found" },
  );

  assert.ok(!text.includes(KEY));
  assert.match(text, /"key_value": "REDACTED"/);
});
