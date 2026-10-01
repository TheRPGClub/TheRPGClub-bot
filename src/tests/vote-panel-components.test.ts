import assert from "node:assert/strict";
import test from "node:test";
import type { INominationEntry } from "../classes/Nomination.js";
import type { IVoteEntry } from "../classes/Vote.js";
import {
  buildVotePanelComponents,
  type IVotePanelParams,
} from "../functions/VotePanelComponents.js";
import { parsePickedNominationId } from "../commands/vote/vote-panel-actions.service.js";
import { DISCORD_V2_COMPONENTS_MAX } from "../config/textLimits.js";

interface IComponentNode {
  type?: number;
  custom_id?: string;
  content?: string;
  components?: IComponentNode[];
  accessory?: IComponentNode;
}

const BUTTON_TYPE = 2;
const SELECT_TYPE = 3;

function makeNominations(count: number): INominationEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    roundNumber: 143,
    userId: "100",
    gameTitle: `Game ${index + 1}`,
    gamedbGameId: index + 1,
    nominatedAt: new Date("2026-01-01T00:00:00.000Z"),
    reason: null,
  }));
}

const MY_VOTES: IVoteEntry[] = [
  {
    id: 1,
    roundNumber: 143,
    userId: "100",
    nominationId: 1,
    gamedbGameId: 1,
    gameTitle: "Game 1",
    votedAt: new Date("2026-01-02T00:00:00.000Z"),
  },
];

function panelJson(overrides: Partial<IVotePanelParams>): IComponentNode[] {
  const params: IVotePanelParams = {
    kind: "gotm",
    roundNumber: 143,
    monthLabel: "November 2026",
    voteDeadline: new Date("2026-10-30T16:00:00.000Z"),
    cap: 2,
    nominations: makeNominations(4),
    ...overrides,
  };
  return buildVotePanelComponents(params).map((c) => c.toJSON() as IComponentNode);
}

function flatten(nodes: IComponentNode[]): IComponentNode[] {
  return nodes.flatMap((node) => [
    node,
    ...flatten(node.components ?? []),
    ...(node.accessory ? flatten([node.accessory]) : []),
  ]);
}

function textOf(nodes: IComponentNode[]): string {
  return flatten(nodes)
    .map((node) => node.content ?? "")
    .join("\n");
}

test("a small ballot gets one stable vote button per game", () => {
  const json = panelJson({});
  const ids = flatten(json)
    .filter((node) => node.type === BUTTON_TYPE)
    .map((node) => node.custom_id);
  assert.deepEqual(ids, [
    "vote-pick:gotm:143:1",
    "vote-pick:gotm:143:2",
    "vote-pick:gotm:143:3",
    "vote-pick:gotm:143:4",
    "vote-mine:gotm:143",
    "vote-tally:gotm:143",
  ]);
  assert.equal(flatten(json).filter((node) => node.type === SELECT_TYPE).length, 0);
});

test("the panel names the month, the cap and the deadline in local time", () => {
  const text = textOf(panelJson({}));
  assert.match(text, /## 🗳️ GOTM Vote - Round 143/);
  assert.match(text, /Which game\(s\) should be the GOTM for \*\*November 2026\*\*\?/);
  assert.match(text, /Vote for up to \*\*2\*\* games/);
  assert.match(text, /Ends <t:1793376000:R> \(<t:1793376000:F>\)/);
});

test("game buttons wrap five to a row", () => {
  const rows = panelJson({ nominations: makeNominations(12) }).slice(1);
  assert.deepEqual(
    rows.map((row) => row.components?.length),
    [5, 5, 2, 2],
  );
});

test("the largest button ballot stays within Discord's component limit", () => {
  const json = panelJson({ nominations: makeNominations(25), myVotes: MY_VOTES });
  assert.ok(flatten(json).length <= DISCORD_V2_COMPONENTS_MAX);
  assert.equal(flatten(json).filter((node) => node.type === SELECT_TYPE).length, 0);
});

test("a ballot too large for buttons falls back to select menus", () => {
  const json = panelJson({ nominations: makeNominations(30), myVotes: MY_VOTES });
  const selects = flatten(json).filter((node) => node.type === SELECT_TYPE);
  assert.deepEqual(
    selects.map((node) => node.custom_id),
    ["vote-cast:gotm:143:0", "vote-cast:gotm:143:1"],
  );
  assert.ok(flatten(json).length <= DISCORD_V2_COMPONENTS_MAX);
  assert.match(textOf(json), /Pick a game you already voted for/);
});

test("parsePickedNominationId reads the button's last segment", () => {
  assert.equal(parsePickedNominationId("vote-pick:gotm:143:17"), 17);
  assert.equal(parsePickedNominationId("vsbx-pick:1:ff:999:nr-gotm:3"), 3);
  assert.equal(parsePickedNominationId("vote-pick:gotm:143:0"), null);
  assert.equal(parsePickedNominationId("vote-pick:gotm:143:x"), null);
});

const SECTION_TYPE = 9;
const TEXT_DISPLAY_TYPE = 10;
const THUMBNAIL_TYPE = 11;

function coverUrlsFor(count: number): Map<number, string> {
  return new Map(
    Array.from({ length: count }, (_, index) => [
      index + 1,
      `https://example.com/cover-${index + 1}.png`,
    ]),
  );
}

function containerChildren(json: IComponentNode[]): IComponentNode[] {
  return json[0]?.components ?? [];
}

test("each game is listed with its cover above the rules", () => {
  const json = panelJson({ coverUrls: coverUrlsFor(4) });
  const children = containerChildren(json);
  assert.deepEqual(
    children.map((node) => node.type),
    [
      TEXT_DISPLAY_TYPE,
      SECTION_TYPE,
      SECTION_TYPE,
      SECTION_TYPE,
      SECTION_TYPE,
      14,
      TEXT_DISPLAY_TYPE,
    ],
  );
  const thumbnails = flatten(json).filter((node) => node.type === THUMBNAIL_TYPE);
  assert.equal(thumbnails.length, 4);
  assert.match(children.at(-1)?.content ?? "", /^🙈 Votes are anonymous/);
  assert.ok(flatten(json).length <= DISCORD_V2_COMPONENTS_MAX);
});

test("the cover list counts its components and keeps the buttons", () => {
  const json = panelJson({ nominations: makeNominations(7), coverUrls: coverUrlsFor(7) });
  // Container 4, seven sections of 3, seven buttons in two rows, footer row 3.
  assert.equal(flatten(json).length, 4 + 21 + 9 + 3);
  assert.equal(flatten(json).filter((node) => node.type === BUTTON_TYPE).length, 9);
});

test("a game without a cover is a plain text line with its reason", () => {
  const nominations = makeNominations(3).map((nomination) => ({
    ...nomination,
    reason: nomination.id === 2 ? "A classic\nworth playing" : null,
  }));
  const coverUrls = coverUrlsFor(3);
  coverUrls.delete(2);
  const children = containerChildren(panelJson({ nominations, coverUrls }));
  assert.deepEqual(
    children.slice(1, 4).map((node) => node.type),
    [SECTION_TYPE, TEXT_DISPLAY_TYPE, SECTION_TYPE],
  );
  assert.equal(children[2]?.content, "**Game 2**\n> A classic worth playing");
});

test("a ballot too large for covers drops them and lists the titles", () => {
  const json = panelJson({ nominations: makeNominations(12), coverUrls: coverUrlsFor(12) });
  assert.equal(flatten(json).filter((node) => node.type === THUMBNAIL_TYPE).length, 0);
  assert.equal(flatten(json).filter((node) => node.type === BUTTON_TYPE).length, 14);
  assert.match(containerChildren(json)[0]?.content ?? "", /- \*\*Game 1\*\*\n[^]*- \*\*Game 12\*\*/);
  assert.ok(flatten(json).length <= DISCORD_V2_COMPONENTS_MAX);
});

test("games without any covers are listed as titles in the heading", () => {
  const children = containerChildren(panelJson({ coverUrls: new Map() }));
  assert.equal(children.length, 3);
  assert.match(children[0]?.content ?? "", /- \*\*Game 4\*\*$/);
});

test("long reasons are dropped when the cover list would pass the text budget", () => {
  // One cover leaves room for thirteen text lines, whose reasons would pass the budget.
  const nominations = makeNominations(14).map((nomination) => ({
    ...nomination,
    reason: "x".repeat(500),
  }));
  const json = panelJson({ nominations, coverUrls: coverUrlsFor(1) });
  const children = containerChildren(json);
  assert.equal(children[1]?.type, SECTION_TYPE);
  assert.equal(children[1]?.components?.[0]?.content, "**Game 1**");
  assert.equal(children[14]?.content, "**Game 14**");
  assert.ok(flatten(json).length <= DISCORD_V2_COMPONENTS_MAX);
});
