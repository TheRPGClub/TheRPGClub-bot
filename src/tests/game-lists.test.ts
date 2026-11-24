import assert from "node:assert/strict";
import test from "node:test";
import type { IGameList, IGameListApi, IGameListEntry } from "../services/GameListApi.js";
import {
  addGameReply,
  addListChoices,
  addToListPrompt,
  buildGameListPage,
  GAME_LIST_PAGE_SIZE,
  gameListViewReply,
  startListChoices,
  viewListChoices,
  type GameListResult,
  type IGameListPage,
} from "../services/GameLists.js";
import type { ShelfTile } from "../services/ChallengeShelfImage.js";
import {
  buildGameDbListActionId,
  buildGameListAddId,
  buildGameListPageId,
  parseGameListAddId,
  parseGameListPageId,
} from "../functions/GameListCustomIds.js";
import {
  buildGameProfileActionRow,
  canOfferGameLists,
} from "../commands/gamedb/gamedb-profile.service.js";
import type { FeatureState, IFeatureGateSource } from "../functions/FeatureGate.js";
import { apiError, buttonsOf, galleryUrls, selectsOf, textOf } from "./challengeFixtures.js";

// Game Lists in Discord (bot#1568, design 3B shelf + 3C text), with a fake API client and
// fake cover downloads. Reordering and notes stay on the website.

const MEMBER = "222";
const OTHER = "333";
const PNG = Buffer.from("shelf");

function entry(n: number, overrides: Partial<IGameListEntry> = {}): IGameListEntry {
  return {
    game_id: n,
    position: n,
    note: null,
    added_at: "2026-02-03T15:00:00.000Z",
    game: {
      game_id: n,
      title: `Game ${n}`,
      initial_release_date: `${1990 + n}-06-01T00:00:00.000Z`,
      cover_url: `https://img.example/${n}.png`,
    },
    ...overrides,
  };
}

function list(overrides: Partial<IGameList> = {}): IGameList {
  const entries = overrides.entries ?? [entry(1), entry(2)];
  return {
    id: 7,
    name: "Top 10 of all time",
    description: "The ten I'd hand anyone.",
    visibility: "members",
    sort: "ranked",
    club: false,
    owner: { user_id: MEMBER, username: "mara", global_name: "Mara" },
    entry_count: entries.length,
    viewer: { can_edit: true, can_delete: true },
    entries,
    updated_at: "2026-11-20T00:00:00.000Z",
    ...overrides,
  };
}

interface IFakeApi extends IGameListApi {
  calls: string[];
}

function fakeApi(options: {
  own?: IGameList[];
  club?: IGameList[];
  found?: IGameList[];
  withGame?: IGameList[];
  show?: IGameList | null;
  add?: () => IGameListEntry;
} = {}): IFakeApi {
  const calls: string[] = [];
  return {
    calls,
    async ownLists(actor) {
      calls.push(`own:${actor}`);
      return options.own ?? [];
    },
    async search(query, actor) {
      calls.push(`search:${query}:${actor}`);
      return options.found ?? [];
    },
    async clubLists(actor) {
      calls.push(`club:${actor}`);
      return options.club ?? [];
    },
    async listsWithGame(gameId, actor) {
      calls.push(`withGame:${gameId}:${actor}`);
      return options.withGame ?? [];
    },
    async get(id, actor) {
      calls.push(`get:${id}:${actor}`);
      return options.show === undefined ? list({ id }) : options.show;
    },
    async addGame(listId, gameId, actor) {
      calls.push(`add:${listId}:${gameId}:${actor}`);
      return options.add ? options.add() : entry(gameId);
    },
  };
}

function shelfDeps(api: IGameListApi, drawn: ShelfTile[][] = []) {
  return {
    api,
    coverImage: async (url: string) => url.includes("nocover") ? null : Buffer.from(url),
    composeShelf: async (tiles: readonly ShelfTile[]) => {
      drawn.push([...tiles]);
      return PNG;
    },
  };
}

function pageOf(result: GameListResult): IGameListPage {
  assert.ok("page" in result, `expected a page, got ${JSON.stringify(result)}`);
  return result.page;
}

function noticeText(result: GameListResult): string {
  assert.ok("notice" in result, `expected a notice, got ${JSON.stringify(result)}`);
  return textOf(result.notice.components);
}

test("custom IDs round-trip and refuse anything else", () => {
  assert.deepEqual(parseGameListPageId(buildGameListPageId(7, 3)), { listId: 7, page: 3 });
  assert.equal(parseGameListPageId("game-list-page-v1:7"), null);
  assert.equal(parseGameListPageId("game-list-page-v1:x:1"), null);
  assert.equal(parseGameListAddId(buildGameListAddId(12)), 12);
  assert.equal(parseGameListAddId("game-list-add-v1:12:9"), null);
  assert.equal(buildGameDbListActionId(12), "gamedb-action:list:12");
});

test("/list view: the shelf of the page's covers on top, then the games with years and notes",
  async () => {
    const drawn: ShelfTile[][] = [];
    const api = fakeApi({
      show: list({ entries: [entry(1, { note: "Still the cleanest RPG." }), entry(2)] }),
    });
    const page = pageOf(await gameListViewReply(
      { listId: 7, page: 1, readerId: OTHER },
      shelfDeps(api, drawn),
    ));
    assert.deepEqual(api.calls, [`get:7:${OTHER}`]);
    assert.deepEqual(galleryUrls(page.view.components), ["attachment://game-list-7-1.png"]);
    assert.deepEqual(page.files, [{ name: "game-list-7-1.png", data: PNG }]);
    assert.deepEqual(drawn[0]!.map((t) => t.kind === "game" ? t.title : ""), ["Game 1", "Game 2"]);
    const text = textOf(page.view.components);
    assert.match(text, /## Top 10 of all time/);
    assert.match(text, /<@222>'s Game List · ranked · 2 games/);
    assert.match(text, /The ten I'd hand anyone\./);
    assert.match(text, /\*\*1\.\*\* Game 1 \(1991\)\n-# Still the cleanest RPG\./);
    assert.match(text, /\*\*2\.\*\* Game 2 \(1992\)/);
    assert.equal(page.private, false);
    const buttons = buttonsOf(page.view.components);
    assert.deepEqual(buttons.map((b) => b.label), ["Open on the website"]);
    assert.match(buttons[0]!.url ?? "", /\/lists\/7$/);
  });

test("/list view: pages of 10, Previous and Next, and a page past the end shows the last",
  async () => {
    const entries = Array.from({ length: 23 }, (_, i) => entry(i + 1));
    const api = fakeApi({ show: list({ entries }) });
    const page = pageOf(await gameListViewReply(
      { listId: 7, page: 9, readerId: MEMBER },
      shelfDeps(api),
    ));
    const text = textOf(page.view.components);
    assert.match(text, /page 3 of 3/);
    assert.match(text, /\*\*21\.\*\* Game 21/);
    assert.doesNotMatch(text, /Game 20 /);
    assert.doesNotMatch(text, /The ten I'd hand anyone/, "the description is on page 1 only");
    const [previous, next] = buttonsOf(page.view.components);
    assert.equal(previous!.customId, buildGameListPageId(7, 2));
    assert.equal(next!.disabled, true);
    assert.equal(next!.customId, buildGameListPageId(7, 4));
    assert.equal(GAME_LIST_PAGE_SIZE, 10);
  });

test("/list view: unranked lists drop the number; by date added says when", async () => {
  const added = pageOf(await gameListViewReply(
    { listId: 7, page: 1, readerId: MEMBER },
    shelfDeps(fakeApi({ show: list({ sort: "added" }) })),
  ));
  const text = textOf(added.view.components);
  assert.match(text, /by date added/);
  assert.match(text, /^Game 1 \(1991\)\n-# added 3 Feb 2026$/m);
});

test("/list view: without a single cover there is no picture; a club list says so",
  async () => {
    const entries = [entry(1, { game: { game_id: 1, title: "Bare", cover_url: null } })];
    const page = pageOf(await gameListViewReply(
      { listId: 7, page: 1, readerId: MEMBER },
      shelfDeps(fakeApi({ show: list({ entries, club: true, owner: null }) })),
    ));
    assert.deepEqual(page.files, []);
    assert.deepEqual(galleryUrls(page.view.components), []);
    assert.match(textOf(page.view.components), /The club's Game List/);
  });

test("/list view: long notes are cut so the page stays within Discord's 4000 characters",
  async () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      entry(i + 1, {
        note: "word ".repeat(56).trim(),
        game: { game_id: i + 1, title: "T".repeat(90), cover_url: null },
      }));
    const page = pageOf(await gameListViewReply(
      { listId: 7, page: 1, readerId: MEMBER },
      shelfDeps(fakeApi({ show: list({ entries, description: "d".repeat(500) }) })),
    ));
    assert.ok(textOf(page.view.components).length <= 4000);
    assert.match(textOf(page.view.components), /…/);
  });

test("/list view: a Private list is marked private, so it never goes to the channel",
  async () => {
    const page = await buildGameListPage(list({ visibility: "private" }), 1, shelfDeps(fakeApi()));
    assert.equal(page.private, true);
    assert.match(textOf(page.view.components), /Private/);
  });

test("/list view: a list the reader can't see, a bad pick and a refusal", async () => {
  assert.match(
    noticeText(await gameListViewReply(
      { listId: 7, page: 1, readerId: OTHER },
      shelfDeps(fakeApi({ show: null })),
    )),
    /no such Game List, or it is Private/,
  );
  assert.match(
    noticeText(await gameListViewReply({ listId: null, page: 1, readerId: OTHER })),
    /Pick a Game List/,
  );
  const failing = fakeApi();
  failing.get = async () => {
    throw apiError(500, { error: "boom" }, { method: "get", url: "/api/v1/game_lists/7" });
  };
  const result = await gameListViewReply({ listId: 7, page: 1, readerId: OTHER }, {
    api: failing,
  });
  assert.ok("error" in result);
  assert.match(result.error, /Could not read that Game List/);
});

test("view autocomplete: the member's own lists first, then the API's matches, no repeats",
  async () => {
    const mine = list({ id: 1, name: "Souls I love" });
    const other = list({ id: 2, name: "Souls tour", owner: {
      user_id: OTHER, username: "grind", global_name: null,
    } });
    const club = list({ id: 3, name: "Club Souls", club: true, owner: null });
    const api = fakeApi({ own: [mine, list({ id: 4, name: "Cozy" })], found: [club, mine, other] });
    const choices = await viewListChoices({ query: "souls", actingUserId: MEMBER }, { api });
    assert.deepEqual(choices.map((c) => c.value), ["1", "3", "2"]);
    assert.equal(choices[0]!.name, "Souls I love · Mara · 2 games");
    assert.equal(choices[1]!.name, "Club Souls · The club · 2 games");
    assert.equal(choices[2]!.name, "Souls tour · grind · 2 games");
  });

test("add autocomplete: only lists the member may edit (the club's ones for staff)",
  async () => {
    const api = fakeApi({
      own: [list({ id: 1, name: "Cozy", visibility: "private" })],
      club: [
        list({ id: 2, name: "Club Canon", club: true, owner: null }),
        list({ id: 3, name: "Club Cozy", club: true, owner: null,
          viewer: { can_edit: false, can_delete: false } }),
      ],
    });
    const choices = await addListChoices({ query: "", actingUserId: MEMBER }, { api });
    assert.deepEqual(choices, [
      { name: "Cozy · 2 games · Private", value: "1" },
      { name: "Club Canon · The club · 2 games", value: "2" },
    ]);
    const failing = fakeApi();
    failing.ownLists = async () => {
      throw new Error("down");
    };
    assert.deepEqual(await addListChoices({ query: "", actingUserId: MEMBER }, {
      api: failing,
    }), []);
  });

test("/list add: adds for the member and points at the website for order and notes",
  async () => {
    const api = fakeApi({ show: list({ name: "Cozy", entry_count: 5 }) });
    const result = await addGameReply({ listId: 7, gameId: 12, actingUserId: MEMBER }, { api });
    assert.deepEqual(api.calls, [`add:7:12:${MEMBER}`, `get:7:${MEMBER}`]);
    const text = noticeText(result);
    assert.match(text, /Added \*\*Game 12\*\* to \*\*Cozy\*\* \(5 games\)\./);
    assert.match(text, /Order and notes live on the website/);
    assert.ok("notice" in result);
    assert.deepEqual(buttonsOf(result.notice.components).map((b) => b.label), ["Open the list"]);
  });

test("/list add: a game or list typed but not picked, and the API's refusal", async () => {
  assert.match(
    noticeText(await addGameReply({ listId: 7, gameId: null, actingUserId: MEMBER })),
    /Pick a game/,
  );
  assert.match(
    noticeText(await addGameReply({ listId: null, gameId: 12, actingUserId: MEMBER })),
    /Pick one of your Game Lists/,
  );
  const api = fakeApi({
    add: () => {
      throw apiError(409, {
        error: "already_in_list",
        message: "Game 12 is already in this list.",
      }, { method: "post", url: "/api/v1/game_lists/7/entries/12" });
    },
  });
  const result = await addGameReply({ listId: 7, gameId: 12, actingUserId: MEMBER }, { api });
  assert.ok("error" in result);
  assert.match(result.error, /Game 12 is already in this list\./);
  assert.match(result.error, /entries\/12/, "the request goes with the refusal");
});

test("Add to a Game List: a select of the member's lists, those with the game marked",
  async () => {
    const api = fakeApi({
      own: [list({ id: 1, name: "Top 10" }), list({ id: 2, name: "Cozy" })],
      withGame: [list({ id: 2 }), list({ id: 9 })],
    });
    const result = await addToListPrompt(
      { gameId: 12, gameTitle: "Final Fantasy IX", actingUserId: MEMBER },
      { api },
    );
    assert.ok("notice" in result);
    assert.match(textOf(result.notice.components), /Add \*\*Final Fantasy IX\*\* to which list\?/);
    const [select] = selectsOf(result.notice.components);
    assert.equal(select!.customId, buildGameListAddId(12));
    assert.deepEqual(select!.options.map((o) => o.value), ["1", "2"]);
    const json = JSON.stringify(result.notice.components);
    assert.match(json, /Already has this game/);
    assert.ok(api.calls.includes(`withGame:12:${MEMBER}`));
  });

test("Add to a Game List: with no list yet, a link to start one", async () => {
  const result = await addToListPrompt(
    { gameId: 12, gameTitle: "Final Fantasy IX", actingUserId: MEMBER },
    { api: fakeApi() },
  );
  assert.match(noticeText(result), /no Game Lists yet/);
  assert.ok("notice" in result);
  assert.match(buttonsOf(result.notice.components)[0]!.url ?? "", /\/lists\/new$/);
});

test("game view: Add to a Game List sits on a row of its own under the first row's four",
  () => {
    const rows = buildGameProfileActionRow(12, "https://youtu.be/x").map((r) => r.toJSON());
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.components.length, 4);
    const [button] = buttonsOf(rows[1]);
    assert.equal(button!.label, "Add to a Game List");
    assert.equal(button!.customId, "gamedb-action:list:12");
  });

test("game view: no Add to a Game List row for a member who can't use Game Lists", () => {
  const rows = buildGameProfileActionRow(12, null, false, false).map((r) => r.toJSON());
  assert.equal(rows.length, 1);
  assert.ok(!JSON.stringify(rows).includes("gamedb-action:list:"));
});

function gateSource(state: FeatureState, staff: boolean): IFeatureGateSource {
  return {
    flags: async () => [{ key: "game_lists", name: "Game Lists", state }],
    isStaff: async () => staff,
  };
}

test("game view: Add to a Game List is offered as the feature gate decides for the viewer",
  async () => {
    assert.equal(await canOfferGameLists(MEMBER, gateSource("live", false)), true);
    assert.equal(await canOfferGameLists(MEMBER, gateSource("off", true)), false);
    assert.equal(await canOfferGameLists(MEMBER, gateSource("preview", false)), false);
    assert.equal(await canOfferGameLists(MEMBER, gateSource("preview", true)), true);
  });

test("game view: with no viewer, Add to a Game List is offered only while Game Lists is Live",
  async () => {
    assert.equal(await canOfferGameLists(null, gateSource("live", false)), true);
    assert.equal(await canOfferGameLists(null, gateSource("preview", true)), false);
    assert.equal(await canOfferGameLists(null, gateSource("off", false)), false);
  });

test("/challenge create from-list: own lists, or the club's editable ones when club-hosted",
  async () => {
    const api = fakeApi({
      own: [
        list({ id: 1, name: "Soulslike, but make it history" }),
        list({ id: 4, name: "Cozy", visibility: "private" }),
      ],
      club: [
        list({ id: 2, name: "Club Souls", club: true, owner: null }),
        list({ id: 3, name: "Club Cozy", club: true, owner: null,
          viewer: { can_edit: false, can_delete: false } }),
      ],
    });
    assert.deepEqual(
      await startListChoices({ query: "soul", actingUserId: MEMBER, clubHosted: false }, { api }),
      [{ name: "Soulslike, but make it history · 2 games", value: "1" }],
    );
    assert.deepEqual(
      await startListChoices({ query: "", actingUserId: MEMBER, clubHosted: true }, { api }),
      [{ name: "Club Souls · 2 games", value: "2" }],
    );
    const failing = fakeApi();
    failing.ownLists = async () => {
      throw new Error("Feature hidden");
    };
    assert.deepEqual(await startListChoices(
      { query: "", actingUserId: MEMBER, clubHosted: false },
      { api: failing },
    ), []);
  });
