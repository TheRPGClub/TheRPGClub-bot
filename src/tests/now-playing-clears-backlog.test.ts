import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import Member from "../classes/Member.js";
import { takeOffBacklogIfAlreadyPlaying } from "../commands/backlog/backlog-list.service.js";

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

function respond(method: string, url: string): { status: number; body: unknown } {
  if (method === "GET" && url.startsWith("/api/v1/users/456/backlog")) {
    return { status: 400, body: { error: "backlog unavailable" } };
  }
  return { status: 200, body: respondOk(method, url) };
}

function respondOk(method: string, url: string): unknown {
  if (method === "GET" && /^\/api\/v1\/users\/\d+\/now_playing/.test(url)) return { data: [] };
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
      const { status, body } = respond(method, url);
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
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

function nowPlayingPost(userId = "123"): CapturedRequest {
  const post = requests.find((r) => r.method === "POST");
  assert.ok(post, "addNowPlaying posted the entry");
  assert.equal(post.url, `/api/v1/users/${userId}/now_playing`);
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

test("addNowPlaying still adds when the backlog lookup fails", async () => {
  await Member.addNowPlaying("456", 7, 4, null);

  assert.equal((nowPlayingPost("456").body.data as any).gamedb_game_id, 7);
  assert.equal(requests.filter((r) => r.method === "DELETE").length, 0);
});

function backlogEntry(note: string | null): any {
  return {
    entryId: 11,
    userId: "123",
    gameId: 7,
    title: "Alpha",
    platformId: 4,
    platformName: "Switch",
    platformAbbreviation: "NS",
    sortOrder: null,
    note,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

async function pickFromBacklog(
  nowPlaying: Array<{ gameId: number; note: string | null }>,
  backlogNote: string | null = null,
): Promise<{
  handled: boolean;
  replies: any[];
  noteUpdates: unknown[][];
}> {
  const originalNowPlaying = Member.getNowPlaying;
  const originalUpdateNote = Member.updateNowPlayingNote;
  const noteUpdates: unknown[][] = [];
  const replies: any[] = [];
  const interaction: any = {
    user: { id: "123" },
    guildId: null,
    channelId: null,
    deferred: false,
    replied: false,
    isMessageComponent: () => true,
    reply: async (payload: any) => {
      replies.push(payload);
    },
  };
  try {
    Member.getNowPlaying = (async () => nowPlaying) as any;
    Member.updateNowPlayingNote = (async (...args: unknown[]) => {
      noteUpdates.push(args);
      return true;
    }) as any;
    const handled = await takeOffBacklogIfAlreadyPlaying(interaction, backlogEntry(backlogNote));
    return { handled, replies, noteUpdates };
  } finally {
    Member.getNowPlaying = originalNowPlaying;
    Member.updateNowPlayingNote = originalUpdateNote;
  }
}

test("picking a backlog game already on Now Playing takes it off the backlog", async () => {
  const { handled, replies, noteUpdates } = await pickFromBacklog(
    [{ gameId: 7, note: "mine" }],
    "from backlog",
  );

  assert.equal(handled, true);
  assert.equal(noteUpdates.length, 0);
  const deletes = requests.filter((r) => r.method === "DELETE").map((r) => r.url);
  assert.deepEqual(deletes, ["/api/v1/backlog/11"]);
  const json = JSON.stringify(replies[0].components.map((c: any) => c.toJSON()));
  assert.match(json, /already on your Now Playing list, so it was taken off your backlog/);
});

test("picking a backlog game not on Now Playing leaves it to startPlayingEntry", async () => {
  const { handled, replies } = await pickFromBacklog([{ gameId: 8, note: null }]);

  assert.equal(handled, false);
  assert.equal(replies.length, 0);
  assert.equal(requests.filter((r) => r.method === "DELETE").length, 0);
});

test("clearing a backlog row already on Now Playing carries its note over", async () => {
  const { noteUpdates } = await pickFromBacklog([{ gameId: 7, note: null }], "from backlog");

  assert.deepEqual(noteUpdates, [["123", 7, "from backlog"]]);
  const deletes = requests.filter((r) => r.method === "DELETE").map((r) => r.url);
  assert.deepEqual(deletes, ["/api/v1/backlog/11"]);
});
