import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import Member from "../classes/Member.js";
import UserGameBacklog from "../classes/UserGameBacklog.js";
import { buildBacklogListResponse } from "../commands/backlog/backlog-list.service.js";

type CapturedRequest = {
  method: string;
  url: string;
  body: Record<string, unknown>;
};

const BACKLOG_ROWS = [
  { entry_id: 11, user_id: "123", gamedb_game_id: 7, platform_id: 4, note: "from backlog" },
  { entry_id: 12, user_id: "123", gamedb_game_id: 8, platform_id: 4, note: null },
];

// The API client caches a single axios instance keyed to the base URL it saw
// first, so every test in this file shares one stub server.
const requests: CapturedRequest[] = [];
let server: Server;

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function respond(method: string, url: string): unknown {
  if (method === "GET" && url.startsWith("/api/v1/users/123/now_playing")) return { data: [] };
  if (method === "GET" && url.startsWith("/api/v1/users/123/backlog")) {
    return { data: BACKLOG_ROWS, meta: { page: 1, pages: 1, count: 2, per: 200 } };
  }
  if (method === "DELETE") return { deleted: true };
  return { data: {} };
}

before(async () => {
  server = createServer((req, res) => {
    void (async () => {
      const method = req.method ?? "";
      const url = req.url ?? "";
      requests.push({ method, url, body: await readBody(req) });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(respond(method, url)));
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

function nowPlayingPost(): CapturedRequest {
  const post = requests.find((r) => r.method === "POST");
  assert.ok(post, "addNowPlaying posted the entry");
  assert.equal(post.url, "/api/v1/users/123/now_playing");
  return post;
}

test("addNowPlaying deletes the game's backlog entry and keeps its note", async () => {
  await Member.addNowPlaying("123", 7, 4, null);

  assert.deepEqual(nowPlayingPost().body.data, {
    gamedb_game_id: 7,
    platform_id: 4,
    note: "from backlog",
  });
  const deletes = requests.filter((r) => r.method === "DELETE").map((r) => r.url);
  assert.deepEqual(deletes, ["/api/v1/backlog/11"]);
});

test("addNowPlaying keeps its own note over the backlog note", async () => {
  await Member.addNowPlaying("123", 7, 4, "fresh note");

  assert.equal((nowPlayingPost().body.data as any).note, "fresh note");
});

test("addNowPlaying deletes nothing when the game is not on the backlog", async () => {
  await Member.addNowPlaying("123", 9, 4, null);

  assert.equal((nowPlayingPost().body.data as any).note, null);
  assert.equal(requests.filter((r) => r.method === "DELETE").length, 0);
});

function backlogEntry(entryId: number, gameId: number, title: string): any {
  return {
    entryId,
    userId: "123",
    gameId,
    title,
    platformId: 4,
    platformName: "Switch",
    platformAbbreviation: "NS",
    sortOrder: null,
    note: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

async function buildOwnList(nowPlayingGameIds: number[]): Promise<any[]> {
  const originalList = UserGameBacklog.listForUser;
  const originalNowPlaying = Member.getNowPlaying;
  try {
    UserGameBacklog.listForUser = (async () => [
      backlogEntry(11, 7, "Alpha"),
      backlogEntry(12, 8, "Beta"),
    ]) as any;
    Member.getNowPlaying = (async () => nowPlayingGameIds.map((gameId) => ({ gameId }))) as any;
    const response = await buildBacklogListResponse({
      viewerUserId: "123",
      targetUserId: "123",
      memberLabel: "Tester",
      title: undefined,
      page: 0,
      isEphemeral: true,
    });
    return response.components.map((c: any) => c.toJSON());
  } finally {
    UserGameBacklog.listForUser = originalList;
    Member.getNowPlaying = originalNowPlaying;
  }
}

function findStartPlayingSelect(components: any[]): any {
  const rows = components.filter((c) => c.components?.[0]?.custom_id?.startsWith(
    "backlog-start-playing-v1:",
  ));
  return rows[0]?.components[0] ?? null;
}

test("the backlog start-playing menu leaves out games already on Now Playing", async () => {
  const select = findStartPlayingSelect(await buildOwnList([7]));

  assert.ok(select, "the start-playing menu is present");
  assert.deepEqual(select.options.map((o: any) => [o.value, o.label]), [["12", "2. Beta"]]);
});

test("the backlog start-playing menu is dropped when every game is on Now Playing", async () => {
  assert.equal(findStartPlayingSelect(await buildOwnList([7, 8])), null);
});
